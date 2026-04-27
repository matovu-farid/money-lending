"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { shapeUrl, shapeOnError } from "@/lib/electric"

export type IncomeCategoryRow = {
  id: string
  name: string
  type: string
  isDefault: boolean
  createdAt: string
}

export const incomeCategoryCollection = createCollection(
  electricCollectionOptions<IncomeCategoryRow>({
    id: "income-categories",
    getKey: (row) => row.id,
    shapeOptions: {
      url: shapeUrl("transaction_categories"),
      params: {
        where: `"type" = 'revenue'`,
      },
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("transaction_categories[revenue]"),
    },
  })
)
