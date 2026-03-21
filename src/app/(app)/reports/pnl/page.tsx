import { Effect } from "effect"
import { getPnlData } from "@/services/report.service"
import { PnlClient } from "./PnlClient"

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

  const data = await Effect.runPromise(getPnlData(period))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Profit & Loss</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly income and expense summary
        </p>
      </div>

      <PnlClient data={data} period={period} />
    </div>
  )
}
