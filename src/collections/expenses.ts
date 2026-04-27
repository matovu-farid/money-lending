"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordExpenseAction,
  deleteExpenseAction,
} from "@/actions/expense.actions"
import type {
  TransactionShapeRow,
  CreateTransactionInput,
  DepositLocation,
} from "@/types"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Extra context for the onInsert handler that isn't part of the
 * `TransactionShapeRow` (categoryName resolution, deposit location for the
 * cash leg, optional backdating note). Pass via TanStack DB's `metadata`:
 *
 *   expenseCollection.insert(optimisticRow, {
 *     metadata: { categoryName, location, subLocationId, backdateNote },
 *   })
 */
export interface ExpenseInsertMetadata {
  categoryName: string
  location: DepositLocation
  subLocationId?: string
  backdateNote?: string
}

/**
 * Side-channel cache: categoryId → categoryName for categories the server just
 * resolved/created. Populated from `recordExpenseAction`'s response so the
 * expenses page can render the right category name on the synced row even
 * before the `transaction_categories` shape pushes the new row.
 */
const recentCategoryNames = new Map<string, string>()
export function getRecentExpenseCategoryName(id: string): string | undefined {
  return recentCategoryNames.get(id)
}

export const expenseCollection = createCollection(
  electricCollectionOptions<TransactionShapeRow>({
    id: "expenses",
    getKey: (expense) => expense.id,
    shapeOptions: {
      url: shapeUrl("transactions"),
      // Electric 1.5.x rejects WHERE clauses on user-defined enum columns
      // (`transaction_type`). Sync the full table here and filter by
      // `type === "debit" && referenceType == null` in the live-query consumer.
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("transactions[expenses]"),
    },
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as ExpenseInsertMetadata | undefined
      if (!meta?.categoryName || !meta.location) {
        throw new Error("Missing expense metadata for optimistic insert")
      }
      const input: CreateTransactionInput = {
        id: modified.id,
        categoryName: meta.categoryName,
        amount: modified.amount,
        transactionDate: modified.transactionDate,
        notes: modified.description ?? undefined,
        location: meta.location,
        subLocationId: meta.subLocationId,
        backdateNote: meta.backdateNote,
      }
      const result = await recordExpenseAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      recentCategoryNames.set(result.resolvedCategory.id, result.resolvedCategory.name)
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
