"use client"

import { useSession } from "@/lib/auth-client"
import { useQuery } from "@tanstack/react-query"
import { getEffectivePermissionsAction } from "@/actions/user.actions"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const { data: permissions = [] } = useQuery({
    queryKey: ["effective-permissions", userId],
    queryFn: () => getEffectivePermissionsAction(),
    enabled: !!userId,
    staleTime: 30_000,
  })

  const permSet = new Set(permissions as Permission[])

  return {
    permissions: permSet,
    has: (p: Permission) => permSet.has(p),
    hasAny: (...ps: Permission[]) => ps.some((p) => permSet.has(p)),
  }
}
