"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { creditorInvestmentSchema } from "@/lib/schemas/collections"
import { electricShapeOptionsFor } from "@/lib/electric"

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
    shapeOptions: electricShapeOptionsFor("creditor_investments"),
  })
)
