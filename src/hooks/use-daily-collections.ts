"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { getDailyCollectionsCollection, loansDueTodayCollection } from "@/collections"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

export function useDailyCollections(date: string) {
  const collection = getDailyCollectionsCollection(date)
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ d: collection }).select(({ d }) => d),
    [date]
  )
  const row = data?.[0]
  const summary: DailyCollectionsSummary | undefined = row
    ? { ...row, _key: undefined } as unknown as DailyCollectionsSummary
    : undefined
  return { data: summary }
}

export function useLoansDueToday() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ l: loansDueTodayCollection }).select(({ l }) => l)
  )
  const loans: LoanDueToday[] = (data ?? []).map(({ _key, ...rest }) => rest)
  return { data: loans }
}
