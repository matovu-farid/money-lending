"use client"

import { useSearchParams } from "next/navigation"
import { PnlClient } from "./PnlClient"
import { getCurrentMonth } from "@/lib/utils"

export default function PnlPage() {
  const searchParams = useSearchParams()
  const period = searchParams.get("period") ?? getCurrentMonth()

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profit &amp; Loss</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Revenue and expense summary
        </p>
      </div>
      <PnlClient period={period} />
    </div>
  )
}
