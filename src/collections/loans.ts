"use client"

import { createCollection, BasicIndex } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  createLoanAction,
  waivePenaltyAction,
  adjustPenaltyMultiplierAction,
  listLoansAction,
} from "@/actions/loan.actions"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { CreateLoanInput } from "@/types/loan"
import { loanRowSchema, type LoanBaseRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"

/**
 * Row shape synced via HTTP polling — mirrors the `loans` DB table with
 * `loanRowSchema` coercion (timestamp columns are coerced to `Date`).
 *
 * Server-only enrichments (customerName, customerContact, outstandingBalance,
 * unpaidInterest, lastPaymentDate, daysOverdue, dailyRate) are NOT on this row.
 * Consumers read them via the `useLoansWithBalances` / `useLoanWithBalance`
 * hooks in `src/collections/loan-views.ts`, which join with
 * `customerCollection` and `loanBalanceCollection` and compute the
 * date-dependent fields client-side.
 */
export type LoanRow = LoanBaseRow

type LoanInsertMetadata = {
  intent: "create"
  input: CreateLoanInput
}

type LoanUpdateMetadata =
  | { intent: "settle"; reason: string }
  | { intent: "waive-penalty" }
  | { intent: "adjust-penalty"; multiplier: string }

export const loanCollection = createCollection(
  queryCollectionOptions({
    id: "loans",
    schema: loanRowSchema,
    getKey: (loan) => loan.id,
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    queryKey: [...queryKeys.loans.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listLoansAction()
      if ("error" in result) throw new Error(result.error)
      // listLoans returns LoanWithCustomer (includes customerName/customerContact);
      // the schema will coerce and pass through — extra fields are stripped by Zod.
      return result.data as LoanBaseRow[]
    },
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { metadata } = transaction.mutations[0]
      const meta = metadata as LoanInsertMetadata | undefined
      if (!meta?.input) {
        throw new Error("Loan inserts must include metadata.input (CreateLoanInput)")
      }
      const result = await createLoanAction(meta.input)
      if ("error" in result) throw new Error(result.error)
      // Cross-cutting invalidations for surfaces NOT yet projection-backed.
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.loanBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      // Fan out to subscribeToTableChanges consumers (dashboard, loan-status-counts, daily-collections, reports, loan-extras location-balances).
      emitTableChange("loans")
      emitTableChange("transactions")
    },
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
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loanBalances.all })
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
        emitTableChange("loans")
        emitTableChange("transactions")
        return { txid: result.txid }
      }

      if (meta.intent === "waive-penalty") {
        const result = await waivePenaltyAction(original.id)
        if ("error" in result) throw new Error(result.error)
        emitTableChange("loans")
        return { txid: result.txid }
      }

      if (meta.intent === "adjust-penalty") {
        const result = await adjustPenaltyMultiplierAction(original.id, meta.multiplier)
        if ("error" in result) throw new Error(result.error)
        emitTableChange("loans")
        return { txid: result.txid }
      }

      throw new Error(`Unknown loan update intent: ${(meta as { intent: string }).intent}`)
    },
  }),
)

/**
 * Thin wrapper kept because the call site needs to pass an off-row
 * `CreateLoanInput` (collateral, rollover, etc.) via the metadata channel.
 */
export function insertLoanWithInput(
  _id: string,
  optimistic: LoanRow,
  input: CreateLoanInput,
) {
  loanCollection.insert(optimistic, {
    metadata: { intent: "create", input } satisfies LoanInsertMetadata,
  })
}
