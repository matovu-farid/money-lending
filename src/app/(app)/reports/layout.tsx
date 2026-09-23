"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has, isLoading } = usePermissions()
  const router = useRouter()
  const allowed = has("reports:read")

  useEffect(() => {
    if (!isPending && !isLoading && !allowed) {
      router.replace("/dashboard")
    }
  }, [isPending, isLoading, allowed, router])

  if (isPending || isLoading) return null
  if (!allowed) return null

  return <>{children}</>
}
