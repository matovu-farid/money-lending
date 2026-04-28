"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getEffectivePermissionsAction } from "@/actions/user.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export type PermissionsRow = { _key: string; permissions: string[] }

export const permissionsCollection = createCollection(
  queryCollectionOptions<PermissionsRow>({
    queryKey: [...queryKeys.auth.effectivePermissions],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<PermissionsRow>> => {
      const permissions = await getEffectivePermissionsAction()
      return [{ _key: "singleton", permissions }]
    },
    getKey: (row) => row._key,
    // Auth-adjacent, no Electric backing. Short staleTime so revoked
    // permissions are picked up on the next mount within the tab.
    // Server enforces; this is UI freshness only.
    staleTime: 30_000,
  })
)
