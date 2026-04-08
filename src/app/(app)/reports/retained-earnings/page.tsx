import { Effect, Exit } from "effect"
import { getRetainedEarningsData } from "@/services/report.service"
import { RetainedEarningsClient } from "./RetainedEarningsClient"
import { getCurrentMonth } from "@/lib/utils"
import type { RetainedEarningsData } from "@/types"

interface RetainedEarningsPageProps {
  searchParams: Promise<{ period?: string }>
}

export default async function RetainedEarningsPage({
  searchParams,
}: RetainedEarningsPageProps) {
  const params = await searchParams
  const period = params.period ?? getCurrentMonth()

  const exit = await Effect.runPromiseExit(getRetainedEarningsData(period))
  const data: RetainedEarningsData = Exit.isSuccess(exit)
    ? exit.value
    : {
        period,
        beginningBalance: "0",
        netIncome: "0",
        endingBalance: "0",
      }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Retained Earnings
        </h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Changes in retained earnings for the period
        </p>
      </div>

      <RetainedEarningsClient data={data} period={period} />
    </div>
  )
}
