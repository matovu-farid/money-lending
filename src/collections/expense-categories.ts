"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { shapeUrl } from "@/lib/electric"

export type ExpenseCategoryRow = {
  id: string
  name: string
  type: string
  isDefault: boolean
  createdAt: string
}

export const expenseCategoryCollection = createCollection(
  electricCollectionOptions<ExpenseCategoryRow>({
    id: "expense-categories",
    getKey: (row) => row.id,
    shapeOptions: {
      url: shapeUrl("transaction_categories"),
      params: {
        where: `"type" = 'expense'`,
      },
      columnMapper: snakeCamelMapper(),
    },
  })
)
