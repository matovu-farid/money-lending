"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
} from "@/actions/payment.actions"
import type {
  RecordPaymentInput,
  EditPaymentInput,
  Payment,
} from "@/types/payment"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Row shape synced via Electric — mirrors the `payments` DB table after
 * snake_case → camelCase mapping. Server-only enrichments that used to live
 * on `PaymentWithCustomer` (customerName, recorderName, interest/principal
 * portions, balances) are NOT on this row. Consumers join them client-side:
 *   - customerId / customerName: loanCollection.customerId, loanCollection.customerName
 *   - interestPortion / principalPortion: getPaymentPortionsCollection(loanId, ids)
 *   - principalBalanceAfter: computed from running-balance map (already done in
 *     loan-detail-client.tsx)
 *   - recorderName: getUserNameMapCollection(recordedBy ids)
 */
export type PaymentRow = Payment

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because RecordPaymentInput has fields
 * (loanId, depositLocation, note, etc.) that aren't part of the Electric row
 * (no `customerId`/`customerName` on the row).
 */
const pendingInsertInputs = new Map<string, RecordPaymentInput>()

/**
 * Side-channel map for update reasons. The `reason` audit field isn't a column.
 */
const pendingUpdateInputs = new Map<string, EditPaymentInput>()

/**
 * Side-channel map for delete reasons. Same idea — `reason` isn't on the row.
 */
const pendingDeleteReasons = new Map<string, string>()

export const paymentCollection = createCollection(
  electricCollectionOptions<PaymentRow>({
    id: "payments",
    getKey: (payment) => payment.id,
    shapeOptions: {
      url: shapeUrl("payments"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("payments"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing payment input for optimistic insert")
      }
      const result = await recordPaymentAction(input)
      pendingInsertInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections (Electric handles payments/loans auto-refresh)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(input.loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
    },
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const input = pendingUpdateInputs.get(original.id)
      if (!input) {
        throw new Error("Missing payment update input for optimistic update")
      }
      const result = await editPaymentAction(input)
      pendingUpdateInputs.delete(original.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections
      const qc = getQueryClient()
      const loanId = (original as PaymentRow).loanId
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
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
      pendingDeleteReasons.delete(original.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections
      const qc = getQueryClient()
      const loanId = (original as PaymentRow).loanId
      qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
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
  optimistic: PaymentRow,
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
  applyOptimistic: (draft: PaymentRow) => void
) {
  pendingUpdateInputs.set(id, input)
  paymentCollection.update(id, (draft) => {
    applyOptimistic(draft as PaymentRow)
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
