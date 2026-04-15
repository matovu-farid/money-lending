"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listExpenseTransactionsAction,
  recordExpenseAction,
  deleteExpenseAction,
} from "@/actions/expense.actions"
import type { TransactionRow, CreateTransactionInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateTransactionInput has fields
 * (categoryId, location, backdateNote, etc.) that aren't part of TransactionRow.
 */
const pendingInsertInputs = new Map<string, CreateTransactionInput>()

export const expenseCollection = createCollection(
  queryCollectionOptions<TransactionRow>({
    queryKey: [...queryKeys.expenses.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<TransactionRow>> => {
      const result = await listExpenseTransactionsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data.data
    },
    getKey: (expense) => expense.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing expense input for optimistic insert")
      }
      const result = await recordExpenseAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingInsertInputs.delete(modified.id)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.monthlyDue })
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await deleteExpenseAction(original.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.monthlyDue })
    },
  })
)

/**
 * Insert an expense with its full form input.
 * Call this instead of expenseCollection.insert() directly so the onInsert
 * handler can access the original CreateTransactionInput via the side-channel map.
 */
export function insertExpenseWithInput(
  id: string,
  optimistic: TransactionRow,
  input: CreateTransactionInput
) {
  pendingInsertInputs.set(id, input)
  expenseCollection.insert(optimistic)
}
