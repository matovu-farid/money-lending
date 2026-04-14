"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { permissions, has } = usePermissions()
  const router = useRouter()

  // Wait for both session and permissions to load
  if (isPending || permissions.size === 0) return null

  if (!has("dashboard:read")) {
    router.replace("/loans")
    return null
  }

  return <>{children}</>
}
