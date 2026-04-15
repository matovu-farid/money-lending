"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listPaymentsAction,
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
} from "@/actions/payment.actions"
import type {
  PaymentWithCustomer,
  RecordPaymentInput,
  EditPaymentInput,
} from "@/types/payment"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because RecordPaymentInput has fields
 * (loanId, depositLocation, note, etc.) that aren't part of PaymentWithCustomer.
 */
const pendingInsertInputs = new Map<string, RecordPaymentInput>()

/**
 * Side-channel map for update reasons. The `reason` audit field isn't part of
 * PaymentWithCustomer, so we stash it here before calling collection.update().
 */
const pendingUpdateInputs = new Map<string, EditPaymentInput>()

/**
 * Side-channel map for delete reasons. Same idea — `reason` isn't on the row type.
 */
const pendingDeleteReasons = new Map<string, string>()

export const paymentCollection = createCollection(
  queryCollectionOptions<PaymentWithCustomer>({
    queryKey: [...queryKeys.payments.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<PaymentWithCustomer>> => {
      const result = await listPaymentsAction({ page: 1, pageSize: 10000 })
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data.rows
    },
    getKey: (payment) => payment.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing payment input for optimistic insert")
      }
      const result = await recordPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingInsertInputs.delete(modified.id)
      // Invalidate all derived data affected by a new payment
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(input.loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
      qc.invalidateQueries({ queryKey: queryKeys.loans.all })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
    },
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const input = pendingUpdateInputs.get(original.id)
      if (!input) {
        throw new Error("Missing payment update input for optimistic update")
      }
      const result = await editPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingUpdateInputs.delete(original.id)
      // Invalidate all derived data affected by a payment edit
      const qc = getQueryClient()
      const loanId = (original as PaymentWithCustomer).loanId
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
      qc.invalidateQueries({ queryKey: queryKeys.loans.all })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const reason = pendingDeleteReasons.get(original.id)
      if (!reason) {
        throw new Error("Missing payment delete reason for optimistic delete")
      }
      const result = await deletePaymentAction({
        paymentId: original.id,
        reason,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingDeleteReasons.delete(original.id)
      // Invalidate all derived data affected by a payment deletion
      const qc = getQueryClient()
      const loanId = (original as PaymentWithCustomer).loanId
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
      qc.invalidateQueries({ queryKey: queryKeys.loans.all })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
    },
  })
)

/**
 * Insert a payment with its full form input.
 * Call this instead of paymentCollection.insert() directly so the onInsert
 * handler can access the original RecordPaymentInput via the side-channel map.
 */
export function insertPaymentWithInput(
  id: string,
  optimistic: PaymentWithCustomer,
  input: RecordPaymentInput
) {
  pendingInsertInputs.set(id, input)
  paymentCollection.insert(optimistic)
}

/**
 * Update a payment with the full edit input (includes reason for audit).
 * Sets up the side-channel before calling collection.update().
 */
export function updatePaymentWithInput(
  id: string,
  input: EditPaymentInput,
  applyOptimistic: (draft: PaymentWithCustomer) => void
) {
  pendingUpdateInputs.set(id, input)
  paymentCollection.update(id, (draft) => {
    applyOptimistic(draft as PaymentWithCustomer)
  })
}

/**
 * Delete a payment with an audit reason.
 * Sets up the side-channel before calling collection.delete().
 */
export function deletePaymentWithReason(id: string, reason: string) {
  pendingDeleteReasons.set(id, reason)
  paymentCollection.delete(id)
}
