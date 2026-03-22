import { Effect, Exit } from "effect"
import { getBalanceSheetData } from "@/services/report.service"
import { BalanceSheetClient } from "./BalanceSheetClient"
import type { BalanceSheetData } from "@/types"

function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}

interface BalanceSheetPageProps {
  searchParams: Promise<{ period?: string }>
}

export default async function BalanceSheetPage({
  searchParams,
}: BalanceSheetPageProps) {
  const params = await searchParams
  const period = params.period ?? getLastCompletedMonth()

  const exit = await Effect.runPromiseExit(getBalanceSheetData(period))
  const data: BalanceSheetData = Exit.isSuccess(exit)
    ? exit.value
    : {
        asOf: period,
        assets: { totalLoansOutstanding: "0" },
        liabilities: { totalCreditorBalances: "0" },
        equity: { shareCapital: "0", retainedEarnings: "0", totalEquity: "0" },
      }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Balance Sheet</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assets, liabilities, and equity
        </p>
      </div>

      <BalanceSheetClient data={data} period={period} />
    </div>
  )
}
