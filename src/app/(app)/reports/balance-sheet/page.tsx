"use client"

import { useSearchParams } from "next/navigation"
import { BalanceSheetClient } from "./BalanceSheetClient"
import { getCurrentMonth } from "@/lib/utils"

export default function BalanceSheetPage() {
  const searchParams = useSearchParams()
  const period = searchParams.get("period") ?? getCurrentMonth()

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
