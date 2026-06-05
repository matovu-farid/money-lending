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
import { invalidateLendingProjections } from "@/lib/cache-invalidation"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

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
      // listLoans returns LoanWithCustomer (includes customerName/customerContact);
      // we cast back to LoanBaseRow but keep the enriched fields on the row.
      const rows = throwIfActionError(await listLoansAction()).data as LoanBaseRow[]
      return coerceDates(rows, [
        "startDate",
        "penaltyWaivedAt",
        "backdatedFrom",
        "backdatedAt",
        "createdAt",
        "updatedAt",
        "deletedAt",
      ])
    },
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { metadata } = transaction.mutations[0]
      const meta = metadata as LoanInsertMetadata | undefined
      if (!meta?.input) {
        throw new Error("Loan inserts must include metadata.input (CreateLoanInput)")
      }
      throwIfActionError(await createLoanAction(meta.input))
      // Cross-cutting invalidations for surfaces NOT yet projection-backed.
      invalidateLendingProjections(getQueryClient())
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
        const result = throwIfActionError(
          await settleWithCollateralAction({
            loanId: original.id,
            reason: meta.reason,
          }),
        )
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
        const result = throwIfActionError(await waivePenaltyAction(original.id))
        emitTableChange("loans")
        return { txid: result.txid }
      }

      if (meta.intent === "adjust-penalty") {
        const result = throwIfActionError(
          await adjustPenaltyMultiplierAction(original.id, meta.multiplier),
        )
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
