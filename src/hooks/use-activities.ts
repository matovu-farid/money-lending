"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { getActivitiesCollection, ACTIVITIES_PAGE_SIZE } from "@/collections"
import type { GetActivitiesResult } from "@/types/activity"

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
  const collection = getActivitiesCollection(params, page)
  const { data, isLoading } = useLiveQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ a: collection as any }).select(({ a }: any) => a),
    [JSON.stringify(params), page]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (data as any)?.[0]
  const result: GetActivitiesResult | undefined = row
    ? { items: row.items, total: row.total }
    : undefined
  return {
    data: result,
    isLoading: enabled ? isLoading : false,
    isPlaceholderData: false,
    isError: false,
  }
}

export { ACTIVITIES_PAGE_SIZE }
