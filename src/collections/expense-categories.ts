"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listExpenseCategoriesAction } from "@/actions/expense.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export type ExpenseCategoryRow = {
  _key: string
  id: string
  name: string
  type: string
  isDefault: boolean
  createdAt: Date
}

export const expenseCategoryCollection = createCollection(
  queryCollectionOptions<ExpenseCategoryRow>({
    queryKey: [...queryKeys.expenses.categories],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<ExpenseCategoryRow>> => {
      const result = await listExpenseCategoriesAction()
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
