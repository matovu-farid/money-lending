"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listLoansWithOverdueAction,
  createLoanAction,
  waivePenaltyAction,
  adjustPenaltyMultiplierAction,
} from "@/actions/loan.actions"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { LoanListEntry, CreateLoanInput } from "@/types/loan"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh when loans table changes via Electric
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loans.all,
  queryKeys.loans.dueToday,
])

/**
 * Metadata shape passed via `collection.insert(row, { metadata })` and
 * `collection.update(id, { metadata }, draft)`. The row schema only carries
 * persisted columns; everything else (creation-only fields like `collateral`,
 * action-routing intents like "settle"/"waive-penalty", and audit reasons)
 * goes through metadata so the handler can dispatch the right server action.
 */
type LoanInsertMetadata = {
  intent: "create"
  input: CreateLoanInput
}

type LoanUpdateMetadata =
  | { intent: "settle"; reason: string }
  | { intent: "waive-penalty" }
  | { intent: "adjust-penalty"; multiplier: string }

export const loanCollection = createCollection(
  queryCollectionOptions<LoanListEntry>({
    queryKey: [...queryKeys.loans.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanListEntry>> => {
      const result = await listLoansWithOverdueAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (loan) => loan.id,
    onUpdate: async ({ transaction }) => {
      const { original, metadata } = transaction.mutations[0]
      const meta = metadata as LoanUpdateMetadata | undefined
      if (!meta) {
        throw new Error("Loan updates must include metadata.intent")
      }

      if (meta.intent === "settle") {
        const result = await settleWithCollateralAction({
          loanId: original.id,
          reason: meta.reason,
        })
        if ("error" in result) throw new Error(result.error)
        // Invalidate only query-based collections (Electric handles loans auto-refresh)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
        return
      }

      if (meta.intent === "waive-penalty") {
        const result = await waivePenaltyAction(original.id)
        if ("error" in result) throw new Error(result.error)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.loans.balance(original.id) })
        return
      }

      if (meta.intent === "adjust-penalty") {
        const result = await adjustPenaltyMultiplierAction(
          original.id,
          meta.multiplier
        )
        if ("error" in result) throw new Error(result.error)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.loans.balance(original.id) })
        return
      }
    },
    onInsert: async ({ transaction }) => {
      const { metadata } = transaction.mutations[0]
      const meta = metadata as LoanInsertMetadata | undefined
      if (!meta?.input) {
        throw new Error("Loan inserts must include metadata.input (CreateLoanInput)")
      }
      const result = await createLoanAction(meta.input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate only query-based collections (Electric handles auto-refresh for table-backed ones)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
    },
  })
)

/**
 * Thin wrapper kept because the call site needs to pass an off-row
 * `CreateLoanInput` (collateral, rollover, etc.) via the metadata channel.
 * Equivalent to `loanCollection.insert(optimistic, { metadata: { intent: "create", input } })`.
 */
export function insertLoanWithInput(
  _id: string,
  optimistic: LoanListEntry,
  input: CreateLoanInput
) {
  loanCollection.insert(optimistic, {
    metadata: { intent: "create", input } satisfies LoanInsertMetadata,
  })
}
