"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { adminUserCollection } from "@/collections"

export type { AdminUser } from "@/collections"

export function useAdminUsers(_enabled: boolean) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ u: adminUserCollection }).select(({ u }) => u)
  )
  return {
    data: data ?? [],
    isLoading,
    isFetching: isLoading,
  }
}
