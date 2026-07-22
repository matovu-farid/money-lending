"use client"

import { createCollection, BasicIndex } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listOperationalLoansAction } from "@/actions/loan.actions"
import { loanRowSchema, type LoanBaseRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

/**
 * Uncapped active-only loans for operational surfaces (watchlist, payment
 * pickers, overdue filters). Synced from listOperationalLoans — not the
 * 500-cap listLoans feed.
 *
 * Rows may carry server customerName/customerContact from the SQL join;
 * prefer those over customerCollection enrichment (R25-2).
 */
export type OperationalLoanRow = LoanBaseRow & {
  customerName?: string
  customerContact?: string | null
}

subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loans.operational,
])
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.loans.operational,
])

export const operationalLoanCollection = createCollection(
  queryCollectionOptions({
    id: "operational-loans",
    schema: loanRowSchema,
    getKey: (loan) => loan.id,
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    queryKey: [...queryKeys.loans.operational],
    queryClient: getQueryClient(),
    // Keep sync warm so rollover/settle write* on /loans/new (no live query
    // subscriber) does not hit SyncNotInitializedError (R25-1).
    startSync: true,
    queryFn: async () => {
      const rows = throwIfActionError(await listOperationalLoansAction())
        .data as OperationalLoanRow[]
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
  }),
)
