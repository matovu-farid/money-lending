"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { authClient } from "@/lib/auth-client"
import { getQueryClient } from "@/lib/query-client"

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
    queryKey: ["admin-users", "list"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<AdminUser>> => {
      const result = await authClient.admin.listUsers({ query: { limit: 100 } })
      if (result.error) {
        throw new Error("Failed to load users")
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawUsers = (result.data as any)?.users ?? []
      return rawUsers as AdminUser[]
    },
    getKey: (user) => user.id,
  })
)
