"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { adminUserCollection } from "@/collections/admin-users"

export type { AdminUser } from "@/collections/admin-users"

export function useAdminUsers() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ u: adminUserCollection }).select(({ u }) => u)
  )
  return {
    data: data ?? [],
  }
}
