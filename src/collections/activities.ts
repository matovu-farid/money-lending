"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getActivitiesAction } from "@/actions/activity.actions"
import type { GetActivitiesResult } from "@/types/activity"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { boundedSet } from "@/lib/bounded-map"

// Cap distinct (filter, page) combos kept alive at once. A user paging
// through filtered activity views can otherwise accumulate dozens of
// inactive collections; eviction tears down the underlying sync.
const MAX_ACTIVITIES_CACHED = 32

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
// Session-scoped cache: keyed by (params, page). Bounded by
// MAX_ACTIVITIES_CACHED — eviction calls collection.cleanup() so the
// underlying TanStack DB query observer is released.
const activitiesCollections = new Map<string, ActivitiesCollectionType>()

export function getActivitiesCollection(params: ActivityFilterParams, page: number) {
  const key = JSON.stringify({ params, page })
  let collection = activitiesCollections.get(key)
  if (!collection) {
    collection = createActivitiesCollection(params, page)
    boundedSet(
      activitiesCollections,
      key,
      collection,
      MAX_ACTIVITIES_CACHED,
      (c) => c.cleanup(),
    )
  }
  return collection
}
