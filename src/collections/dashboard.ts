"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { getDashboardAction, getDashboardActivityAction } from "@/actions/dashboard.actions"
import type { DashboardKPIs } from "@/types"
import { getQueryClient } from "@/lib/query-client"

export interface DashboardData {
  kpis: DashboardKPIs
}

export type DashboardRow = DashboardData & { _key: string }

export const dashboardCollection = createCollection(
  queryCollectionOptions<DashboardRow>({
    queryKey: ["dashboard", "kpis"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<DashboardRow>> => {
      const result = await getDashboardAction()
      const data = result as { data: DashboardData } | { error: string }
      if ("error" in data) throw new Error(data.error)
      return [{ ...data.data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
  })
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActivityItem = any

export type DashboardActivityRow = {
  _key: string
  items: ActivityItem[]
  total: number
}

export const dashboardActivityCollection = createCollection(
  queryCollectionOptions<DashboardActivityRow>({
    queryKey: ["dashboard", "activity"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<DashboardActivityRow>> => {
      const result = await getDashboardActivityAction() as { data: { items: ActivityItem[]; total: number } } | { error: string }
      if ("error" in result) throw new Error(result.error)
      return [{ ...result.data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
  })
)
