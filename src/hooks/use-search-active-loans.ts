"use client"

import { useQuery } from "@tanstack/react-query"
import { searchActiveLoansAction } from "@/actions/payment.actions"
import { queryKeys } from "./query-keys"
import { useDebouncedValue } from "./use-debounced-value"
import type { ActiveLoanSearchResult } from "@/types"

export function useSearchActiveLoans(query: string) {
  const debouncedQuery = useDebouncedValue(query, 200)

  return useQuery<ActiveLoanSearchResult[]>({
    queryKey: queryKeys.loans.searchActive(debouncedQuery),
    queryFn: async () => {
      const result = await searchActiveLoansAction(debouncedQuery)
      if ("error" in result) return []
      return result.data.slice(0, 10)
    },
    enabled: debouncedQuery.trim().length >= 2,
  })
}
