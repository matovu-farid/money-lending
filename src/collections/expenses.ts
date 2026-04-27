"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordExpenseAction,
  deleteExpenseAction,
} from "@/actions/expense.actions"
import type { TransactionShapeRow, CreateTransactionInput } from "@/types"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateTransactionInput has fields
 * (categoryId, location, backdateNote, etc.) that aren't part of TransactionShapeRow.
 */
const pendingInsertInputs = new Map<string, CreateTransactionInput>()

export const expenseCollection = createCollection(
  electricCollectionOptions<TransactionShapeRow>({
    id: "expenses",
    getKey: (expense) => expense.id,
    shapeOptions: {
      url: shapeUrl("transactions"),
      params: {
        where: '"type" = \'debit\' AND "reference_type" IS NULL',
      },
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("transactions[expenses]"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing expense input for optimistic insert")
      }
      const result = await recordExpenseAction(input)
      pendingInsertInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await deleteExpenseAction(original.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
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
  optimistic: TransactionShapeRow,
  input: CreateTransactionInput
) {
  pendingInsertInputs.set(id, input)
  expenseCollection.insert(optimistic)
}
