"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordIncomeAction,
  deleteIncomeAction,
} from "@/actions/income.actions"
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
 *   incomeCollection.insert(optimisticRow, {
 *     metadata: { categoryName, location, subLocationId, backdateNote },
 *   })
 */
export interface IncomeInsertMetadata {
  categoryName: string
  location: DepositLocation
  subLocationId?: string
  backdateNote?: string
}

const recentCategoryNames = new Map<string, string>()
export function getRecentIncomeCategoryName(id: string): string | undefined {
  return recentCategoryNames.get(id)
}

export const incomeCollection = createCollection(
  electricCollectionOptions<TransactionShapeRow>({
    id: "income",
    getKey: (income) => income.id,
    shapeOptions: {
      url: shapeUrl("transactions"),
      // Electric 1.5.x rejects WHERE clauses on user-defined enum columns
      // (`transaction_type`). Sync the full table here and filter by
      // `type === "credit" && referenceType == null` in the live-query consumer.
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("transactions[income]"),
    },
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as IncomeInsertMetadata | undefined
      if (!meta?.categoryName || !meta.location) {
        throw new Error("Missing income metadata for optimistic insert")
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
      const result = await recordIncomeAction(input)
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
      const result = await deleteIncomeAction(original.id)
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
