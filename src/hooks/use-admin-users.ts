"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { adminUserCollection } from "@/collections/admin-users"

export type { AdminUser } from "@/collections/admin-users"

export function useAdminUsers() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ u: adminUserCollection }).select(({ u }) => u)
  )
  return {
    data: data ?? [],
    isLoading,
  }
}
