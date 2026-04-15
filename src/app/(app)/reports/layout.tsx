"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()
  const allowed = has("reports:read")

  useEffect(() => {
    if (!isPending && !allowed) {
      router.replace("/dashboard")
    }
  }, [isPending, allowed, router])

  if (isPending) return null
  if (!allowed) return null

  return <>{children}</>
}
