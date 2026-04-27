"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
  markPaymentWrongAction,
  unmarkPaymentWrongAction,
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
 * Metadata shapes routed through the `metadata` parameter of
 * `collection.insert/update/delete`. The handler reads `mutation.metadata`
 * to decide which server action to dispatch and to recover audit reasons /
 * extra inputs that aren't part of the row schema.
 */
type PaymentInsertMetadata = {
  // The full RecordPaymentInput — carries `note`, `subLocationId`, etc.
  // that may differ from what's persisted on the row (or that the server
  // needs verbatim from the form).
  input: RecordPaymentInput
}

type PaymentUpdateMetadata =
  | { intent?: "edit"; reason: string }
  | { intent: "mark-wrong"; reason: string }
  | { intent: "unmark-wrong" }

type PaymentDeleteMetadata = { reason: string }

function invalidateCrossCutting(loanId: string) {
  const qc = getQueryClient()
  qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
  qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
  qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
  qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
  qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
}

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
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as PaymentInsertMetadata | undefined
      // The recordPaymentAction signature wants RecordPaymentInput. The form
      // passes that verbatim through metadata; if missing, fall back to
      // building it from the row (handles plain `collection.insert(row)` calls).
      const input: RecordPaymentInput = meta?.input ?? {
        id: modified.id,
        loanId: modified.loanId,
        paymentDate:
          modified.paymentDate instanceof Date
            ? modified.paymentDate.toISOString()
            : String(modified.paymentDate),
        amount: modified.amount,
        depositLocation: modified.depositLocation,
        subLocationId: modified.subLocationId ?? undefined,
      }
      const result = await recordPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      invalidateCrossCutting(input.loanId)
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes, metadata } = transaction.mutations[0]
      const loanId = (original as PaymentRow).loanId
      const meta = metadata as PaymentUpdateMetadata | undefined

      // Mark-wrong / unmark-wrong dispatch to dedicated server actions that
      // also reverse (or re-post) ledger journal entries — not a plain edit.
      if (meta?.intent === "mark-wrong") {
        const result = await markPaymentWrongAction(original.id, meta.reason)
        if ("error" in result && result.error) {
          throw new Error(result.error)
        }
        invalidateCrossCutting(loanId)
        return { txid: result.txid }
      }

      if (meta?.intent === "unmark-wrong") {
        const result = await unmarkPaymentWrongAction(original.id)
        if ("error" in result && result.error) {
          throw new Error(result.error)
        }
        invalidateCrossCutting(loanId)
        return { txid: result.txid }
      }

      // Plain payment edit (amount / date) — the audit reason rides through
      // metadata since it's not a column.
      if (!meta?.reason) {
        throw new Error("Payment edits must include metadata.reason")
      }
      const editInput: EditPaymentInput = {
        paymentId: original.id,
        reason: meta.reason,
      }
      const changedAmount = (changes as Partial<PaymentRow>).amount
      if (changedAmount !== undefined) editInput.amount = changedAmount
      const changedDate = (changes as Partial<PaymentRow>).paymentDate
      if (changedDate !== undefined) {
        editInput.paymentDate =
          changedDate instanceof Date ? changedDate.toISOString() : String(changedDate)
      }
      const result = await editPaymentAction(editInput)
      if ("error" in result) {
        throw new Error(result.error)
      }
      invalidateCrossCutting(loanId)
      return { txid: result.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original, metadata } = transaction.mutations[0]
      const meta = metadata as PaymentDeleteMetadata | undefined
      if (!meta?.reason) {
        throw new Error("Payment deletes must include metadata.reason")
      }
      const result = await deletePaymentAction({
        paymentId: original.id,
        reason: meta.reason,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
      invalidateCrossCutting((original as PaymentRow).loanId)
      return { txid: result.txid }
    },
  })
)

/**
 * Thin convenience wrapper for the new-payment forms. Equivalent to:
 *   paymentCollection.insert(optimistic, { metadata: { input } })
 * Kept because the form code passes the full RecordPaymentInput verbatim
 * (note, subLocationId, etc.) which the row alone can't fully represent.
 */
export function insertPaymentWithInput(
  _id: string,
  optimistic: PaymentRow,
  input: RecordPaymentInput,
) {
  paymentCollection.insert(optimistic, {
    metadata: { input } satisfies PaymentInsertMetadata,
  })
}
