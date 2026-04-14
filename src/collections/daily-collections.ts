"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  getDailyCollectionsAction,
  getLoansDueTodayAction,
} from "@/actions/daily-collections.actions"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"
import { getQueryClient } from "@/lib/query-client"

// --- Daily collections by date (parameterized) ---

export type DailyCollectionsRow = DailyCollectionsSummary & { _key: string }

const dailyCollectionsMap = new Map<string, any>()

export function getDailyCollectionsCollection(date: string) {
  let collection = dailyCollectionsMap.get(date)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<DailyCollectionsRow>({
        queryKey: ["daily-collections", date],
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
    dailyCollectionsMap.set(date, collection)
  }
  return collection
}

// --- Loans due today (no params) ---

export type LoanDueTodayRow = LoanDueToday & { _key: string }

export const loansDueTodayCollection = createCollection(
  queryCollectionOptions<LoanDueTodayRow>({
    queryKey: ["loans-due-today"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanDueTodayRow>> => {
      const result = await getLoansDueTodayAction()
      const data = result as { data: LoanDueToday[] } | { error: string }
      if ("error" in data) throw new Error(data.error)
      return data.data.map((entry, i) => ({
        ...entry,
        _key: `due-${i}`,
      }))
    },
    getKey: (row) => row._key,
  })
)
