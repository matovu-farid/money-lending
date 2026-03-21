import { Effect } from "effect"
import { getBalanceSheetData } from "@/services/report.service"
import { BalanceSheetClient } from "./BalanceSheetClient"

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

  const data = await Effect.runPromise(getBalanceSheetData(period))

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
