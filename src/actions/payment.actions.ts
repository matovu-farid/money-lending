"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole, getErrorTag, getEffectivePermissions } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { recordPayment, editPayment, deletePayment, listPayments, searchActiveLoans, getRecentlyCollectedLoans, getLoanBalanceSummary } from "@/services/payment.service"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { getBaseRate, getEffectiveRate } from "@/lib/interest/effective-rate"
import { eq, and, asc, isNull } from "drizzle-orm"
import { toLoanType, type RecordPaymentInput, type EditPaymentInput, type DeletePaymentInput, type ListPaymentsInput } from "@/types"
import { VALID_DEPOSIT_LOCATIONS } from "@/lib/constants"
import { shortId } from "@/lib/utils"
import { sendAdminNotification } from "@/lib/email"
import { postJournalEntry, reverseInterestAccrual } from "@/services/transaction.service"
import { autoPostInterestEarned, autoPostPrincipalRepayment } from "@/services/auto-post.service"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { allocatePayment, formatAmount } from "@/lib/interest/engine"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import BigNumber from "bignumber.js"
import { daysBetween } from "@/lib/db/utils"

export const recordPaymentAction = withAction<RecordPaymentInput, any>({
  permission: "payment:create",
  action: async (session, input) => {
    if (!input.loanId?.trim()) {
      return { error: "Loan ID is required" }
    }
    const amountErr = validatePositiveDecimal(input.amount, "Amount")
    if (amountErr) return { error: amountErr }
    if (!input.paymentDate?.trim() || isNaN(Date.parse(input.paymentDate))) {
      return { error: "Payment date must be a valid date" }
    }

    if (!input.depositLocation || !VALID_DEPOSIT_LOCATIONS.includes(input.depositLocation)) {
      return { error: "Deposit location is required (cash, bank, or strong_room)" }
    }
    if (input.depositLocation === "bank" && !input.subLocationId) {
      return { error: "Please select a bank account" }
    }

    try {
      const data = await Effect.runPromise(recordPayment(input, session.user.id))
      revalidatePath(`/loans/${input.loanId}`)
      revalidatePath("/payments")
      void sendAdminNotification("payment.created", {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        loanRef: `LOAN-${shortId(input.loanId).toUpperCase()}`,
        amount: input.amount,
        timestamp: new Date(),
      })
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const editPaymentAction = withAction<EditPaymentInput, any>({
  permission: "payment:create",
  action: async (session, input) => {
    if (!input.paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }
    if (!input.reason?.trim()) {
      return { error: "A reason is required to edit a payment" }
    }

    // Permission check: must be own payment or have payment:edit-any
    const role = getUserRole(session)
    const perms = await getEffectivePermissions(session.user.id, role)
    if (!perms.has("payment:edit-any")) {
      const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, input.paymentId), isNull(payments.deletedAt)))
      if (!payment) {
        return { error: "Payment not found" }
      }
      if (payment.recordedBy !== session.user.id) {
        return { error: "You can only edit your own payments" }
      }
    }

    try {
      const data = await Effect.runPromise(editPayment(input, session.user.id))
      revalidatePath(`/loans/${data.loanId}`)
      revalidatePath("/payments")
      void sendAdminNotification("payment.updated", {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        loanRef: `LOAN-${shortId(data.loanId).toUpperCase()}`,
        amount: data.amount,
        timestamp: new Date(),
      })
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "PaymentNotFound") {
        return { error: "Payment not found" }
      }
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const deletePaymentAction = withAction<DeletePaymentInput, any>({
  permission: "payment:create",
  action: async (session, input) => {
    if (!input.paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }
    if (!input.reason?.trim()) {
      return { error: "A reason is required to delete a payment" }
    }

    // Permission check: must be own payment or have payment:delete-any
    const role = getUserRole(session)
    const perms = await getEffectivePermissions(session.user.id, role)
    if (!perms.has("payment:delete-any")) {
      const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, input.paymentId), isNull(payments.deletedAt)))
      if (!payment) {
        return { error: "Payment not found" }
      }
      if (payment.recordedBy !== session.user.id) {
        return { error: "You can only delete your own payments" }
      }
    }

    try {
      const data = await Effect.runPromise(deletePayment(input, session.user.id))
      revalidatePath(`/loans/${data.loanId}`)
      revalidatePath("/payments")
      void sendAdminNotification("payment.deleted", {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        loanRef: `LOAN-${shortId(data.loanId).toUpperCase()}`,
        amount: data.amount,
        timestamp: new Date(),
      })
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "PaymentNotFound") {
        return { error: "Payment not found" }
      }
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const listPaymentsAction = withAction<ListPaymentsInput, any>({
  permission: "payment:read",
  effect: (_session, input) => listPayments(input),
})

export const getPaymentsByLoanAction = withAction<string, any>({
  permission: "payment:read",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) {
      return { error: "Loan ID is required" }
    }

    try {
      const rows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
      return { data: rows }
    } catch (error) {
      return { error: "Internal server error" }
    }
  },
})

export const searchActiveLoansAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, query) => {
    const trimmed = query?.trim() ?? ""
    if (!trimmed) {
      return { data: [] }
    }

    try {
      const data = await Effect.runPromise(searchActiveLoans(trimmed))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getRecentlyCollectedLoansAction = withAction({
  permission: "payment:read",
  effect: (session) => getRecentlyCollectedLoans(session.user.id, 5),
})

export const getLoanBalanceAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) {
      return { error: "Loan ID is required" }
    }

    try {
      const data = await getLoanBalanceSummary(loanId)
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

// markPaymentWrongAction and unmarkPaymentWrongAction have complex transaction logic.
// Using withAction for auth wrapper but keeping the complex body inline.

export async function markPaymentWrongAction(paymentId: string, reason: string) {
  return markPaymentWrongWrapped({ paymentId, reason })
}

const markPaymentWrongWrapped = withAction<
  { paymentId: string; reason: string },
  any
>({
  permission: "payment:edit-any",
  forbiddenMessage: "Only supervisors and above can mark payments as wrong",
  action: async (session, { paymentId, reason }) => {
    if (!paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }
    if (!reason?.trim()) {
      return { error: "A reason is required to mark a payment as wrong" }
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)))
        if (!payment) throw { _tag: "PaymentNotFound" }
        if (payment.markedWrong) throw { _tag: "AlreadyMarkedWrong" }

        const [updatedPayment] = await tx
          .update(payments)
          .set({
            markedWrong: true,
            markedWrongReason: reason.trim(),
            markedWrongBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, paymentId))
          .returning()

        // Derive portions from ledger (not cached columns)
        const portions = await getPaymentPortionsFromLedger([paymentId], tx)
        const portion = portions.get(paymentId)

        // Reverse interest journal entry
        if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: paymentId,
            description: `Reversal - payment ${paymentId} marked wrong: ${reason.trim()}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: session.user.id,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // Reverse principal journal entry
        if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: paymentId,
            description: `Reversal - principal repayment ${paymentId} marked wrong: ${reason.trim()}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: session.user.id,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // Check if loan should revert from fully_paid to active
        const ledgerBalance = await getLoanBalanceFromLedger(payment.loanId, undefined, tx)
        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (loan && loan.status === "fully_paid" && ledgerBalance.isGreaterThan(0)) {
          await tx
            .update(loans)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(loans.id, payment.loanId))
        }

        return updatedPayment
      })

      revalidatePath("/payments")
      revalidatePath(`/loans/${updated.loanId}`)

      return { data: updated }
    } catch (e: any) {
      if (e?._tag === "PaymentNotFound") return { error: "Payment not found" }
      if (e?._tag === "AlreadyMarkedWrong") return { error: "Payment is already marked as wrong" }
      return { error: "Internal server error" }
    }
  },
})

export const unmarkPaymentWrongAction = withAction<string, any>({
  permission: "payment:edit-any",
  forbiddenMessage: "Only supervisors and above can unmark payments",
  action: async (session, paymentId) => {
    if (!paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)))
        if (!payment) throw { _tag: "PaymentNotFound" }
        if (!payment.markedWrong) throw { _tag: "NotMarkedWrong" }

        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (!loan) throw { _tag: "LoanNotFound" }

        const [updatedPayment] = await tx
          .update(payments)
          .set({
            markedWrong: false,
            markedWrongReason: null,
            markedWrongBy: null,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, paymentId))
          .returning()

        // Recompute allocation from loan state to determine interest/principal portions
        const baseRate = getBaseRate(loan)
        const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays
        const loanType = loan.loanType ?? "perpetual"

        // Get all active (non-deleted, non-wrong) payments ordered by date to find position
        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const paymentIndex = activePayments.findIndex((p) => p.id === paymentId)
        const prevPayment = paymentIndex > 0 ? activePayments[paymentIndex - 1] : null
        const prevDate = prevPayment ? new Date(prevPayment.paymentDate) : new Date(loan.startDate)

        // Reconstruct principalBalanceBefore by walking prior payments' ledger portions
        let principalBalanceBefore = loan.principalAmount
        if (paymentIndex > 0) {
          const priorPaymentIds = activePayments.slice(0, paymentIndex).map((p) => p.id)
          const priorPortions = await getPaymentPortionsFromLedger(priorPaymentIds, tx)
          let runningBalance = new BigNumber(loan.principalAmount)
          for (const priorId of priorPaymentIds) {
            const pp = priorPortions.get(priorId)
            if (pp) runningBalance = runningBalance.minus(new BigNumber(pp.principalPortion))
          }
          if (runningBalance.isLessThan(0)) runningBalance = new BigNumber(0)
          principalBalanceBefore = runningBalance.toFixed(0)
        }
        const daysElapsed = daysBetween(prevDate, new Date(payment.paymentDate))

        // Compute penalty status as of the payment date (not today) to match recordPayment behavior
        const interestEarnedMap = await getInterestEarnedFromLedger([payment.loanId], tx)
        const overdueInfo = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType: toLoanType(loan.loanType),
          termMonths: loan.termMonths,
          totalInterestPaid: formatAmount(interestEarnedMap.get(payment.loanId) ?? new BigNumber(0)),
          paymentCount: activePayments.length,
          outstandingBalance: principalBalanceBefore,
          penaltyWaived: loan.penaltyWaived,
          loan,
          asOf: new Date(payment.paymentDate),
        })
        const monthlyRateDecimal = getEffectiveRate(loan, overdueInfo.penaltyActive)
        const paymentNumber = paymentIndex + 1

        const allocation = allocatePayment({
          paymentAmount: payment.amount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
          loanType,
          originalPrincipal: loan.principalAmount,
          termMonths: loan.termMonths ?? undefined,
          paymentNumber,
        })

        // Re-post interest earned journal entry
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await reverseInterestAccrual(tx, {
            loanId: payment.loanId,
            paymentDate: payment.paymentDate.toISOString(),
            actorId: session.user.id,
          })
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: payment.loanId,
            paymentId,
            paymentDate: payment.paymentDate.toISOString(),
            actorId: session.user.id,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        // Re-post principal repayment journal entry
        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: payment.loanId,
            paymentId,
            paymentDate: payment.paymentDate.toISOString(),
            actorId: session.user.id,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        // Check if loan should be marked fully_paid
        if (allocation.loanFullyPaid && loan.status !== "fully_paid") {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, payment.loanId))
        }

        return updatedPayment
      })

      revalidatePath("/payments")
      revalidatePath(`/loans/${updated.loanId}`)

      return { data: updated }
    } catch (e: any) {
      if (e?._tag === "PaymentNotFound") return { error: "Payment not found" }
      if (e?._tag === "LoanNotFound") return { error: "Loan not found" }
      if (e?._tag === "NotMarkedWrong") return { error: "Payment is not marked as wrong" }
      return { error: "Internal server error" }
    }
  },
})

export const getPaymentPortionsAction = withAction<string[], any>({
  permission: "payment:read",
  action: async (_session, paymentIds) => {
    if (!paymentIds || paymentIds.length === 0) {
      return { data: {} as Record<string, { interestPortion: string; principalPortion: string }> }
    }

    try {
      const portions = await getPaymentPortionsFromLedger(paymentIds)
      return { data: Object.fromEntries(portions) }
    } catch {
      return { error: "Internal server error" }
    }
  },
})
