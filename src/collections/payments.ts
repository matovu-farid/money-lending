"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
  markPaymentWrongAction,
  unmarkPaymentWrongAction,
  listAllPaymentsAction,
} from "@/actions/payment.actions"
import type {
  RecordPaymentInput,
  EditPaymentInput,
} from "@/types/payment"
import { paymentSchema, type PaymentRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { invalidateLendingProjections } from "@/lib/cache-invalidation"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

/**
 * Row shape synced via HTTP polling — mirrors the `payments` DB table after
 * `paymentSchema` coercion (date columns are coerced to `Date`).
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
  invalidateLendingProjections(qc)
  // Payment-specific extras beyond the shared lending set.
  qc.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
  qc.invalidateQueries({ queryKey: queryKeys.payments.portionsAll })
  // Fan out to subscribeToTableChanges consumers (dashboard, daily-collections, loan-extras location-balances, reports).
  emitTableChange("payments")
  emitTableChange("transactions")
  emitTableChange("loans")
}

export const paymentCollection = createCollection(
  queryCollectionOptions({
    id: "payments",
    schema: paymentSchema,
    getKey: (payment) => payment.id,
    queryKey: [...queryKeys.payments.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listAllPaymentsAction()).data
      return coerceDates(rows, ["paymentDate", "createdAt", "updatedAt", "deletedAt"])
    },
    staleTime: 30_000,
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
      throwIfActionError(await recordPaymentAction(input))
      invalidateCrossCutting(input.loanId)
      // Don't return txid: under polling the collection will refresh on the
      // next staleTime cycle; we don't need to await a specific transaction.
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes, metadata } = transaction.mutations[0]
      const loanId = (original as PaymentRow).loanId
      const meta = metadata as PaymentUpdateMetadata | undefined

      // Mark-wrong / unmark-wrong dispatch to dedicated server actions that
      // also reverse (or re-post) ledger journal entries — not a plain edit.
      if (meta?.intent === "mark-wrong") {
        const result = throwIfActionError(
          await markPaymentWrongAction(original.id, meta.reason),
        )
        invalidateCrossCutting(loanId)
        return { txid: result.txid }
      }

      if (meta?.intent === "unmark-wrong") {
        const result = throwIfActionError(
          await unmarkPaymentWrongAction(original.id),
        )
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
        editInput.paymentDate = changedDate.toISOString()
      }
      const result = throwIfActionError(await editPaymentAction(editInput))
      invalidateCrossCutting(loanId)
      return { txid: result.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original, metadata } = transaction.mutations[0]
      const meta = metadata as PaymentDeleteMetadata | undefined
      if (!meta?.reason) {
        throw new Error("Payment deletes must include metadata.reason")
      }
      const result = throwIfActionError(
        await deletePaymentAction({
          paymentId: original.id,
          reason: meta.reason,
        }),
      )
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
  return paymentCollection.insert(optimistic, {
    metadata: { input } satisfies PaymentInsertMetadata,
  })
}
