"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { getDailyCollectionsCollection, loansDueTodayCollection } from "@/collections"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

export function useDailyCollections(date: string) {
  const collection = getDailyCollectionsCollection(date)
  const { data, isLoading } = useLiveQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ d: collection as any }).select(({ d }: any) => d),
    [date]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (data as any)?.[0]
  const summary: DailyCollectionsSummary | undefined = row
    ? { ...row, _key: undefined } as unknown as DailyCollectionsSummary
    : undefined
  return { data: summary, isLoading, isError: false }
}

export function useLoansDueToday() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ l: loansDueTodayCollection }).select(({ l }) => l)
  )
  const loans: LoanDueToday[] = (data ?? []).map(({ _key, ...rest }) => rest)
  return { data: loans, isLoading, isError: false }
}
