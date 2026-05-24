"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { creditorRepaymentSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError, shapeParser } from "@/lib/electric"

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
    shapeOptions: {
      url: shapeUrl("creditor_repayments"),
      columnMapper: snakeCamelMapper(),
      parser: shapeParser,
      onError: shapeOnError("creditor_repayments"),
    },
  })
)
