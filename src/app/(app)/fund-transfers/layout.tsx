"use client"

import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function FundTransfersLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { permissions } = usePermissions()

  // Wait for both session and permissions to load before rendering
  if (isPending || permissions.size === 0) return null

  return <>{children}</>
}
