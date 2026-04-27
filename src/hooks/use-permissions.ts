"use client"

import { useMemo, useCallback } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { permissionsCollection } from "@/collections/permissions"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ p: permissionsCollection }).select(({ p }) => p)
  )
  const permissions = (data?.[0]?.permissions ?? []) as Permission[]
  const permSet = useMemo(() => new Set(permissions), [permissions])
  const has = useCallback((p: Permission) => permSet.has(p), [permSet])
  const hasAny = useCallback((...ps: Permission[]) => ps.some((p) => permSet.has(p)), [permSet])

  return { permissions: permSet, has, hasAny, isLoading }
}
