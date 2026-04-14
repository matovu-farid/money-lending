"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { listExpenseCategoriesAction } from "@/actions/expense.actions"
import { getQueryClient } from "@/lib/query-client"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExpenseCategoryRow = any & { _key: string }

export const expenseCategoryCollection = createCollection(
  queryCollectionOptions<ExpenseCategoryRow>({
    queryKey: ["expenses", "categories"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<ExpenseCategoryRow>> => {
      const result = await listExpenseCategoriesAction()
      if ("error" in result) throw new Error(result.error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result.data as any[]).map((cat: any, i: number) => ({
        ...cat,
        _key: cat.id ?? `cat-${i}`,
      }))
    },
    getKey: (row) => row._key,
  })
)
