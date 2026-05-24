"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordExpenseAction,
  deleteExpenseAction,
} from "@/actions/expense.actions"
import type {
  CreateTransactionInput,
  DepositLocation,
} from "@/types"
import { transactionSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError, shapeParser } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

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
  electricCollectionOptions({
    id: "expenses",
    schema: transactionSchema,
    getKey: (expense) => expense.id,
    shapeOptions: {
      url: shapeUrl("transactions"),
      // Electric 1.5.x rejects WHERE clauses on user-defined enum columns
      // (`transaction_type`). Sync the full table here and filter by
      // `type === "debit" && referenceType == null` in the live-query consumer.
      columnMapper: snakeCamelMapper(),
      parser: shapeParser,
      onError: shapeOnError("transactions[expenses]"),
    },
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
      const result = await recordExpenseAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate query-based collections (incl. distinct expense categories)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.expenses.categories })
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
      qc.invalidateQueries({ queryKey: queryKeys.expenses.categories })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
    },
  })
)
