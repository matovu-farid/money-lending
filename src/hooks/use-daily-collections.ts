"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { getDailyCollectionsCollection, loansDueTodayCollection } from "@/collections/daily-collections"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

// Date-keyed daily collections use a non-suspending query. Switching dates
// otherwise blanks the page on every change while the new date's data fetches.
export function useDailyCollections(date: string) {
  const collection = getDailyCollectionsCollection(date)
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ d: collection }).select(({ d }) => d),
    [date]
  )
  const row = data?.[0]
  // Strip the synthetic `_key` Electric uses to satisfy `getKey` requirements
  // (it's not part of the DailyCollectionsSummary contract).
  let summary: DailyCollectionsSummary | undefined
  if (row) {
    const { _key: _unused, ...rest } = row
    summary = rest
  }
  return { data: summary, isLoading }
}

export function useLoansDueToday() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ l: loansDueTodayCollection }).select(({ l }) => l)
  )
  const loans: LoanDueToday[] = (data ?? []).map(({ _key, ...rest }) => rest)
  return { data: loans, isLoading }
}
