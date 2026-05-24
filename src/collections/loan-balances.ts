"use client"

import { createCollection, BasicIndex } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { shapeUrl, shapeOnError, shapeParser } from "@/lib/electric"
import { loanBalanceSchema, type LoanBalanceRow } from "@/lib/schemas/collections"

export type { LoanBalanceRow }

/**
 * Read-only Electric collection over the `loan_balances` projection table.
 * The table is maintained by triggers in `drizzle/projections/loan_balances.sql`;
 * application code never writes to it directly. No onInsert/onUpdate/onDelete.
 */
export const loanBalanceCollection = createCollection(
  electricCollectionOptions({
    id: "loan_balances",
    schema: loanBalanceSchema,
    getKey: (row) => row.loanId,
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    shapeOptions: {
      url: shapeUrl("loan_balances"),
      columnMapper: snakeCamelMapper(),
      parser: shapeParser,
      onError: shapeOnError("loan_balances"),
    },
  }),
)
