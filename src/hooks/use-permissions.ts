"use client"

import { useMemo, useCallback } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { permissionsCollection } from "@/collections"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ p: permissionsCollection }).select(({ p }) => p)
  )
  const permissions = (data?.[0]?.permissions ?? []) as Permission[]
  const permSet = useMemo(() => new Set(permissions), [permissions])
  const has = useCallback((p: Permission) => permSet.has(p), [permSet])
  const hasAny = useCallback((...ps: Permission[]) => ps.some((p) => permSet.has(p)), [permSet])

  return { permissions: permSet, has, hasAny }
}
