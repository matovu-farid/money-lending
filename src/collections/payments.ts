"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
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
  DeletePaymentInput,
} from "@/types/payment"
import { getQueryClient } from "@/lib/query-client"

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
    queryKey: ["payments"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<PaymentWithCustomer>> => {
      const result = await listPaymentsAction({ page: 1, pageSize: 100 })
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
      pendingInsertInputs.delete(modified.id)
      const result = await recordPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const input = pendingUpdateInputs.get(original.id)
      if (!input) {
        throw new Error("Missing payment update input for optimistic update")
      }
      pendingUpdateInputs.delete(original.id)
      const result = await editPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const reason = pendingDeleteReasons.get(original.id)
      if (!reason) {
        throw new Error("Missing payment delete reason for optimistic delete")
      }
      pendingDeleteReasons.delete(original.id)
      const result = await deletePaymentAction({
        paymentId: original.id,
        reason,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
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
