"use client"

import { useSearchParams } from "next/navigation"
import { RetainedEarningsClient } from "./RetainedEarningsClient"
import { getCurrentMonth } from "@/lib/utils"

export default function RetainedEarningsPage() {
  const searchParams = useSearchParams()
  const period = searchParams.get("period") ?? getCurrentMonth()

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Retained Earnings</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Changes in retained earnings for the period
        </p>
      </div>
      <RetainedEarningsClient period={period} />
    </div>
  )
}
