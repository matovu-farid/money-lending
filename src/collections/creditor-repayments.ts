"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { creditorRepaymentSchema } from "@/lib/schemas/collections"
import { electricShapeOptionsFor } from "@/lib/electric"

/**
 * Electric-synced rows from `creditor_repayments`. Reads only — repayments
 * are recorded server-side by `recordCreditorRepaymentAction` via the
 * `recordCreditorRepayment` createOptimisticAction (see `creditor-actions.ts`),
 * and the Electric shape pushes the new row back automatically.
 */
export const creditorRepaymentCollection = createCollection(
  electricCollectionOptions({
    id: "creditor-repayments",
    schema: creditorRepaymentSchema,
    getKey: (repayment) => repayment.id,
    shapeOptions: electricShapeOptionsFor("creditor_repayments"),
  })
)
