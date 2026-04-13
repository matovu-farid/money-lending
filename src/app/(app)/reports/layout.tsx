"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("reports:read")) {
    router.replace("/dashboard")
    return null
  }

  return <>{children}</>
}
