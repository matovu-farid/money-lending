"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { listCreditorRepaymentsAction } from "@/actions/creditor.actions"
import { creditorRepaymentSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Query-polled rows from `creditor_repayments`. Reads only — repayments
 * are recorded server-side by `recordCreditorRepaymentAction` via the
 * `recordCreditorRepayment` createOptimisticAction (see `creditor-actions.ts`),
 * which also invalidates this collection's query key.
 */
export const creditorRepaymentCollection = createCollection(
  queryCollectionOptions({
    id: "creditor-repayments",
    schema: creditorRepaymentSchema,
    queryKey: [...queryKeys.creditorRepayments.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listCreditorRepaymentsAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    getKey: (repayment) => repayment.id,
    staleTime: 30_000,
  })
)
