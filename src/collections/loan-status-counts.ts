"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getLoanStatusCountsAction } from "@/actions/loan.actions"
import type { LoanStatus } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/table-events"

// Auto-refresh status counts when the loans table changes via Electric
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loanStatusCounts.all,
])

export type LoanStatusCountsRow = {
  _key: string
  counts: Record<LoanStatus, number>
}

export const loanStatusCountsCollection = createCollection(
  queryCollectionOptions<LoanStatusCountsRow>({
    queryKey: [...queryKeys.loanStatusCounts.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanStatusCountsRow>> => {
      const result = await getLoanStatusCountsAction()
      if ("error" in result) throw new Error(result.error)
      return [{ _key: "singleton", counts: result.data }]
    },
    getKey: (row) => row._key,
  })
)
