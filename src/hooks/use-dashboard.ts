"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { getDashboardAction } from "@/actions/dashboard.actions"
import type { DashboardKPIs } from "@/types"

export interface DashboardData {
  kpis: DashboardKPIs
}

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: queryKeys.dashboard.kpis(),
    queryFn: async () => {
      const result = await getDashboardAction()
      return unwrapAction<DashboardData>(result as { data: DashboardData } | { error: string })
    },
  })
}
