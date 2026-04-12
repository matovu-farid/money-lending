"use server"

import { Effect } from "effect"
import { getSession, getUserRole, requireRole, validatePositiveDecimal, validateRequired, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordPayment, editPayment, deletePayment, listPayments, searchActiveLoans, getRecentlyCollectedLoans, getLoanBalanceSummary } from "@/services/payment.service"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { eq, and, asc, isNull } from "drizzle-orm"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { RecordPaymentInput, EditPaymentInput, DeletePaymentInput, ListPaymentsInput } from "@/types"
import { sendAdminNotification } from "@/lib/email"
import { postJournalEntry, reverseInterestAccrual } from "@/services/transaction.service"
import { autoPostInterestEarned, autoPostPrincipalRepayment } from "@/services/auto-post.service"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger } from "@/services/ledger-queries.service"
import { allocatePayment } from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import { daysBetween } from "@/lib/db/utils"

export async function recordPaymentAction(input: RecordPaymentInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  const amountErr = validatePositiveDecimal(input.amount, "Amount")
  if (amountErr) return { error: amountErr }
  if (!input.paymentDate?.trim() || isNaN(Date.parse(input.paymentDate))) {
    return { error: "Payment date must be a valid date" }
  }

  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.depositLocation || !validLocations.includes(input.depositLocation)) {
    return { error: "Deposit location is required (cash, bank, or strong_room)" }
  }

  try {
    const data = await Effect.runPromise(recordPayment(input, session.user.id))
    revalidatePath(`/loans/${input.loanId}`)
    revalidatePath("/payments")
    void sendAdminNotification("payment.created", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${input.loanId.slice(0, 8).toUpperCase()}`,
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
}

export async function editPaymentAction(input: EditPaymentInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!input.paymentId?.trim()) {
    return { error: "Payment ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "A reason is required to edit a payment" }
  }

  // Permission check: must be own payment or admin+
  const role = getUserRole(session)
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
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
      loanRef: `LOAN-${data.loanId.slice(0, 8).toUpperCase()}`,
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
}

export async function deletePaymentAction(input: DeletePaymentInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!input.paymentId?.trim()) {
    return { error: "Payment ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "A reason is required to delete a payment" }
  }

  // Permission check: must be own payment or admin+
  const role = getUserRole(session)
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
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
      loanRef: `LOAN-${data.loanId.slice(0, 8).toUpperCase()}`,
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
}

export async function listPaymentsAction(input: ListPaymentsInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listPayments(input))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getPaymentsByLoanAction(loanId: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!loanId?.trim()) {
    return { error: "Loan ID is required" }
  }

  try {
    const rows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    return { data: rows }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function searchActiveLoansAction(query: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

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
}

export async function getRecentlyCollectedLoansAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getRecentlyCollectedLoans(session.user.id, 5))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getLoanBalanceAction(loanId: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!loanId?.trim()) {
    return { error: "Loan ID is required" }
  }

  try {
    const data = await getLoanBalanceSummary(loanId)
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function markPaymentWrongAction(paymentId: string, reason: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  // Permission check: supervisor+ only
  const forbidden = requireRole(session, "supervisor", "Only supervisors and above can mark payments as wrong")
  if (forbidden) return { error: forbidden }

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
}

export async function unmarkPaymentWrongAction(paymentId: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "supervisor", "Only supervisors and above can unmark payments")
  if (forbidden) return { error: forbidden }

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
      const monthlyRateDecimal = getBaseRate(loan)
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
      // (current ledger balance is wrong when this isn't the latest payment, since
      // later payments' journals are still active)
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
}

export async function getPaymentPortionsAction(paymentIds: string[]) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!paymentIds || paymentIds.length === 0) {
    return { data: {} as Record<string, { interestPortion: string; principalPortion: string }> }
  }

  try {
    const portions = await getPaymentPortionsFromLedger(paymentIds)
    return { data: Object.fromEntries(portions) }
  } catch {
    return { error: "Internal server error" }
  }
}
