"use client"

import { useQuery } from "@tanstack/react-query"
import {
  getDailyCollectionsAction,
  getLoansDueTodayAction,
} from "@/actions/daily-collections.actions"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

/**
 * Returns aggregated collections summary for a given YYYY-MM-DD date.
 * Query key includes date so TanStack Query refetches automatically when
 * the user navigates between dates.
 */
export function useDailyCollections(date: string) {
  return useQuery<DailyCollectionsSummary>({
    queryKey: ["daily-collections", date],
    queryFn: async () => {
      const result = await getDailyCollectionsAction(date)
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
  })
}

/**
 * Returns all active loans where the last payment (or start date) was 30+
 * days ago, sorted by daysSinceLastPayment descending.
 * staleTime of 5 minutes since this list doesn't change per-date.
 */
export function useLoansDueToday() {
  return useQuery<LoanDueToday[]>({
    queryKey: ["loans-due-today"],
    queryFn: async () => {
      const result = await getLoansDueTodayAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    staleTime: 5 * 60 * 1000,
  })
}
