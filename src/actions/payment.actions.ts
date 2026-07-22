"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getErrorTag, getSessionPermissions } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import {
  recordPaymentWithTxid,
  editPaymentWithTxid,
  deletePaymentWithTxid,
  listPayments,
  listAllPayments,
  searchActiveLoans,
  getRecentlyCollectedLoans,
  getLoanBalanceSummary,
  getActivePaymentById,
  listActivePaymentsByLoan,
  listPaymentsForLoanIds,
  markPaymentWrong,
  unmarkPaymentWrong,
} from "@/services/payment.service"
import {
  type RecordPaymentInput,
  type EditPaymentInput,
  type DeletePaymentInput,
  type ListPaymentsInput,
  type Payment,
  type PaymentWithCustomer,
  type ActiveLoanSearchResult,
} from "@/types"
import { VALID_DEPOSIT_LOCATIONS } from "@/lib/constants"
import { notifyAdmin, resolveLoanContext } from "@/lib/email"
import { getPaymentPortionsFromLedger } from "@/services/ledger-queries.service"

type RecordPaymentSuccess = Effect.Effect.Success<ReturnType<typeof recordPaymentWithTxid>>
type LoanBalanceSummary = Awaited<ReturnType<typeof getLoanBalanceSummary>>
type PaymentPortions = Record<string, { interestPortion: string; principalPortion: string }>
type PaymentMutationResult = { data: Payment; txid: number } | { error: string }

export const recordPaymentAction = withAction<
  RecordPaymentInput,
  { data: RecordPaymentSuccess["payment"]; txid: RecordPaymentSuccess["txid"] } | { error: string }
>({
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
      const { payment, txid } = await Effect.runPromise(recordPaymentWithTxid(input, session.user.id))
      revalidatePath(`/loans/${input.loanId}`)
      revalidatePath("/payments")
      notifyAdmin({
        eventType: "payment.created",
        context: resolveLoanContext(input.loanId),
        session,
        amount: input.amount,
      })
      return { data: payment, txid }
    } catch (error) {
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const editPaymentAction = withAction<EditPaymentInput, PaymentMutationResult>({
  permission: "payment:create",
  action: async (session, input) => {
    if (!input.paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }
    if (!input.reason?.trim()) {
      return { error: "A reason is required to edit a payment" }
    }

    // Permission check: must be own payment or have payment:edit-any
    const perms = await getSessionPermissions(session)
    if (!perms.has("payment:edit-any")) {
      const payment = await getActivePaymentById(input.paymentId)
      if (!payment) {
        return { error: "Payment not found" }
      }
      if (payment.recordedBy !== session.user.id) {
        return { error: "You can only edit your own payments" }
      }
    }

    try {
      const { payment, txid } = await Effect.runPromise(editPaymentWithTxid(input, session.user.id))
      revalidatePath(`/loans/${payment.loanId}`)
      revalidatePath("/payments")
      notifyAdmin({
        eventType: "payment.updated",
        context: resolveLoanContext(payment.loanId),
        session,
        amount: payment.amount,
      })
      return { data: payment, txid }
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

export const deletePaymentAction = withAction<DeletePaymentInput, PaymentMutationResult>({
  permission: "payment:create",
  action: async (session, input) => {
    if (!input.paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }
    if (!input.reason?.trim()) {
      return { error: "A reason is required to delete a payment" }
    }

    // Permission check: must be own payment or have payment:delete-any
    const perms = await getSessionPermissions(session)
    if (!perms.has("payment:delete-any")) {
      const payment = await getActivePaymentById(input.paymentId)
      if (!payment) {
        return { error: "Payment not found" }
      }
      if (payment.recordedBy !== session.user.id) {
        return { error: "You can only delete your own payments" }
      }
    }

    try {
      const { payment, txid } = await Effect.runPromise(deletePaymentWithTxid(input, session.user.id))
      revalidatePath(`/loans/${payment.loanId}`)
      revalidatePath("/payments")
      notifyAdmin({
        eventType: "payment.deleted",
        context: resolveLoanContext(payment.loanId),
        session,
        amount: payment.amount,
      })
      return { data: payment, txid }
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

export const listPaymentsAction = withAction<
  ListPaymentsInput,
  { rows: PaymentWithCustomer[]; total: number }
>({
  permission: "payment:read",
  effect: (_session, input) => listPayments(input),
})

export const getPaymentsByLoanAction = withAction<string, { data: Payment[] } | { error: string }>({
  permission: "payment:read",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) {
      return { error: "Loan ID is required" }
    }

    try {
      const rows = await listActivePaymentsByLoan(loanId)
      return { data: rows }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getPaymentsForLoanIdsAction = withAction<
  string[],
  { data: Payment[] } | { error: string }
>({
  permission: "payment:read",
  action: async (_session, loanIds) => {
    try {
      const rows = await listPaymentsForLoanIds(loanIds ?? [])
      return { data: rows }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const searchActiveLoansAction = withAction<
  string,
  { data: ActiveLoanSearchResult[] } | { error: string }
>({
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

export const getLoanBalanceAction = withAction<string, { data: LoanBalanceSummary } | { error: string }>({
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
  PaymentMutationResult
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
      const { updated, txid } = await markPaymentWrong(paymentId, reason, session.user.id)

      revalidatePath("/payments")
      revalidatePath(`/loans/${updated.loanId}`)

      return { data: updated, txid }
    } catch (e: unknown) {
      const tag = (e as { _tag?: string })?._tag
      if (tag === "PaymentNotFound") return { error: "Payment not found" }
      if (tag === "AlreadyMarkedWrong") return { error: "Payment is already marked as wrong" }
      if (tag === "ValidationError") {
        return { error: (e as { message?: string }).message ?? "Loan is not active" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const unmarkPaymentWrongAction = withAction<string, PaymentMutationResult>({
  permission: "payment:edit-any",
  forbiddenMessage: "Only supervisors and above can unmark payments",
  action: async (session, paymentId) => {
    if (!paymentId?.trim()) {
      return { error: "Payment ID is required" }
    }

    try {
      const { updated, txid } = await unmarkPaymentWrong(paymentId, session.user.id)

      revalidatePath("/payments")
      revalidatePath(`/loans/${updated.loanId}`)

      return { data: updated, txid }
    } catch (e: unknown) {
      const tag = (e as { _tag?: string })?._tag
      if (tag === "PaymentNotFound") return { error: "Payment not found" }
      if (tag === "LoanNotFound") return { error: "Loan not found" }
      if (tag === "NotMarkedWrong") return { error: "Payment is not marked as wrong" }
      if (tag === "ValidationError") {
        return { error: (e as { message?: string }).message ?? "Loan is not active" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const getPaymentPortionsAction = withAction<
  string[],
  { data: PaymentPortions } | { error: string }
>({
  permission: "payment:read",
  action: async (_session, paymentIds) => {
    if (!paymentIds || paymentIds.length === 0) {
      return { data: {} as PaymentPortions }
    }

    try {
      const portions = await getPaymentPortionsFromLedger(paymentIds)
      return { data: Object.fromEntries(portions) }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

/**
 * List all non-deleted raw payment rows for the paymentCollection.
 * Returns the same set of columns Electric was syncing from the `payments` table.
 */
export const listAllPaymentsAction = withAction({
  permission: "payment:read",
  effect: () => listAllPayments(),
})
