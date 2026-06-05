"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  recordExpenseAction,
  deleteExpenseAction,
  listExpensesAction,
} from "@/actions/expense.actions"
import type {
  CreateTransactionInput,
  DepositLocation,
} from "@/types"
import type { TransactionRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { invalidateLedgerProjections } from "@/lib/cache-invalidation"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

/**
 * Extra context for the onInsert handler that isn't part of the synced
 * transaction row (cash-leg deposit location, optional bank sub-location,
 * optional backdating note). Pass via TanStack DB's `metadata`:
 *
 *   expenseCollection.insert(optimisticRow, {
 *     metadata: { location, subLocationId, backdateNote },
 *   })
 */
export interface ExpenseInsertMetadata {
  location: DepositLocation
  subLocationId?: string
  backdateNote?: string
}

export const expenseCollection = createCollection(
  queryCollectionOptions<TransactionRow>({
    id: "expenses",
    queryKey: [...queryKeys.expenses.all],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<TransactionRow[]> => {
      const result = throwIfActionError(await listExpensesAction())
      // Augment the JOIN-projected rows with nullable columns present in the
      // full schema (loanId, depositLocation, subLocationId, journalGroupId).
      // These are null for manual expense rows; needed so the row shape matches
      // TransactionRow and optimistic inserts typecheck correctly.
      const rows = result.data.data.map((row) => ({
        ...row,
        category: row.category ?? null,
        loanId: null,
        depositLocation: null,
        subLocationId: null,
        journalGroupId: null,
      }))
      return coerceDates(rows, ["transactionDate", "createdAt"])
    },
    getKey: (expense) => expense.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as ExpenseInsertMetadata | undefined
      if (!meta?.location) {
        throw new Error("Missing expense metadata for optimistic insert")
      }
      if (!modified.category) {
        throw new Error("Optimistic expense row is missing the category label")
      }
      const input: CreateTransactionInput = {
        id: modified.id,
        categoryName: modified.category,
        amount: modified.amount,
        transactionDate: modified.transactionDate.toISOString(),
        notes: modified.description ?? undefined,
        location: meta.location,
        subLocationId: meta.subLocationId,
        backdateNote: meta.backdateNote,
      }
      throwIfActionError(await recordExpenseAction(input))
      // Invalidate query-based collections (incl. distinct expense categories)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.expenses.all })
      qc.invalidateQueries({ queryKey: queryKeys.expenses.categories })
      invalidateLedgerProjections(qc)
      emitTableChange("transactions")
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      throwIfActionError(await deleteExpenseAction(original.id))
      // Invalidate query-based collections
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.expenses.all })
      qc.invalidateQueries({ queryKey: queryKeys.expenses.categories })
      invalidateLedgerProjections(qc)
      emitTableChange("transactions")
    },
  })
)
