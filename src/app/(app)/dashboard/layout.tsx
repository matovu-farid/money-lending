"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("dashboard:read")) {
    router.replace("/loans")
    return null
  }

  return <>{children}</>
}
