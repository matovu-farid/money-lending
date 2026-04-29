"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listExpenseCategoriesAction } from "@/actions/expense.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Distinct user-typed expense category labels backing the combobox dropdown.
 * The list comes from `SELECT DISTINCT category FROM transactions WHERE
 * type='debit' AND category IS NOT NULL` (see
 * `listDistinctTransactionCategories`). Invalidated whenever a new expense is
 * recorded, so a freshly-typed name appears in the dropdown after one save.
 */
export type ExpenseCategoryRow = { name: string }

export const expenseCategoryCollection = createCollection(
  queryCollectionOptions<ExpenseCategoryRow>({
    queryKey: [...queryKeys.expenses.categories],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = (await listExpenseCategoriesAction()) as
        | { data: string[] }
        | { error: string }
      if ("error" in result) throw new Error(result.error)
      return result.data.map((name) => ({ name }))
    },
    getKey: (row) => row.name,
  })
)
