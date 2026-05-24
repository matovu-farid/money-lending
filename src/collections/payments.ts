"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
  markPaymentWrongAction,
  unmarkPaymentWrongAction,
} from "@/actions/payment.actions"
import { isErrorResult } from "@/lib/action-result"
import type {
  RecordPaymentInput,
  EditPaymentInput,
} from "@/types/payment"
import { paymentSchema, type PaymentRow } from "@/lib/schemas/collections"
import { electricShapeOptionsFor } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Row shape synced via Electric — mirrors the `payments` DB table after
 * snake_case → camelCase column-name mapping AND `electricDateParsers`
 * timestamp coercion at the wire layer (date columns arrive as ISO strings
 * from the Electric stream and are turned into `Date` objects before they
 * reach consumers). Note: `paymentSchema` is wired into the collection but
 * @tanstack/electric-db-collection only runs it for client-side mutations,
 * NOT for synced rows — so the parser is what makes Date work end-to-end.
 *
 * Server-only enrichments (customerName, recorderName, interest/principal
 * portions, balances) are NOT on this row. Consumers join them client-side:
 *   - customerId / customerName: loanCollection.customerId, loanCollection.customerName
 *   - interestPortion / principalPortion: getPaymentPortionsCollection(loanId, ids)
 *   - principalBalanceAfter: computed from running-balance map (already done in
 *     loan-detail-client.tsx)
 *   - recorderName: getUserNameMapCollection(recordedBy ids)
 */
export type { PaymentRow }

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

function invalidateCrossCutting(_loanId: string) {
  const qc = getQueryClient()
  qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
  qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
  qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
  qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
}

export const paymentCollection = createCollection(
  electricCollectionOptions({
    id: "payments",
    schema: paymentSchema,
    getKey: (payment) => payment.id,
    shapeOptions: electricShapeOptionsFor("payments"),
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as PaymentInsertMetadata | undefined
      // The recordPaymentAction signature wants RecordPaymentInput. The form
      // passes that verbatim through metadata; if missing, fall back to
      // building it from the row (handles plain `collection.insert(row)` calls).
      const input: RecordPaymentInput = meta?.input ?? {
        id: modified.id,
        loanId: modified.loanId,
        paymentDate: modified.paymentDate.toISOString(),
        amount: modified.amount,
        depositLocation: modified.depositLocation,
        subLocationId: modified.subLocationId ?? undefined,
      }
      const result = await recordPaymentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      invalidateCrossCutting(input.loanId)
      // Don't return txid: under flaky Electric replication the awaitTxId
      // wait will time out even though the server already wrote the row.
      // Reconciliation by id still works when the synced row arrives.
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes, metadata } = transaction.mutations[0]
      // `original` is already typed as PaymentRow via the collection schema —
      // no cast needed for `.loanId`.
      const loanId = original.loanId
      const meta = metadata as PaymentUpdateMetadata | undefined

      // Mark-wrong / unmark-wrong dispatch to dedicated server actions that
      // also reverse (or re-post) ledger journal entries — not a plain edit.
      if (meta?.intent === "mark-wrong") {
        const result = await markPaymentWrongAction(original.id, meta.reason)
        if (isErrorResult(result)) {
          throw new Error(result.error)
        }
        invalidateCrossCutting(loanId)
        return { txid: result.txid }
      }

      if (meta?.intent === "unmark-wrong") {
        const result = await unmarkPaymentWrongAction(original.id)
        if (isErrorResult(result)) {
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
      // `changes` is `ResolveTransactionChanges<PaymentRow, "update">` which
      // is a Partial-like view of PaymentRow; no cast needed.
      if (changes.amount !== undefined) editInput.amount = changes.amount
      if (changes.paymentDate !== undefined) {
        editInput.paymentDate = changes.paymentDate.toISOString()
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
      invalidateCrossCutting(original.loanId)
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
  return paymentCollection.insert(optimistic, {
    metadata: { input } satisfies PaymentInsertMetadata,
  })
}
