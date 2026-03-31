"use client"

import { useQuery } from "@tanstack/react-query"
import {
  getDailyCollectionsAction,
  getLoansDueTodayAction,
} from "@/actions/daily-collections.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

export function useDailyCollections(date: string) {
  return useQuery<DailyCollectionsSummary>({
    queryKey: queryKeys.dailyCollections.byDate(date),
    queryFn: async () => {
      const result = await getDailyCollectionsAction(date)
      return unwrapAction(result as { data: DailyCollectionsSummary } | { error: string })
    },
    staleTime: 30_000,
  })
}

export function useLoansDueToday() {
  return useQuery<LoanDueToday[]>({
    queryKey: queryKeys.loansDueToday.all,
    queryFn: async () => {
      const result = await getLoansDueTodayAction()
      return unwrapAction(result as { data: LoanDueToday[] } | { error: string })
    },
    staleTime: 5 * 60 * 1000,
  })
}
