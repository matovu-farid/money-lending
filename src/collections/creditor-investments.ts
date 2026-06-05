"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listCreditorInvestmentsAction } from "@/actions/creditor.actions"
import { creditorInvestmentSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { throwIfActionError, coerceDates } from "./_utils"

/**
 * Query-polled rows from `creditor_investments`. Reads only — investments
 * are created server-side by `addInvestmentAction` via the
 * `addInvestment` createOptimisticAction (see `creditor-actions.ts`), which
 * also invalidates this collection's query key. No collection-level
 * onInsert/onUpdate/onDelete needed.
 */
export const creditorInvestmentCollection = createCollection(
  queryCollectionOptions({
    id: "creditor-investments",
    schema: creditorInvestmentSchema,
    queryKey: [...queryKeys.creditorInvestments.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listCreditorInvestmentsAction()).data
      return coerceDates(rows, ["investmentDate", "createdAt", "updatedAt"])
    },
    getKey: (investment) => investment.id,
    staleTime: 30_000,
  })
)
