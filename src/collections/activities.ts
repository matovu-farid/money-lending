"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getActivitiesAction } from "@/actions/activity.actions"
import type { GetActivitiesResult } from "@/types/activity"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export const ACTIVITIES_PAGE_SIZE = 25

export type ActivityFilterParams = {
  actorId: string
  entityType: string
  dateFrom: string
  dateTo: string
}

export type ActivitiesRow = GetActivitiesResult & { _key: string }

function createActivitiesCollection(params: ActivityFilterParams, page: number) {
  return createCollection(
    queryCollectionOptions<ActivitiesRow>({
      queryKey: [...queryKeys.activities.list(params, page)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<ActivitiesRow>> => {
        const input = {
          page,
          pageSize: ACTIVITIES_PAGE_SIZE,
          ...(params.actorId ? { actorId: params.actorId } : {}),
          ...(params.entityType ? { entityType: params.entityType } : {}),
          ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
          ...(params.dateTo ? { dateTo: params.dateTo } : {}),
        }
        const result = await getActivitiesAction(input)
        const data = result as { data: GetActivitiesResult } | { error: string }
        if ("error" in data) throw new Error(data.error)
        return [{ ...data.data, _key: "singleton" }]
      },
      getKey: (row) => row._key,
    })
  )
}

type ActivitiesCollectionType = ReturnType<typeof createActivitiesCollection>
// Session-scoped cache: keyed by (params, page). Entries persist for the
// lifetime of the page so back-navigation to a previously-visited filter/page
// combo serves cached results instantly (no server round-trip). The cache is
// bounded only by the set of distinct filter+page combos a user actually
// visits in one session, which is small in practice.
const activitiesCollections = new Map<string, ActivitiesCollectionType>()

export function getActivitiesCollection(params: ActivityFilterParams, page: number) {
  const key = JSON.stringify({ params, page })
  let collection = activitiesCollections.get(key)
  if (!collection) {
    collection = createActivitiesCollection(params, page)
    activitiesCollections.set(key, collection)
  }
  return collection
}
