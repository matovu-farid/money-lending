"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getDailyCollectionsAction,
  getLoansDueTodayAction,
} from "@/actions/daily-collections.actions"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { boundedSet } from "@/lib/bounded-map"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh daily collections when payments or loans change via Electric
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.dailyCollections.all,
  queryKeys.loans.dueToday,
])
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loans.dueToday,
])

// --- Daily collections by date (parameterized) ---

export type DailyCollectionsRow = DailyCollectionsSummary & { _key: string }

const MAX_DAILY_CACHED = 15

function createDailyCollection(date: string) {
  return createCollection(
    queryCollectionOptions<DailyCollectionsRow>({
      queryKey: [...queryKeys.dailyCollections.date(date)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<DailyCollectionsRow>> => {
        const result = await getDailyCollectionsAction(date)
        const data = result as { data: DailyCollectionsSummary } | { error: string }
        if ("error" in data) throw new Error(data.error)
        return [{ ...data.data, _key: "singleton" }]
      },
      getKey: (row) => row._key,
    })
  )
}

type DailyCollectionType = ReturnType<typeof createDailyCollection>
const dailyCollectionsMap = new Map<string, DailyCollectionType>()

export function getDailyCollectionsCollection(date: string) {
  let collection = dailyCollectionsMap.get(date)
  if (!collection) {
    collection = createDailyCollection(date)
    boundedSet(dailyCollectionsMap, date, collection, MAX_DAILY_CACHED)
  }
  return collection
}

// --- Loans due today (no params) ---

export type LoanDueTodayRow = LoanDueToday & { _key: string }

export const loansDueTodayCollection = createCollection(
  queryCollectionOptions<LoanDueTodayRow>({
    queryKey: [...queryKeys.loans.dueToday],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanDueTodayRow>> => {
      const result = await getLoansDueTodayAction()
      const data = result as { data: LoanDueToday[] } | { error: string }
      if ("error" in data) throw new Error(data.error)
      return data.data.map((entry) => ({
        ...entry,
        _key: entry.loanId,
      }))
    },
    getKey: (row) => row._key,
  })
)
