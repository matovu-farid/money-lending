"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getDashboardAction, getDashboardActivityAction } from "@/actions/dashboard.actions"
import type { DashboardKPIs } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

// Auto-refresh dashboard when key tables change via Electric
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.dashboard.kpis,
  queryKeys.dashboard.activity,
])
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.dashboard.kpis,
  queryKeys.dashboard.activity,
])

export interface DashboardData {
  kpis: DashboardKPIs
}

export type DashboardRow = DashboardData & { _key: string }

export const dashboardCollection = createCollection(
  queryCollectionOptions<DashboardRow>({
    queryKey: [...queryKeys.dashboard.kpis],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<DashboardRow>> => {
      const { data } = throwIfActionError(
        (await getDashboardAction()) as
          | { data: DashboardData }
          | { error: string },
      )
      return [{ ...data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
  })
)

import type { ActivityItem } from "@/types/activity"
export type { ActivityItem }

export type DashboardActivityRow = {
  _key: string
  items: ActivityItem[]
  total: number
}

export const dashboardActivityCollection = createCollection(
  queryCollectionOptions<DashboardActivityRow>({
    queryKey: [...queryKeys.dashboard.activity],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<DashboardActivityRow>> => {
      const result = throwIfActionError(
        (await getDashboardActivityAction()) as
          | { data: { items: ActivityItem[]; total: number } }
          | { error: string },
      )
      return [
        {
          ...result.data,
          items: coerceDates(result.data.items, ["occurredAt"]),
          _key: "singleton",
        },
      ]
    },
    getKey: (row) => row._key,
  })
)
