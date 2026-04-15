"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { permissionsCollection } from "@/collections"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ p: permissionsCollection }).select(({ p }) => p)
  )
  const permissions = (data?.[0]?.permissions ?? []) as Permission[]
  const permSet = new Set(permissions)

  return {
    permissions: permSet,
    has: (p: Permission) => permSet.has(p),
    hasAny: (...ps: Permission[]) => ps.some((p) => permSet.has(p)),
  }
}
