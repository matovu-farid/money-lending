"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  recordIncomeAction,
  deleteIncomeAction,
} from "@/actions/income.actions"
import type {
  CreateTransactionInput,
  DepositLocation,
} from "@/types"
import { transactionSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/** Extra context for the onInsert handler that isn't part of the synced row. */
export interface IncomeInsertMetadata {
  location: DepositLocation
  subLocationId?: string
  backdateNote?: string
}

export const incomeCollection = createCollection(
  electricCollectionOptions({
    id: "income",
    schema: transactionSchema,
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
      if (!meta?.location) {
        throw new Error("Missing income metadata for optimistic insert")
      }
      if (!modified.category) {
        throw new Error("Optimistic income row is missing the category label")
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
      const result = await recordIncomeAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.income.categories })
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
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.income.categories })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
    },
  })
)
