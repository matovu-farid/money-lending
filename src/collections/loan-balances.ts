"use client"

import { createCollection, BasicIndex } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listLoanBalancesAction } from "@/actions/loan.actions"
import { type LoanBalanceRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { throwIfActionError, coerceDates } from "./_utils"

export type { LoanBalanceRow }

/**
 * Read-only query collection over the `loan_balances` projection table.
 * The table is maintained by triggers in `drizzle/projections/loan_balances.sql`;
 * application code never writes to it directly. No onInsert/onUpdate/onDelete.
 *
 * This collection is invalidated by payments and loan mutations in their
 * respective onInsert/onUpdate/onDelete handlers via `queryKeys.loanBalances.all`.
 */
export const loanBalanceCollection = createCollection(
  queryCollectionOptions<LoanBalanceRow>({
    id: "loan_balances",
    getKey: (row) => row.loanId,
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    queryKey: [...queryKeys.loanBalances.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listLoanBalancesAction()).data
      return coerceDates(rows, ["lastPaymentDate", "updatedAt"])
    },
    staleTime: 30_000,
  }),
)
