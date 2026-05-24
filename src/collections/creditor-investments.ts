"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { creditorInvestmentSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError, shapeParser } from "@/lib/electric"

/**
 * Electric-synced rows from `creditor_investments`. Reads only — investments
 * are created server-side by `addInvestmentAction` via the
 * `addInvestment` createOptimisticAction (see `creditor-actions.ts`), and the
 * Electric shape pushes the new row back automatically. No collection-level
 * onInsert/onUpdate/onDelete needed.
 */
export const creditorInvestmentCollection = createCollection(
  electricCollectionOptions({
    id: "creditor-investments",
    schema: creditorInvestmentSchema,
    getKey: (investment) => investment.id,
    shapeOptions: {
      url: shapeUrl("creditor_investments"),
      columnMapper: snakeCamelMapper(),
      parser: shapeParser,
      onError: shapeOnError("creditor_investments"),
    },
  })
)
