"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { permissions, has } = usePermissions()
  const router = useRouter()
  const allowed = has("user:list")

  useEffect(() => {
    if (!isPending && permissions.size > 0 && !allowed) {
      router.replace("/dashboard")
    }
  }, [isPending, permissions.size, allowed, router])

  // Wait for both session and permissions to load
  if (isPending || permissions.size === 0) return null
  if (!allowed) return null

  return <>{children}</>
}
