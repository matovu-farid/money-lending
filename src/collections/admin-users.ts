"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { authClient } from "@/lib/auth-client"
import { assignRole } from "@/actions/user.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { UserRole } from "@/types"

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean | null
  createdAt: Date | string
}

export const adminUserCollection = createCollection(
  queryCollectionOptions<AdminUser>({
    queryKey: [...queryKeys.adminUsers.list],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<AdminUser>> => {
      const result = await authClient.admin.listUsers({ query: { limit: 100 } })
      if (result.error) {
        throw new Error("Failed to load users")
      }
      const rawUsers = result.data?.users ?? []
      return rawUsers as AdminUser[]
    },
    getKey: (user) => user.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      if (changes.role !== undefined) {
        const result = await assignRole({ userId: original.id, role: changes.role as UserRole })
        if ("error" in result) throw new Error(result.error)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.auth.currentUserRole })
        qc.invalidateQueries({ queryKey: queryKeys.auth.effectivePermissions })
      }
    },
    // Auth-adjacent, no Electric backing. Short staleTime so admin views
    // pick up role changes / bans on next mount instead of waiting 60s.
    staleTime: 30_000,
  })
)
