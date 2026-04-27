"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { dashboardCollection } from "@/collections/dashboard"
import type { DashboardKPIs } from "@/types"

export interface DashboardData {
  kpis: DashboardKPIs
}

export function useDashboard() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ d: dashboardCollection }).select(({ d }) => d)
  )
  const row = data?.[0]
  const dashboardData: DashboardData | undefined = row
    ? { kpis: row.kpis }
    : undefined
  return { data: dashboardData }
}
