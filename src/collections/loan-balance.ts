"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { getLoanBalanceAction } from "@/actions/payment.actions"
import { getQueryClient } from "@/lib/query-client"

export type LoanBalanceRow = {
  _key: string
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
}

const loanBalanceCollections = new Map<string, any>()

export function getLoanBalanceCollection(loanId: string) {
  let collection = loanBalanceCollections.get(loanId)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<LoanBalanceRow>({
        queryKey: ["loans", loanId, "balance"],
        queryClient: getQueryClient(),
        queryFn: async (_ctx): Promise<Array<LoanBalanceRow>> => {
          const result = await getLoanBalanceAction(loanId)
          if ("error" in result) throw new Error(result.error)
          return [{ ...result.data, _key: "singleton" }]
        },
        getKey: (row) => row._key,
      })
    )
    loanBalanceCollections.set(loanId, collection)
  }
  return collection
}
