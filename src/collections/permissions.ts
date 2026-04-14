"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { getEffectivePermissionsAction } from "@/actions/user.actions"
import { getQueryClient } from "@/lib/query-client"

export type PermissionsRow = { _key: string; permissions: string[] }

export const permissionsCollection = createCollection(
  queryCollectionOptions<PermissionsRow>({
    queryKey: ["effective-permissions"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<PermissionsRow>> => {
      const permissions = await getEffectivePermissionsAction()
      return [{ _key: "singleton", permissions }]
    },
    getKey: (row) => row._key,
  })
)
