import { Effect, Exit } from "effect"
import { getPnlData } from "@/services/report.service"
import { PnlClient } from "./PnlClient"
import type { PnlData } from "@/types"

function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}

interface PnlPageProps {
  searchParams: Promise<{ period?: string }>
}

export default async function PnlPage({ searchParams }: PnlPageProps) {
  const params = await searchParams
  const period = params.period ?? getLastCompletedMonth()

  const exit = await Effect.runPromiseExit(getPnlData(period))
  const data: PnlData = Exit.isSuccess(exit)
    ? exit.value
    : { period, income: [], totalIncome: "0", expenses: [], totalExpenses: "0", netProfit: "0" }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profit & Loss</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Revenue and expense summary
        </p>
      </div>

      <PnlClient data={data} period={period} />
    </div>
  )
}
