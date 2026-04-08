"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { collateral } from "@/lib/db/schema"
import { user } from "@/lib/db/schema/auth"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { createLoan, listLoans, updateLoan, deleteLoan } from "@/services/loan.service"
import {
  CustomerNotFound,
  IncompleteLoanRequirements,
  LoanNotFound,
} from "@/lib/errors"
import { ROLE_LEVELS, toLoanType, type UserRole, type CreateLoanInput, type UpdateLoanInput, type DeleteLoanInput, type LoanWithCustomer, type LoanListEntry } from "@/types"
import { revalidatePath } from "next/cache"
import { sendAdminNotification } from "@/lib/email"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, isNull, asc, desc, inArray } from "drizzle-orm"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import BigNumber from "bignumber.js"
import { generateLoansExcel } from "@/services/export/excel.service"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/transaction.service"
import { formatAmount } from "@/lib/interest/engine"

export async function getCollateralNaturesAction(): Promise<string[]> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return []

  const rows = await db
    .selectDistinct({ nature: collateral.nature })
    .from(collateral)
    .orderBy(collateral.nature)

  return rows.map((r) => r.nature)
}

export async function getLoanReceiptDataAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) return { error: "Loan not found" }

  const [[customer], [collateralRecord], [issuingUser]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, loan.customerId)),
    db.select().from(collateral).where(eq(collateral.loanId, loanId)),
    db.select().from(user).where(eq(user.id, loan.issuedBy)),
  ])

  const rate = new BigNumber(loan.interestRate).multipliedBy(100)
  return {
    data: {
      receiptNumber: `LOAN-${loanId.slice(0, 8).toUpperCase()}`,
      date: loan.startDate.toISOString(),
      customerName: customer?.fullName ?? "—",
      customerNin: customer?.nin,
      loanAmount: loan.principalAmount,
      issuanceFee: loan.issuanceFee,
      interestRate: `${rate.toFixed(rate.mod(1).isZero() ? 0 : 1)}%`,
      collateralNature: collateralRecord?.nature ?? "—",
      disbursementSource: loan.disbursementSource,
      officerName: issuingUser?.name ?? "Officer",
    },
  }
}

export async function listLoansAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listLoans())
    return { data }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function getCurrentUserRoleAction(): Promise<UserRole> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return "unassigned" as UserRole
  return (session.user.role ?? "unassigned") as UserRole
}

export async function updateLoanAction(input: UpdateLoanInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Forbidden" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "Reason is required" }
  }
  if (input.principalAmount !== undefined && !/^\d+(\.\d{1,2})?$/.test(input.principalAmount)) {
    return { error: "Principal must be a valid decimal number" }
  }
  if (input.principalAmount !== undefined && parseFloat(input.principalAmount) <= 0) {
    return { error: "Principal must be greater than zero" }
  }
  if (input.issuanceFee !== undefined) {
    if (!/^\d+(\.\d{1,2})?$/.test(input.issuanceFee)) {
      return { error: "Issuance fee must be a valid decimal number" }
    }
    if (parseFloat(input.issuanceFee) < 50000) {
      return { error: "Issuance fee must be at least 50,000 UGX" }
    }
  }
  try {
    const data = await Effect.runPromise(updateLoan(input, session.user.id))
    revalidatePath("/loans")
    revalidatePath(`/loans/${input.loanId}`)
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function deleteLoanAction(input: DeleteLoanInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Forbidden" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "Reason is required" }
  }

  try {
    const data = await Effect.runPromise(deleteLoan(input, session.user.id))
    revalidatePath("/loans")
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function createLoanAction(input: CreateLoanInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) {
    return { error: "Forbidden" }
  }

  // Rollover requires supervisor+
  if (input.rollover) {
    if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
      return { error: "Only supervisors and above can perform loan rollovers" }
    }
  }

  if (!input.customerId?.trim()) {
    return { error: "Customer ID is required" }
  }
  if (!input.principalAmount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.principalAmount)) {
    return { error: "Principal must be a valid decimal number" }
  }
  if (parseFloat(input.principalAmount) <= 0) {
    return { error: "Principal must be greater than zero" }
  }
  if (!input.startDate?.trim()) {
    return { error: "Start date is required" }
  }
  if (!input.collateral?.nature?.trim()) {
    return { error: "Collateral nature is required" }
  }
  if (!input.issuanceFee?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.issuanceFee)) {
    return { error: "Issuance fee must be a valid decimal number" }
  }
  if (parseFloat(input.issuanceFee) < 50000) {
    return { error: "Issuance fee must be at least 50,000 UGX" }
  }
  if (!input.collateral?.description?.trim()) {
    return { error: "Collateral description is required" }
  }

  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.disbursementSource || !validLocations.includes(input.disbursementSource)) {
    return { error: "Disbursement source is required (cash, bank, or strong_room)" }
  }

  // Validate loanType
  const validLoanTypes = ["perpetual", "fixed_rate", "reducing_balance"]
  const loanType = input.loanType || "perpetual"
  if (!validLoanTypes.includes(loanType)) {
    return { error: "Loan type must be perpetual, fixed_rate, or reducing_balance" }
  }

  // Validate interestRate if provided
  if (input.interestRate && input.interestRate !== "") {
    if (!/^\d+(\.\d+)?$/.test(input.interestRate) || parseFloat(input.interestRate) <= 0) {
      return { error: "Interest rate must be a positive decimal (e.g. 0.10 for 10%/month)" }
    }
  }

  // Validate termMonths for term loans
  if (loanType !== "perpetual") {
    if (!input.termMonths || input.termMonths <= 0 || !Number.isInteger(input.termMonths)) {
      return { error: "Term months must be a positive integer for fixed rate and reducing balance loans" }
    }
  }

  const loanInput: CreateLoanInput = {
    ...input,
    interestRate: input.interestRate || "0.10",
    minInterestDays: input.minInterestDays || 30,
    loanType,
    termMonths: loanType !== "perpetual" ? input.termMonths : undefined,
  }

  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    loanInput.interestRateOverride = null
    loanInput.minPeriodOverride = null
  }

  try {
    const data = await Effect.runPromise(
      createLoan(loanInput, session.user.id)
    )
    revalidatePath("/loans")
    revalidatePath(`/customers/${input.customerId}`)
    void sendAdminNotification("loan.disbursed", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${data.id.slice(0, 8).toUpperCase()}`,
      amount: input.principalAmount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    if (error instanceof IncompleteLoanRequirements) {
      return {
        error: "Incomplete loan requirements",
        details: { missing: (error as any).missing },
      }
    }
    return { error: "Internal server error" }
  }
}

async function computeOverdue(loanList: LoanWithCustomer[]): Promise<LoanListEntry[]> {
  // Batch-fetch all payments for all loans in a single query
  const loanIds = loanList.map((l) => l.id)
  const allPayments =
    loanIds.length > 0
      ? await db
          .select()
          .from(payments)
          .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))
      : []

  // Group payments by loanId
  const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>()
  for (const p of allPayments) {
    const existing = paymentsByLoanId.get(p.loanId) ?? []
    existing.push(p)
    paymentsByLoanId.set(p.loanId, existing)
  }

  const ledgerBalances = await getLoanBalancesFromLedger(loanIds)
  const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

  return loanList.map((loan) => {
      let daysOverdue = 0
      let dailyRate = "0"
      let unpaidInterest = "0"

      const loanPayments = paymentsByLoanId.get(loan.id) ?? []

      const ledgerBalance = ledgerBalances.get(loan.id)
      if (ledgerBalance === undefined) {
        console.warn(`[computeOverdue] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
      }
      const outstandingBalance = ledgerBalance !== undefined
        ? ledgerBalance.toFixed(0)
        : loan.principalAmount

      const lastPayment = loanPayments.at(-1)
      const lastPaymentDate: Date | null = lastPayment ? lastPayment.paymentDate : null

      if (loan.status === "active") {
        const baseRate = getBaseRate(loan)
        const balanceForCalc = outstandingBalance

        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType: toLoanType(loan.loanType),
          termMonths: loan.termMonths,
          totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
          paymentCount: loanPayments.length,
          outstandingBalance: balanceForCalc,
          penaltyWaived: loan.penaltyWaived,
          loan,
        })
        daysOverdue = info.daysOverdue
        dailyRate = info.dailyRate
        unpaidInterest = info.unpaidInterest
      }

      return { ...loan, daysOverdue, outstandingBalance, dailyRate, lastPaymentDate, unpaidInterest }
  })
}

export async function getCustomerLoansWithOverdueAction(customerId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const customerLoans = await db
      .select({
        id: loans.id,
        customerId: loans.customerId,
        principalAmount: loans.principalAmount,
        issuanceFee: loans.issuanceFee,
        interestRate: loans.interestRate,
        minInterestDays: loans.minInterestDays,
        startDate: loans.startDate,
        status: loans.status,
        interestRateOverride: loans.interestRateOverride,
        minPeriodOverride: loans.minPeriodOverride,
        issuedBy: loans.issuedBy,
        disbursementSource: loans.disbursementSource,
        loanType: loans.loanType,
        termMonths: loans.termMonths,
        penaltyMultiplier: loans.penaltyMultiplier,
        penaltyWaived: loans.penaltyWaived,
        penaltyWaivedBy: loans.penaltyWaivedBy,
        penaltyWaivedAt: loans.penaltyWaivedAt,
        rolledOverFrom: loans.rolledOverFrom,
        rolloverAmount: loans.rolloverAmount,
        createdAt: loans.createdAt,
        updatedAt: loans.updatedAt,
        deletedAt: loans.deletedAt,
        customerName: customers.fullName,
        customerContact: customers.contact,
      })
      .from(loans)
      .innerJoin(customers, eq(loans.customerId, customers.id))
      .where(and(eq(loans.customerId, customerId), isNull(loans.deletedAt)))
      .orderBy(desc(loans.createdAt))
    return { data: await computeOverdue(customerLoans) }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listLoansWithOverdueAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const allLoans = await Effect.runPromise(listLoans())
    return { data: await computeOverdue(allLoans) }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function exportLoansExcelAction(filter?: "all" | "critical" | "at-risk" | "early") {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const allLoans = await Effect.runPromise(listLoans())
    let entries = await computeOverdue(allLoans)

    // Apply filter if specified
    if (filter && filter !== "all") {
      entries = entries.filter((entry) => {
        if (entry.daysOverdue < 0) return false
        if (filter === "critical") return entry.daysOverdue >= 30
        if (filter === "at-risk") return entry.daysOverdue >= 25 && entry.daysOverdue < 30
        if (filter === "early") return entry.daysOverdue >= 0 && entry.daysOverdue < 25
        return true
      })
    }

    if (entries.length === 0) {
      return { error: "No loans to export" }
    }

    const buffer = await generateLoansExcel(entries)
    const base64 = buffer.toString("base64")
    return { data: base64 }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listActiveLoansWithOverdueAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const allLoans = await Effect.runPromise(listLoans())
    const activeLoans = allLoans.filter((l) => l.status === "active")
    return { data: await computeOverdue(activeLoans) }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function waivePenaltyAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  const role = session.user.role as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Only admins can waive penalties" }
  }

  try {
    const [loan] = await db
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))

    if (!loan) return { error: "Loan not found" }

    await db.update(loans).set({
      penaltyWaived: true,
      penaltyWaivedBy: session.user.id,
      penaltyWaivedAt: new Date(),
    }).where(eq(loans.id, loanId))

    revalidatePath("/loans")
    revalidatePath(`/loans/${loanId}`)
    return { success: true }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function adjustPenaltyMultiplierAction(loanId: string, multiplier: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  const role = session.user.role as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Only admins can adjust penalty rates" }
  }

  const value = parseFloat(multiplier)
  if (isNaN(value) || value < 0 || value >= 1) {
    return { error: "Multiplier must be between 0 and 1 (e.g., 0.10 for 10%)" }
  }

  try {
    const [loan] = await db
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))

    if (!loan) return { error: "Loan not found" }

    await db.update(loans).set({
      penaltyMultiplier: value.toFixed(4),
    }).where(eq(loans.id, loanId))

    revalidatePath("/loans")
    revalidatePath(`/loans/${loanId}`)
    return { success: true }
  } catch {
    return { error: "Internal server error" }
  }
}
