"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getLoanBalanceAction } from "@/actions/payment.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export type LoanBalanceRow = {
  _key: string
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
}

function createLoanBalanceCollection(loanId: string) {
  return createCollection(
    queryCollectionOptions<LoanBalanceRow>({
      queryKey: [...queryKeys.loans.balance(loanId)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<LoanBalanceRow>> => {
        const result = await getLoanBalanceAction(loanId)
        if ("error" in result) throw new Error(result.error)
        return [{ ...result.data, _key: "singleton" }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type LoanBalanceCollectionType = ReturnType<typeof createLoanBalanceCollection>
const loanBalanceCollections = new Map<string, LoanBalanceCollectionType>()

const emptyLoanBalanceCollection = createCollection(
  queryCollectionOptions<LoanBalanceRow>({
    queryKey: [...queryKeys.loans.balance("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<LoanBalanceRow>> => [
      { _key: "singleton", outstandingPrincipal: "0", accruedInterest: "0", totalBalance: "0" },
    ],
    getKey: (row) => row._key,
  })
)

export function getLoanBalanceCollection(loanId: string) {
  if (!loanId) return emptyLoanBalanceCollection
  let collection = loanBalanceCollections.get(loanId)
  if (!collection) {
    collection = createLoanBalanceCollection(loanId)
    loanBalanceCollections.set(loanId, collection)
  }
  return collection
}
