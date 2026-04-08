import { Effect, Exit } from "effect"
import { getBalanceSheetData } from "@/services/report.service"
import { BalanceSheetClient } from "./BalanceSheetClient"
import { getCurrentMonth } from "@/lib/utils"
import type { BalanceSheetData } from "@/types"

interface BalanceSheetPageProps {
  searchParams: Promise<{ period?: string }>
}

export default async function BalanceSheetPage({
  searchParams,
}: BalanceSheetPageProps) {
  const params = await searchParams
  const period = params.period ?? getCurrentMonth()

  const exit = await Effect.runPromiseExit(getBalanceSheetData(period))
  const data: BalanceSheetData = Exit.isSuccess(exit)
    ? exit.value
    : {
        asOf: period,
        assets: {
          cashBalance: "0",
          bankBalance: "0",
          strongRoomBalance: "0",
          totalLoansOutstanding: "0",
          interestReceivable: "0",
          seizedCollateralValue: "0",
          totalAssets: "0",
        },
        liabilities: { totalCreditorBalances: "0" },
        equity: { shareCapital: "0", retainedEarnings: "0", totalEquity: "0" },
      }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Assets, liabilities, and equity
        </p>
      </div>

      <BalanceSheetClient data={data} period={period} />
    </div>
  )
}
