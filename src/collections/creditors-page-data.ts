"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getCreditorsPageDataAction } from "@/actions/creditor.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { Creditor } from "@/types/creditor"

export type CreditorsPageDataRow = {
  _key: string
  creditors: Creditor[]
  capital: {
    totalInvested: string
    totalInterestAccrued: string
    totalRepaymentsMade: string
    totalOutstanding: string
  }
  monthlyDue: Record<string, string>
}

export const creditorsPageDataCollection = createCollection(
  queryCollectionOptions<CreditorsPageDataRow>({
    queryKey: [...queryKeys.creditors.all, "page-data"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<CreditorsPageDataRow>> => {
      const result = await getCreditorsPageDataAction()
      if ("error" in result) throw new Error(result.error)
      return [{ ...result.data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
  })
)
