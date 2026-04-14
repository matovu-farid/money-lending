"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { getActivitiesAction } from "@/actions/activity.actions"
import type { GetActivitiesResult } from "@/types/activity"
import { getQueryClient } from "@/lib/query-client"

export const ACTIVITIES_PAGE_SIZE = 25

export type ActivityFilterParams = {
  actorId: string
  entityType: string
  dateFrom: string
  dateTo: string
}

export type ActivitiesRow = GetActivitiesResult & { _key: string }

const activitiesCollections = new Map<string, any>()

export function getActivitiesCollection(params: ActivityFilterParams, page: number) {
  const key = JSON.stringify({ params, page })
  let collection = activitiesCollections.get(key)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<ActivitiesRow>({
        queryKey: ["activities", params, page],
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
    activitiesCollections.set(key, collection)
  }
  return collection
}
