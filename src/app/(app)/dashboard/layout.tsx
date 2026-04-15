"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { permissions, has } = usePermissions()
  const router = useRouter()
  const allowed = has("dashboard:read")

  useEffect(() => {
    if (!isPending && permissions.size > 0 && !allowed) {
      router.replace("/loans")
    }
  }, [isPending, permissions.size, allowed, router])

  // Wait for both session and permissions to load
  if (isPending || permissions.size === 0) return null
  if (!allowed) return null

  return <>{children}</>
}
