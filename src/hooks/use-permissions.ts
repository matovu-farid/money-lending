"use client"

import { useMemo, useCallback } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { permissionsCollection } from "@/collections/permissions"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ p: permissionsCollection }).select(({ p }) => p)
  )

  // Content-key the Set so unrelated collection ticks don't bust the memo.
  // Sorting before joining gives a stable key even if storage order shifts.
  const permKey = useMemo(() => {
    const list = (data?.[0]?.permissions ?? []) as Permission[]
    return [...list].sort().join("|")
  }, [data])

  const permSet = useMemo(() => new Set(permKey ? permKey.split("|") as Permission[] : []), [permKey])
  const has = useCallback((p: Permission) => permSet.has(p), [permSet])
  const hasAny = useCallback((...ps: Permission[]) => ps.some((p) => permSet.has(p)), [permSet])

  return { permissions: permSet, has, hasAny, isLoading }
}
