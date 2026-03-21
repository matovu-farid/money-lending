import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, asc, and, isNull } from "drizzle-orm"
import { DatabaseError, LoanNotFound, PaymentNotFound } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { allocatePayment } from "@/lib/interest/engine"
import { autoPostInterestEarned } from "./transaction.service"
import BigNumber from "bignumber.js"
import type {
  RecordPaymentInput,
  EditPaymentInput,
  DeletePaymentInput,
  Payment,
} from "@/types"

/**
 * Computes integer calendar days between two dates.
 * Math.floor is acceptable for non-monetary integer day-count (Phase 1 decision).
 */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Replays allocatePayment() for each payment starting at fromIndex.
 * Each subsequent payment's principalBalanceBefore is the previous payment's principalBalanceAfter.
 * All updates happen inside the supplied transaction handle.
 *
 * CRITICAL: Must run inside a db.transaction() — no separate commits.
 * Pitfall 2: Payments must be in chronological order (payment_date ASC, created_at ASC).
 */
async function recalculateFromPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  loanId: string,
  fromIndex: number,
  orderedPayments: Payment[]
): Promise<void> {
  if (orderedPayments.length === 0 || fromIndex >= orderedPayments.length) return

  // Fetch the loan for rate/period overrides (needed for each step)
  const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) return

  const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

  // Walk from fromIndex to end, recalculating each payment
  for (let i = fromIndex; i < orderedPayments.length; i++) {
    const current = orderedPayments[i]

    // principalBalanceBefore: from prev payment's after, or loan's original principal if first
    let principalBalanceBefore: string
    if (i === 0) {
      principalBalanceBefore = loan.principalAmount
    } else {
      // We need the UPDATED value from the previous payment
      // After updating orderedPayments[i-1], get the fresh after value
      const prev = orderedPayments[i - 1]
      // If i > fromIndex, we've already updated the row — re-fetch updated value
      // But since we're in a transaction and updating orderedPayments array in place, use it
      principalBalanceBefore = prev.principalBalanceAfter
    }

    // daysElapsed: days since previous payment (or loan start if first)
    let prevDate: Date
    if (i === 0) {
      prevDate = new Date(loan.startDate)
    } else {
      prevDate = new Date(orderedPayments[i - 1].paymentDate)
    }
    const daysElapsed = daysBetween(prevDate, new Date(current.paymentDate))

    const allocation = allocatePayment({
      paymentAmount: current.amount,
      principalBalanceBefore,
      monthlyRateDecimal,
      daysElapsed,
      minInterestDays,
    })

    // Update the payment row in DB
    await tx
      .update(payments)
      .set({
        interestPortion: allocation.interestPortion,
        principalPortion: allocation.principalPortion,
        principalBalanceBefore: allocation.principalBalanceBefore,
        principalBalanceAfter: allocation.principalBalanceAfter,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, current.id))

    // Update in-memory record for next iteration
    orderedPayments[i] = {
      ...current,
      interestPortion: allocation.interestPortion,
      principalPortion: allocation.principalPortion,
      principalBalanceBefore: allocation.principalBalanceBefore,
      principalBalanceAfter: allocation.principalBalanceAfter,
    }
  }
}

/**
 * Records a new payment for a loan.
 * - Fetches loan, determines prior balance and days elapsed
 * - Allocates payment interest-first via allocatePayment()
 * - Transitions loan status: pending -> active, or active -> fully_paid
 * - Writes audit log inside the same transaction (Pitfall 7 pattern)
 *
 * LOAN-06: Manual payment recording.
 * LOAN-08: Interest-first allocation.
 * LOAN-09: Any amount accepted.
 */
export const recordPayment = (
  input: RecordPaymentInput,
  actorId: string
): Effect.Effect<Payment, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch loan
      const [loan] = await db.select().from(loans).where(eq(loans.id, input.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
      const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

      return await db.transaction(async (tx) => {
        // Fetch active payments ordered chronologically (Pitfall 3: exclude soft-deleted)
        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Determine principalBalanceBefore (Pitfall 1: use last payment's after, not loan age)
        const principalBalanceBefore =
          activePayments.length === 0
            ? loan.principalAmount
            : activePayments[activePayments.length - 1].principalBalanceAfter

        // Determine daysElapsed since last payment (or loan start if first)
        const prevDate =
          activePayments.length === 0
            ? new Date(loan.startDate)
            : new Date(activePayments[activePayments.length - 1].paymentDate)
        const daysElapsed = daysBetween(prevDate, new Date(input.paymentDate))

        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
        })

        // Insert payment row
        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
          })
          .returning()

        // Loan status transitions (Pitfall 6: pending -> active on first payment)
        if (allocation.loanFullyPaid) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        } else if (loan.status === "pending") {
          await tx
            .update(loans)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        }

        // INFR-01: Audit log in same transaction (NOT Effect.runPromise — see Pitfall 7)
        await writeAuditLog(tx, {
          actorId,
          action: "payment.create",
          entityType: "payment",
          entityId: newPayment.id,
          beforeValue: null,
          afterValue: newPayment,
        })

        // Auto-post interest earned to transaction log (FINC-01)
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: input.loanId,
            paymentDate: input.paymentDate,
            actorId,
          })
        }

        return newPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Edits an existing payment (amount and/or date).
 * Triggers recalculation cascade for all subsequent payments.
 * Requires a reason for the audit log.
 *
 * LOAN-07: Payment edit with audit log and cascade recalculation.
 */
export const editPayment = (
  input: EditPaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch payment (must exist and not be soft-deleted)
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
      if (!payment || payment.deletedAt !== null)
        throw { _tag: "PaymentNotFound", id: input.paymentId }

      // Fetch loan
      const [loan] = await db.select().from(loans).where(eq(loans.id, payment.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

      const beforeValue = { ...payment }

      return await db.transaction(async (tx) => {
        // Apply field updates
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

        // Fetch all active payments for recalculation
        const allActive = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Find the index of the edited payment
        const paymentIndex = allActive.findIndex((p) => p.id === input.paymentId)

        if (paymentIndex !== -1) {
          // Recalculate from this payment forward
          await recalculateFromPayment(tx, payment.loanId, paymentIndex, allActive)
        }

        // Re-fetch allActive to check final balance
        const refreshed = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Update loan status based on final balance
        if (refreshed.length > 0) {
          const lastBalance = refreshed[refreshed.length - 1].principalBalanceAfter
          if (lastBalance === "0.00" || lastBalance === "0") {
            await tx
              .update(loans)
              .set({ status: "fully_paid", updatedAt: new Date() })
              .where(eq(loans.id, payment.loanId))
          } else if (loan.status === "fully_paid") {
            // Was fully paid but no longer is after edit
            await tx
              .update(loans)
              .set({ status: "active", updatedAt: new Date() })
              .where(eq(loans.id, payment.loanId))
          }
        }

        // Fetch the updated payment row
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

        // Clean up old auto-posted interest transaction and re-post with updated interest
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.referenceType, "payment"),
              eq(transactions.referenceId, payment.loanId)
            )
          )

        const newInterestPortion = updatedPayment.interestPortion
        if (new BigNumber(newInterestPortion).isGreaterThan(0)) {
          await autoPostInterestEarned(tx, {
            amount: newInterestPortion,
            loanId: payment.loanId,
            paymentDate: updatedPayment.paymentDate.toISOString(),
            actorId,
          })
        }

        return updatedPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Soft-deletes a payment (sets deleted_at, deleted_by, delete_reason).
 * NEVER hard deletes. Triggers recalculation cascade for subsequent payments.
 * Requires a reason for the audit log.
 *
 * LOAN-07: Soft delete with audit and cascade recalculation.
 */
export const deletePayment = (
  input: DeletePaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch payment (must exist and not already be soft-deleted)
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
      if (!payment || payment.deletedAt !== null)
        throw { _tag: "PaymentNotFound", id: input.paymentId }

      // Fetch loan
      const [loan] = await db.select().from(loans).where(eq(loans.id, payment.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

      const now = new Date()
      const softDeletedPayment = {
        ...payment,
        deletedAt: now,
        deletedBy: actorId,
        deleteReason: input.reason,
      }

      return await db.transaction(async (tx) => {
        // Soft delete: set deleted_at, deleted_by, delete_reason (NEVER hard delete)
        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(eq(payments.id, input.paymentId))

        // Fetch remaining active payments (excluding the just-deleted one)
        const remainingActive = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Find index of the deleted payment to know where to start recalculation
        // We recalculate from the payment that now occupies the position after deletion
        // Find first payment that came after the deleted one
        const deletedDate = new Date(payment.paymentDate).getTime()
        const fromIndex = remainingActive.findIndex(
          (p) => new Date(p.paymentDate).getTime() >= deletedDate
        )
        const startIndex = fromIndex === -1 ? 0 : fromIndex

        if (remainingActive.length > 0 && startIndex < remainingActive.length) {
          await recalculateFromPayment(tx, payment.loanId, startIndex, remainingActive)
        }

        // Refresh to check final balance
        const refreshed = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Update loan status based on final balance
        if (refreshed.length === 0) {
          // No active payments remain — revert to pending
          await tx
            .update(loans)
            .set({ status: "pending", updatedAt: now })
            .where(eq(loans.id, payment.loanId))
        } else {
          const lastBalance = refreshed[refreshed.length - 1].principalBalanceAfter
          if (lastBalance === "0.00" || lastBalance === "0") {
            await tx
              .update(loans)
              .set({ status: "fully_paid", updatedAt: now })
              .where(eq(loans.id, payment.loanId))
          } else if (loan.status === "fully_paid") {
            await tx
              .update(loans)
              .set({ status: "active", updatedAt: now })
              .where(eq(loans.id, payment.loanId))
          }
        }

        await writeAuditLog(tx, {
          actorId,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue: payment,
          afterValue: softDeletedPayment,
        })

        // Delete auto-posted interest transaction for this payment (referenceType="payment", referenceId=loanId)
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.referenceType, "payment"),
              eq(transactions.referenceId, payment.loanId)
            )
          )

        // Return the soft-deleted payment row
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

/**
 * Fetches ALL payments for a loan (including soft-deleted).
 * Soft-deleted rows are shown in the UI with strikethrough.
 * Ordered by payment_date ASC, created_at ASC.
 *
 * LOAN-07: UI display of all payment history including deletions.
 */
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
        .where(eq(payments.loanId, loanId))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
