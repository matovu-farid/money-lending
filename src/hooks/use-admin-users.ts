"use client"

import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { queryKeys } from "./query-keys"

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean | null
  createdAt: Date | string
}

export function useAdminUsers(enabled: boolean) {
  return useQuery<AdminUser[]>({
    queryKey: queryKeys.adminUsers.list(),
    queryFn: async () => {
      const result = await authClient.admin.listUsers({ query: { limit: 100 } })
      if (result.error) {
        throw new Error("Failed to load users")
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawUsers = (result.data as any)?.users ?? []
      return rawUsers as AdminUser[]
    },
    enabled,
  })
}
