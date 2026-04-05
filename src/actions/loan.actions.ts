"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { collateral } from "@/lib/db/schema"
import { createLoan, listLoans, updateLoan, deleteLoan } from "@/services/loan.service"
import {
  CustomerNotFound,
  IncompleteLoanRequirements,
  LoanNotFound,
} from "@/lib/errors"
import { ROLE_LEVELS, type UserRole, type CreateLoanInput, type UpdateLoanInput, type DeleteLoanInput, type LoanWithCustomer, type LoanListEntry, type ScheduleEntry } from "@/types"
import { revalidatePath } from "next/cache"
import { sendAdminNotification } from "@/lib/email"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, isNull, asc } from "drizzle-orm"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import BigNumber from "bignumber.js"
import { generateLoansExcel } from "@/services/export/excel.service"

export async function getCollateralNaturesAction(): Promise<string[]> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return []

  const rows = await db
    .selectDistinct({ nature: collateral.nature })
    .from(collateral)
    .orderBy(collateral.nature)

  return rows.map((r) => r.nature)
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
  if (input.description !== undefined && !input.description.trim()) {
    return { error: "Loan description cannot be empty" }
  }

  // Trim description before passing to service
  if (input.description !== undefined) {
    input.description = input.description.trim()
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
  if (!input.description?.trim()) {
    return { error: "Loan description is required" }
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
  const now = new Date()
  return Promise.all(
    loanList.map(async (loan) => {
      let daysOverdue = 0
      let outstandingBalance = loan.principalAmount
      let dailyRate = "0"
      let lastPaymentDate: Date | null = null
      let unpaidInterest = "0"

      // Fetch payments for ALL loans (needed for outstandingBalance, lastPaymentDate)
      const loanPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate))

      const lastPayment = loanPayments.at(-1)
      if (lastPayment) {
        outstandingBalance = lastPayment.principalBalanceAfter
        lastPaymentDate = lastPayment.paymentDate
      }

      if (loan.status === "active") {
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const loanType = loan.loanType ?? "perpetual"

        if (loanType === "perpetual") {
          // Existing perpetual logic — unchanged
          const totalDaysElapsed = Math.floor(
            (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
          )
          const totalInterestAccrued = calculateInterest(loan.principalAmount, effectiveRate, totalDaysElapsed, 0)
          const dailyRateBN = calculateDailyRate(effectiveRate)
          const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRateBN)
          dailyRate = dailyInterestAmount.toFixed(2)

          const totalInterestPaid = loanPayments.reduce(
            (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
          )

          const unpaidInterestBN = totalInterestAccrued.minus(totalInterestPaid)
          unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)

          const daysOverdueBN = calculateDaysOverdue(
            totalInterestAccrued,
            totalInterestPaid,
            dailyInterestAmount
          )
          daysOverdue = Math.floor(daysOverdueBN.toNumber())
        } else {
          // Term loans (fixed_rate, reducing_balance): overdue = missed installments
          const monthsElapsed = Math.floor(
            (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
          )
          const expectedPayments = Math.min(monthsElapsed, loan.termMonths ?? 0)
          const actualPayments = loanPayments.length
          const missedPayments = Math.max(expectedPayments - actualPayments, 0)
          daysOverdue = missedPayments * 30

          // Calculate daily rate for display
          const monthlyInterest = loanType === "fixed_rate"
            ? new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(effectiveRate))
            : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(effectiveRate))
          dailyRate = monthlyInterest.dividedBy(30).toFixed(2)

          // Unpaid interest = expected interest through elapsed months - paid interest
          const totalInterestPaid = loanPayments.reduce(
            (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
          )
          const { calculateSchedule } = await import("@/lib/interest/engine")
          const schedule = calculateSchedule(
            loan.principalAmount,
            effectiveRate,
            loan.termMonths!,
            loanType as "fixed_rate" | "reducing_balance"
          )
          const expectedInterest = schedule
            .slice(0, expectedPayments)
            .reduce((s: BigNumber, e: ScheduleEntry) => s.plus(new BigNumber(e.monthlyInterest)), new BigNumber(0))
          const unpaidInterestBN = expectedInterest.minus(totalInterestPaid)
          unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)
        }
      }

      return { ...loan, daysOverdue, outstandingBalance, dailyRate, lastPaymentDate, unpaidInterest }
    })
  )
}

export async function getCustomerLoansWithOverdueAction(customerId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const allLoans = await Effect.runPromise(listLoans())
    const customerLoans = allLoans.filter((l) => l.customerId === customerId)
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
