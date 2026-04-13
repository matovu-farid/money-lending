"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { getActivitiesAction } from "@/actions/activity.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { GetActivitiesResult } from "@/types/activity"

const PAGE_SIZE = 25

export type ActivityFilterParams = {
  actorId: string
  entityType: string
  dateFrom: string
  dateTo: string
}

export function useActivities(
  params: ActivityFilterParams,
  page: number,
  enabled = true,
) {
  return useQuery<GetActivitiesResult>({
    queryKey: queryKeys.activities.list(params, page),
    queryFn: async () => {
      const input = {
        page,
        pageSize: PAGE_SIZE,
        ...(params.actorId ? { actorId: params.actorId } : {}),
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
        ...(params.dateTo ? { dateTo: params.dateTo } : {}),
      }
      const result = await getActivitiesAction(input)
      return unwrapAction(result as { data: GetActivitiesResult } | { error: string })
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export { PAGE_SIZE as ACTIVITIES_PAGE_SIZE }
