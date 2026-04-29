"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listIncomeCategoriesAction } from "@/actions/income.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Distinct user-typed income category labels backing the combobox dropdown.
 * The list comes from `SELECT DISTINCT category FROM transactions WHERE
 * type='credit' AND category IS NOT NULL` (see
 * `listDistinctTransactionCategories`). Invalidated whenever a new income is
 * recorded, so a freshly-typed name appears in the dropdown after one save.
 */
export type IncomeCategoryRow = { name: string }

export const incomeCategoryCollection = createCollection(
  queryCollectionOptions<IncomeCategoryRow>({
    queryKey: [...queryKeys.income.categories],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = (await listIncomeCategoriesAction()) as
        | { data: string[] }
        | { error: string }
      if ("error" in result) throw new Error(result.error)
      return result.data.map((name) => ({ name }))
    },
    getKey: (row) => row.name,
  })
)
