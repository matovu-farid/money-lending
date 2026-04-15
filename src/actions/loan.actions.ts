"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getSession, getUserRole, getErrorTag, getErrorField, getEffectivePermissions } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { db } from "@/lib/db"
import { collateral } from "@/lib/db/schema"
import { user } from "@/lib/db/schema/auth"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { createLoan, listLoans } from "@/services/loan.service"
import { toLoanType, type UserRole, type CreateLoanInput, type UpdateLoanInput, type DeleteLoanInput, type LoanWithCustomer, type LoanListEntry } from "@/types"
import { revalidatePath } from "next/cache"
import { sendAdminNotification } from "@/lib/email"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, isNull, asc, desc, inArray } from "drizzle-orm"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import BigNumber from "bignumber.js"
import { generateLoansExcel } from "@/services/export/excel.service"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { getLocationBalances } from "@/services/report.service"
import { formatAmount } from "@/lib/interest/engine"
import { VALID_DEPOSIT_LOCATIONS, VALID_LOAN_TYPES } from "@/lib/constants"
import { shortId, localDateString } from "@/lib/utils"

export const getLocationBalancesAction = withAction({
  permission: "reports:read",
  effect: () => getLocationBalances(),
})

export async function getCollateralNaturesAction(): Promise<string[]> {
  const session = await getSession()
  if (!session) return []

  const rows = await db
    .selectDistinct({ nature: collateral.nature })
    .from(collateral)
    .orderBy(collateral.nature)

  return rows.map((r) => r.nature)
}

export const getLoanPaymentContextAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    const [row] = await db
      .select({
        id: loans.id,
        customerId: loans.customerId,
        customerName: customers.fullName,
        startDate: loans.startDate,
      })
      .from(loans)
      .innerJoin(customers, eq(loans.customerId, customers.id))
      .where(eq(loans.id, loanId))

    if (!row) return { error: "Loan not found" }

    return {
      data: {
        loanId: row.id,
        customerId: row.customerId,
        customerName: row.customerName,
        loanReference: `LOAN-${shortId(row.id).toUpperCase()}`,
        startDate: new Date(row.startDate).toISOString().slice(0, 10),
      },
    }
  },
})

export const getLoanCollateralAction = withAction<string, { data: { nature: string; description: string | null } | null }>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    const [record] = await db.select({
      nature: collateral.nature,
      description: collateral.description,
    }).from(collateral).where(eq(collateral.loanId, loanId))

    return { data: record ?? null }
  },
})

export const getLoanReceiptDataAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
    if (!loan) return { error: "Loan not found" }

    const [[customer], [collateralRecord], [issuingUser]] = await Promise.all([
      db.select().from(customers).where(eq(customers.id, loan.customerId)),
      db.select().from(collateral).where(eq(collateral.loanId, loanId)),
      db.select().from(user).where(eq(user.id, loan.issuedBy)),
    ])

    const rate = new BigNumber(loan.interestRateOverride ?? loan.interestRate).multipliedBy(100)
    const isRollover = !!loan.rolloverAmount && new BigNumber(loan.rolloverAmount).isGreaterThan(0)
    return {
      data: {
        receiptNumber: `LOAN-${shortId(loanId).toUpperCase()}`,
        date: loan.startDate.toISOString(),
        customerName: customer?.fullName ?? "\u2014",
        customerNin: customer?.nin,
        loanAmount: isRollover
          ? new BigNumber(loan.principalAmount).minus(new BigNumber(loan.rolloverAmount!)).toFixed(0)
          : loan.principalAmount,
        issuanceFee: loan.issuanceFee,
        interestRate: `${rate.toFixed(rate.mod(1).isZero() ? 0 : 1)}%`,
        collateralNature: collateralRecord?.nature ?? "\u2014",
        disbursementSource: loan.disbursementSource,
        officerName: issuingUser?.name ?? "Officer",
        ...(isRollover ? {
          rolloverAmount: loan.rolloverAmount!,
          totalNewPrincipal: loan.principalAmount,
        } : {}),
      },
    }
  },
})

export const listLoansAction = withAction({
  permission: "loan:read",
  effect: () => listLoans(),
})

export async function getCurrentUserRoleAction(): Promise<UserRole> {
  const session = await getSession()
  if (!session) return "unassigned" as UserRole
  return getUserRole(session)
}

/** Resolve an array of user IDs to a { [id]: name } map. */
export async function resolveUserNamesAction(userIds: string[]): Promise<Record<string, string>> {
  const session = await getSession()
  if (!session || userIds.length === 0) return {}
  const unique = [...new Set(userIds)]
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, unique))
  const map: Record<string, string> = {}
  for (const r of rows) map[r.id] = r.name
  return map
}

// Loan editing is permanently disabled to preserve system integrity.
// To change loan terms, issue a new loan (which can roll over the old one).
export const updateLoanAction = withAction<UpdateLoanInput, any>({
  permission: "loan:update",
  action: async () => {
    return { error: "Loan editing is disabled. Issue a new loan instead." }
  },
})

// Loan deletion is permanently disabled to preserve system integrity.
export const deleteLoanAction = withAction<DeleteLoanInput, any>({
  permission: "loan:update",
  action: async () => {
    return { error: "Loan deletion is disabled. Loans are permanent records." }
  },
})

// createLoanAction has complex multi-step validation and role-based branching that
// doesn't fit the wrapper cleanly -- keep inline auth.
export async function createLoanAction(input: CreateLoanInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("loan:create")) {
    return { error: "Forbidden" }
  }

  // Rollover requires loan:rollover permission
  if (input.rollover) {
    if (!perms.has("loan:rollover")) {
      return { error: "Only supervisors and above can perform loan rollovers" }
    }
  }

  if (!input.customerId?.trim()) {
    return { error: "Customer ID is required" }
  }
  const principalErr = validatePositiveDecimal(input.principalAmount, "Principal")
  if (principalErr) return { error: principalErr }
  if (!input.startDate?.trim()) {
    return { error: "Start date is required" }
  }

  // Backdate validation: compare start date to today using local date strings
  // to avoid UTC-shift bugs where new Date("2026-04-13") parses as UTC midnight
  // which can be a different calendar day in UTC+ timezones (BUG-10).
  const startDateStr = localDateString(new Date(input.startDate))
  const todayStr = localDateString(new Date())

  if (startDateStr > todayStr) {
    return { error: "Start date cannot be in the future" }
  }

  // Use date-only components to compute day difference, avoiding DST/timezone drift
  const [sy, sm, sd] = startDateStr.split("-").map(Number)
  const [ty, tm, td] = todayStr.split("-").map(Number)
  const startNoon = new Date(sy, sm - 1, sd, 12, 0, 0)
  const todayNoon = new Date(ty, tm - 1, td, 12, 0, 0)
  const daysDiff = Math.round((todayNoon.getTime() - startNoon.getTime()) / (1000 * 60 * 60 * 24))
  const isBackdated = daysDiff > 0

  if (isBackdated) {
    if (daysDiff > 3 && !perms.has("backdate:beyond-3-days")) {
      return { error: `Backdating beyond 3 days requires supervisor permission. You selected ${daysDiff} days ago.` }
    }
    if (!input.backdateNote?.trim()) {
      return { error: "A note is required when backdating a loan to explain the reason" }
    }
  }
  if (!input.collateral?.nature?.trim()) {
    return { error: "Collateral nature is required" }
  }
  const isRollover = !!input.rollover
  if (isRollover) {
    // Rollovers allow zero issuance fee (already paid on original loan)
    if (!input.issuanceFee?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.issuanceFee)) {
      return { error: "Issuance fee must be a valid decimal number" }
    }
  } else {
    const feeErr = validatePositiveDecimal(input.issuanceFee, "Issuance fee")
    if (feeErr) return { error: feeErr }
    if (parseFloat(input.issuanceFee) < 50000) {
      return { error: "Issuance fee must be at least 50,000 UGX" }
    }
  }
  if (!input.collateral?.description?.trim()) {
    return { error: "Collateral description is required" }
  }

  if (!input.disbursementSource || !VALID_DEPOSIT_LOCATIONS.includes(input.disbursementSource)) {
    return { error: "Disbursement source is required (cash, bank, or strong_room)" }
  }

  // Check sufficient funds at disbursement source (all locations including cash)
  // For rollovers, principalAmount is already the fresh cash portion (carried amounts are separate)
  const freshAmount = new BigNumber(input.principalAmount)

  if (freshAmount.isGreaterThan(0)) {
    try {
      const balances = await Effect.runPromise(getLocationBalances())
      const available = new BigNumber(balances[input.disbursementSource as keyof typeof balances])
      if (available.isLessThan(freshAmount)) {
        const loc = input.disbursementSource === "strong_room" ? "Strong Room" : input.disbursementSource === "bank" ? "Bank" : "Cash on Hand"
        const isLoanOfficer = !perms.has("fund-transfer:create")
        const action = isLoanOfficer
          ? "Ask your supervisor to transfer or inject funds before disbursing."
          : "Transfer or inject funds first."
        return { error: `Insufficient funds in ${loc}. Available: ${formatAmount(available)}, required: ${formatAmount(freshAmount)}. ${action}` }
      }
    } catch {
      return { error: "Unable to verify fund balances. Please try again." }
    }
  }

  // Loan officers cannot issue more than 4,000,000 UGX
  const MAX_LOAN_OFFICER_AMOUNT = 4_000_000
  if (role === "loanOfficer" && new BigNumber(input.principalAmount).isGreaterThan(MAX_LOAN_OFFICER_AMOUNT)) {
    return { error: `Loan officers cannot issue more than ${formatAmount(new BigNumber(MAX_LOAN_OFFICER_AMOUNT))} UGX. Request a supervisor to issue this loan.` }
  }

  // Validate loanType
  const loanType = input.loanType || "perpetual"
  if (!VALID_LOAN_TYPES.includes(loanType as any)) {
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

  if (!perms.has("settings:update")) {
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
      loanRef: `LOAN-${shortId(data.id).toUpperCase()}`,
      amount: input.principalAmount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "CustomerNotFound") {
      return { error: "Customer not found" }
    }
    if (getErrorTag(error) === "IncompleteLoanRequirements") {
      const missing = getErrorField(error, "missing") as string[] | undefined
      return {
        error: `Missing fields: ${missing?.join(", ") ?? "unknown"}`,
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

export const getCustomerLoansWithOverdueAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, customerId) => {
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
          subLocationId: loans.subLocationId,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          penaltyMultiplier: loans.penaltyMultiplier,
          penaltyWaived: loans.penaltyWaived,
          penaltyWaivedBy: loans.penaltyWaivedBy,
          penaltyWaivedAt: loans.penaltyWaivedAt,
          rolledOverFrom: loans.rolledOverFrom,
          rolloverAmount: loans.rolloverAmount,
          backdatedFrom: loans.backdatedFrom,
          backdatedBy: loans.backdatedBy,
          backdatedAt: loans.backdatedAt,
          backdateNote: loans.backdateNote,
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
  },
})

export const listLoansWithOverdueAction = withAction({
  permission: "loan:read",
  action: async () => {
    try {
      const allLoans = await Effect.runPromise(listLoans())
      return { data: await computeOverdue(allLoans) }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const exportLoansExcelAction = withAction<"all" | "critical" | "at-risk" | "early" | undefined, any>({
  permission: "reports:read",
  action: async (_session, filter) => {
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
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)
      return { data: base64 }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const listActiveLoansWithOverdueAction = withAction({
  permission: "loan:read",
  action: async () => {
    try {
      const allLoans = await Effect.runPromise(listLoans())
      const activeLoans = allLoans.filter((l) => l.status === "active")
      return { data: await computeOverdue(activeLoans) }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const waivePenaltyAction = withAction<string, any>({
  permission: "loan:update",
  forbiddenMessage: "Only admins can waive penalties",
  action: async (session, loanId) => {
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
  },
})

export async function adjustPenaltyMultiplierAction(loanId: string, multiplier: string) {
  return adjustPenaltyMultiplierWrapped({ loanId, multiplier })
}

const adjustPenaltyMultiplierWrapped = withAction<{ loanId: string; multiplier: string }, any>({
  permission: "loan:update",
  forbiddenMessage: "Only admins can adjust penalty rates",
  action: async (_session, { loanId, multiplier }) => {
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
  },
})
