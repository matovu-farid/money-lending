"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
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
) {
  const collection = getActivitiesCollection(params, page)
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ a: collection }).select(({ a }) => a),
    [JSON.stringify(params), page]
  )
  const row = data?.[0]
  const result: GetActivitiesResult | undefined = row
    ? { items: row.items, total: row.total }
    : undefined
  return {
    data: result,
  }
}

export { ACTIVITIES_PAGE_SIZE }
