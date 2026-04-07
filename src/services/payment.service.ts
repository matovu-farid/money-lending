import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { eq, asc, and, isNull, gte, lte, ilike, desc, count, sql } from "drizzle-orm"
import { DatabaseError, LoanNotFound, PaymentNotFound, ValidationError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { allocatePayment, calculateInterest, formatAmount } from "@/lib/interest/engine"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { autoPostInterestEarned, autoPostPrincipalRepayment, postJournalEntry, getLoanBalanceFromLedger, reverseInterestAccrual, getInterestEarnedFromLedger, getPaymentPortionsFromLedger } from "./transaction.service"
import BigNumber from "bignumber.js"
import { escapeLikePattern, daysBetween } from "@/lib/db/utils"
import type {
  RecordPaymentInput,
  EditPaymentInput,
  DeletePaymentInput,
  Payment,
  ListPaymentsInput,
  PaymentWithCustomer,
  ActiveLoanSearchResult,
  RecentlyCollectedLoan,
} from "@/types"

/**
 * Compute the current balance summary for a loan: outstanding principal,
 * accrued interest, and total balance. Single source of truth used by
 * both the payment recording page and the quick-record dialog.
 */
export async function getLoanBalanceSummary(loanId: string): Promise<{
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
  loanType: string
}> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new LoanNotFound({ id: loanId })

  const activePayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

  // Derive outstanding principal from the ledger (single source of truth)
  const ledgerBalance = await getLoanBalanceFromLedger(loanId)
  const outstandingPrincipal = ledgerBalance.isGreaterThan(0)
    ? ledgerBalance.toFixed(2)
    : loan.principalAmount  // Fallback for loans with no ledger entries yet

  const interestEarnedMap = await getInterestEarnedFromLedger([loanId])

  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const loanType = loan.loanType ?? "perpetual"

  // Use computeLoanOverdueInfo for consistent interest calculation
  const info = computeLoanOverdueInfo({
    principalAmount: loan.principalAmount,
    effectiveRate,
    startDate: new Date(loan.startDate),
    loanType: loanType as import("@/types").LoanType,
    termMonths: loan.termMonths,
    totalInterestPaid: formatAmount(interestEarnedMap.get(loanId) ?? new BigNumber(0)),
    paymentCount: activePayments.length,
    outstandingBalance: outstandingPrincipal,
  })

  const accruedInterest = info.unpaidInterest
  const totalBalance = new BigNumber(outstandingPrincipal).plus(new BigNumber(accruedInterest)).toFixed(2)

  return { outstandingPrincipal, accruedInterest, totalBalance, loanType }
}

export const recordPayment = (
  input: RecordPaymentInput,
  actorId: string
): Effect.Effect<Payment & { allocation: ReturnType<typeof allocatePayment> }, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [loan] = await tx.select().from(loans).where(eq(loans.id, input.loanId)).for('update')
        if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

        // L2: Reject zero or negative payment amounts
        if (new BigNumber(input.amount).isLessThanOrEqualTo(0)) {
          throw { _tag: "ValidationError", message: "Payment amount must be greater than zero", field: "amount" }
        }

        // L1: Reject payments dated before the loan start date
        if (new Date(input.paymentDate) < new Date(loan.startDate)) {
          throw { _tag: "ValidationError", message: "Payment date cannot be before loan start date", field: "paymentDate" }
        }

        const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
        const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
          .for('update')

        // Derive principalBalanceBefore from the ledger (single source of truth)
        const ledgerBalance = await getLoanBalanceFromLedger(input.loanId)
        const principalBalanceBefore = ledgerBalance.isGreaterThan(0)
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount

        const prevDate =
          activePayments.length === 0
            ? new Date(loan.startDate)
            : new Date(activePayments[activePayments.length - 1].paymentDate)
        const daysElapsed = daysBetween(prevDate, new Date(input.paymentDate))

        const loanType = loan.loanType ?? "perpetual"
        const paymentNumber = activePayments.length + 1

        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
          loanType,
          originalPrincipal: loan.principalAmount,
          termMonths: loan.termMonths ?? undefined,
          paymentNumber,
        })

        // M2: Reject overpayments that exceed total owed
        let totalOwed: BigNumber
        if (loanType === "fixed_rate") {
          // Fixed rate: remaining principal + all remaining term interest
          const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(monthlyRateDecimal))
          const remainingMonths = Math.max((loan.termMonths ?? 0) - paymentNumber + 1, 1)
          totalOwed = new BigNumber(principalBalanceBefore).plus(monthlyInterest.multipliedBy(remainingMonths))
        } else if (loanType === "reducing_balance") {
          // Reducing balance: remaining principal + current period interest
          const currentInterest = new BigNumber(principalBalanceBefore).multipliedBy(new BigNumber(monthlyRateDecimal))
          totalOwed = new BigNumber(principalBalanceBefore).plus(currentInterest)
        } else {
          // Perpetual: interest + principal (existing logic)
          totalOwed = new BigNumber(allocation.interestPortion).plus(new BigNumber(principalBalanceBefore))
        }
        if (new BigNumber(input.amount).isGreaterThan(totalOwed)) {
          throw {
            _tag: "ValidationError",
            message: `Payment amount ${input.amount} exceeds total owed ${formatAmount(totalOwed)}`,
            field: "amount",
          }
        }

        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            recordedBy: actorId,
            depositLocation: input.depositLocation,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "payment.create",
          entityType: "payment",
          entityId: newPayment.id,
          beforeValue: null,
          afterValue: newPayment,
        })

        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          // Reverse any outstanding interest accrual before posting cash-basis interest
          await reverseInterestAccrual(tx, {
            loanId: input.loanId,
            paymentDate: input.paymentDate,
            actorId,
          })
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
            depositLocation: input.depositLocation,
          })
        }

        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
            depositLocation: input.depositLocation,
          })
        }

        // Check fully-paid status from ledger after posting journals
        const postPaymentBalance = await getLoanBalanceFromLedger(input.loanId)
        if (postPaymentBalance.isZero()) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        }

        return { ...newPayment, allocation }
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      if (e?._tag === "ValidationError") return new ValidationError({ message: e.message, field: e.field })
      return new DatabaseError({ cause: e })
    },
  })

export const editPayment = (
  input: EditPaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId }

        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

        const newAmount = input.amount ?? payment.amount
        const newPaymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date(payment.paymentDate)

        // L2: Reject zero or negative payment amounts
        if (new BigNumber(newAmount).isLessThanOrEqualTo(0)) {
          throw { _tag: "ValidationError", message: "Payment amount must be greater than zero", field: "amount" }
        }

        // L1: Reject payments dated before the loan start date
        if (newPaymentDate < new Date(loan.startDate)) {
          throw { _tag: "ValidationError", message: "Payment date cannot be before loan start date", field: "paymentDate" }
        }

        // 1. Reverse old journals using ledger-derived portions
        const oldPortions = await getPaymentPortionsFromLedger([input.paymentId])
        const oldPortion = oldPortions.get(input.paymentId)

        if (oldPortion && new BigNumber(oldPortion.interestPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        if (oldPortion && new BigNumber(oldPortion.principalPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // 2. Update the payment row
        const beforeValue = { ...payment }
        const updates: {
          updatedAt: Date
          editReason: string
          amount?: string
          paymentDate?: Date
        } = {
          updatedAt: new Date(),
          editReason: input.reason,
        }
        if (input.amount !== undefined) updates.amount = input.amount
        if (input.paymentDate !== undefined)
          updates.paymentDate = new Date(input.paymentDate)

        await tx.update(payments).set(updates).where(eq(payments.id, input.paymentId))

        // 3. Recompute allocation with new amount/date
        const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
        const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays
        const loanType = loan.loanType ?? "perpetual"

        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const paymentIdx = activePayments.findIndex((p) => p.id === input.paymentId)
        const prevDate = paymentIdx === 0
          ? new Date(loan.startDate)
          : new Date(activePayments[paymentIdx - 1].paymentDate)
        const daysElapsed = daysBetween(prevDate, newPaymentDate)
        const paymentNumber = paymentIdx + 1

        // Get principalBalanceBefore from ledger (after reversals)
        const ledgerBalance = await getLoanBalanceFromLedger(payment.loanId)
        const principalBalanceBefore = ledgerBalance.isGreaterThan(0)
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount

        const allocation = allocatePayment({
          paymentAmount: newAmount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
          loanType,
          originalPrincipal: loan.principalAmount,
          termMonths: loan.termMonths ?? undefined,
          paymentNumber,
        })

        // M2: Reject overpayments that exceed total owed
        let totalOwed: BigNumber
        if (loanType === "fixed_rate") {
          const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(monthlyRateDecimal))
          const remainingMonths = Math.max((loan.termMonths ?? 0) - paymentNumber + 1, 1)
          totalOwed = new BigNumber(principalBalanceBefore).plus(monthlyInterest.multipliedBy(remainingMonths))
        } else if (loanType === "reducing_balance") {
          const currentInterest = new BigNumber(principalBalanceBefore).multipliedBy(new BigNumber(monthlyRateDecimal))
          totalOwed = new BigNumber(principalBalanceBefore).plus(currentInterest)
        } else {
          totalOwed = new BigNumber(allocation.interestPortion).plus(new BigNumber(principalBalanceBefore))
        }
        if (new BigNumber(newAmount).isGreaterThan(totalOwed)) {
          throw {
            _tag: "ValidationError",
            message: `Payment amount ${newAmount} exceeds total owed ${formatAmount(totalOwed)}`,
            field: "amount",
          }
        }

        // 4. Post new journals
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await reverseInterestAccrual(tx, {
            loanId: payment.loanId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
          })
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        // 5. Check fully-paid status via ledger
        const postEditBalance = await getLoanBalanceFromLedger(payment.loanId)
        if (postEditBalance.isZero()) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, payment.loanId))
        } else if (loan.status === "fully_paid") {
          await tx
            .update(loans)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(loans.id, payment.loanId))
        }

        const [updatedPayment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))

        await writeAuditLog(tx, {
          actorId,
          action: "payment.update",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue,
          afterValue: { ...updatedPayment, reason: input.reason },
        })

        return updatedPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      if (e?._tag === "ValidationError") return new ValidationError({ message: e.message, field: e.field })
      return new DatabaseError({ cause: e })
    },
  })

export const deletePayment = (
  input: DeletePaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId }

        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

        // 1. Get portions from ledger before soft-deleting
        const portions = await getPaymentPortionsFromLedger([input.paymentId])
        const portion = portions.get(input.paymentId)

        // 2. Soft-delete the payment
        const now = new Date()
        const softDeletedPayment = {
          ...payment,
          deletedAt: now,
          deletedBy: actorId,
          deleteReason: input.reason,
        }
        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(eq(payments.id, input.paymentId))

        await writeAuditLog(tx, {
          actorId,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue: payment,
          afterValue: softDeletedPayment,
        })

        // 3. Reverse journals using ledger-derived portions
        if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // 4. Check loan status via ledger
        const postDeleteBalance = await getLoanBalanceFromLedger(payment.loanId)
        if (postDeleteBalance.isZero() && loan.status !== "fully_paid") {
          // No balance remaining - shouldn't happen after delete but handle edge case
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: now })
            .where(eq(loans.id, payment.loanId))
        } else if (postDeleteBalance.isGreaterThan(0) && loan.status === "fully_paid") {
          await tx
            .update(loans)
            .set({ status: "active", updatedAt: now })
            .where(eq(loans.id, payment.loanId))
        }

        const [deletedRow] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        return deletedRow
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const listPayments = (
  input: ListPaymentsInput
): Effect.Effect<{ rows: PaymentWithCustomer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 25
      const offset = (page - 1) * pageSize

      const conditions = [isNull(payments.deletedAt)]
      if (input.dateFrom) conditions.push(gte(payments.paymentDate, new Date(input.dateFrom)))
      if (input.dateTo) conditions.push(lte(payments.paymentDate, new Date(input.dateTo + "T23:59:59.999Z")))
      if (input.amountMin) conditions.push(gte(payments.amount, input.amountMin))
      if (input.amountMax) conditions.push(lte(payments.amount, input.amountMax))
      if (input.customerName) conditions.push(ilike(customers.fullName, `%${escapeLikePattern(input.customerName)}%`))

      const where = and(...conditions)

      const [rows, [{ value: total }]] = await Promise.all([
        db
          .select({
            id: payments.id,
            loanId: payments.loanId,
            customerId: loans.customerId,
            customerName: customers.fullName,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
            recordedBy: payments.recordedBy,
            depositLocation: payments.depositLocation,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where)
          .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ value: count() })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where),
      ])

      return { rows: rows as PaymentWithCustomer[], total: Number(total) }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getPaymentsForLoan = (
  loanId: string
): Effect.Effect<Payment[], LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: loanId }

      return await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const searchActiveLoans = (
  query: string
): Effect.Effect<ActiveLoanSearchResult[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      if (!query || query.trim().length < 2) return []
      const rows = await db
        .select({
          loanId: loans.id,
          customerId: customers.id,
          customerName: customers.fullName,
          principalAmount: loans.principalAmount,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(
          and(
            eq(loans.status, "active"),
            isNull(loans.deletedAt),
            ilike(customers.fullName, `%${escapeLikePattern(query.trim())}%`)
          )
        )
        .limit(10)
      return rows
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getRecentlyCollectedLoans = (
  userId: string,
  limit: number = 5
): Effect.Effect<RecentlyCollectedLoan[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db.execute(sql`
        SELECT * FROM (
          SELECT DISTINCT ON (p.loan_id)
            p.loan_id,
            c.full_name AS customer_name,
            p.payment_date
          FROM payments p
          INNER JOIN loans l ON l.id = p.loan_id
          INNER JOIN customers c ON c.id = l.customer_id
          WHERE p.recorded_by = ${userId}
            AND p.deleted_at IS NULL
          ORDER BY p.loan_id, p.payment_date DESC
        ) sub
        ORDER BY sub.payment_date DESC
        LIMIT ${limit}
      `)
      return Array.from(rows).map((row: any) => ({
        loanId: row.loan_id as string,
        customerName: row.customer_name as string,
        paymentDate: new Date(row.payment_date as string),
      }))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
