"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordIncomeAction,
  deleteIncomeAction,
} from "@/actions/income.actions"
import type { TransactionShapeRow, CreateTransactionInput } from "@/types"
import { shapeUrl } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateTransactionInput has fields
 * (categoryId, location, backdateNote, etc.) that aren't part of TransactionShapeRow.
 */
const pendingInsertInputs = new Map<string, CreateTransactionInput>()

export const incomeCollection = createCollection(
  electricCollectionOptions<TransactionShapeRow>({
    id: "income",
    getKey: (income) => income.id,
    shapeOptions: {
      url: shapeUrl("transactions"),
      params: {
        where: '"type" = \'credit\' AND "reference_type" IS NULL',
      },
      columnMapper: snakeCamelMapper(),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing income input for optimistic insert")
      }
      const result = await recordIncomeAction(input)
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

/**
 * Insert an income transaction with its full form input.
 * Call this instead of incomeCollection.insert() directly so the onInsert
 * handler can access the original CreateTransactionInput via the side-channel map.
 */
export function insertIncomeWithInput(
  id: string,
  optimistic: TransactionShapeRow,
  input: CreateTransactionInput
) {
  pendingInsertInputs.set(id, input)
  incomeCollection.insert(optimistic)
}
