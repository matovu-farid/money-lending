"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { getActivitiesCollection, ACTIVITIES_PAGE_SIZE } from "@/collections/activities"
import type { GetActivitiesResult } from "@/types/activity"

export type ActivityFilterParams = {
  actorId: string
  entityType: string
  dateFrom: string
  dateTo: string
}

// Filter+page-keyed activities query is non-suspending: every filter change
// or page change creates a new collection that fetches from the server, and
// suspending would blank the activity list on each change.
export function useActivities(
  params: ActivityFilterParams,
  page: number,
) {
  const collection = getActivitiesCollection(params, page)
  const { data } = useLiveQuery(
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
