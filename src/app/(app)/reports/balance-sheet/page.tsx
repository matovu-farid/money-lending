"use client"

import { useSearchParams } from "next/navigation"
import { BalanceSheetClient } from "./BalanceSheetClient"
import { getCurrentMonth } from "@/lib/utils"
import { usePermissions } from "@/hooks/use-permissions"

export default function BalanceSheetPage() {
  const searchParams = useSearchParams()
  const period = searchParams.get("period") ?? getCurrentMonth()
  const { has } = usePermissions()

  if (!has("reports:financial")) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <p className="text-destructive font-medium">Access denied.</p>
        <p className="text-muted-foreground text-sm">
          You need Supervisor or higher permissions to view the Balance Sheet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Assets, liabilities, and equity
        </p>
      </div>
      <BalanceSheetClient period={period} />
    </div>
  )
}
