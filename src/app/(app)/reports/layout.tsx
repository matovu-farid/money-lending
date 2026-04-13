"use client"

import { useRouter } from "next/navigation"
import { useSession } from "@/lib/auth-client"
import { ROLE_LEVELS, type UserRole } from "@/types"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession()
  const router = useRouter()

  if (isPending) return null

  const role = (session?.user?.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    router.replace("/dashboard")
    return null
  }

  return <>{children}</>
}
