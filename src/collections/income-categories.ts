"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listIncomeCategoriesAction } from "@/actions/income.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

// Note: transaction_categories subscription is set up in expense-categories.ts
// (shared table, deduplicated by subscribeToTableChanges)

export type IncomeCategoryRow = {
  _key: string
  id: string
  name: string
  type: string
  isDefault: boolean
  createdAt: Date
}

export const incomeCategoryCollection = createCollection(
  queryCollectionOptions<IncomeCategoryRow>({
    queryKey: [...queryKeys.income.categories],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<IncomeCategoryRow>> => {
      const result = await listIncomeCategoriesAction()
      if ("error" in result) throw new Error(result.error)
      return result.data.map((cat, i) => ({
        _key: cat.id ?? `cat-${i}`,
        id: cat.id,
        name: cat.name,
        type: cat.type,
        isDefault: cat.isDefault,
        createdAt: cat.createdAt,
      }))
    },
    getKey: (row) => row._key,
  })
)
