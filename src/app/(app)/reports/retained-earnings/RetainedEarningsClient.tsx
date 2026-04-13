"use client"

import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { formatCurrency, formatPeriodDate } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { ReportToolbar } from "@/components/reports/report-toolbar"
import { useRetainedEarningsReport } from "@/hooks/use-reports"
import { Loader2 } from "lucide-react"

interface RetainedEarningsClientProps {
  period: string
}

export function RetainedEarningsClient({ period }: RetainedEarningsClientProps) {
  const { data, isLoading } = useRetainedEarningsReport(period)

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  const reData = data ?? { period, beginningBalance: "0", netIncome: "0", endingBalance: "0" }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <ReportToolbar
        period={period}
        basePath="/reports/retained-earnings"
        exportFormats={[]}
      />

      {/* Report Card */}
      <Card>
        <CardContent className="pt-6">
          {/* Formal Accounting Header */}
          <div className="text-center mb-6">
            <p className="text-base font-semibold">Sovereign Ledger</p>
            <p className="text-sm font-medium">Statement of Retained Earnings</p>
            <p className="text-sm text-muted-foreground">
              For the Month Ended {formatPeriodDate(period, "end")}
            </p>
          </div>

          <table className="w-full text-sm max-w-lg mx-auto">
            <tbody>
              {/* Beginning Retained Earnings */}
              <tr>
                <td className="py-2">
                  <span className="inline-flex items-center gap-1">
                    Retained Earnings, {formatPeriodDate(period, "start")}
                    <InfoPopover>
                      <p className="font-semibold text-sm mb-1">Beginning Balance</p>
                      <p className="text-xs text-muted-foreground">
                        The retained earnings carried forward from the previous period. This is the cumulative profit kept in the business up to the start of this month.
                      </p>
                    </InfoPopover>
                  </span>
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatCurrency(reData.beginningBalance)}
                </td>
              </tr>

              {/* Add: Net Income */}
              <tr className="border-b">
                <td className="py-2">
                  <span className="inline-flex items-center gap-1">
                    Add: Net Income
                    <InfoPopover>
                      <p className="font-semibold text-sm mb-1">Net Income</p>
                      <p className="text-xs text-muted-foreground">
                        Profit (or loss) earned during this month, as shown on the Income Statement. A negative value means expenses exceeded revenue.
                      </p>
                    </InfoPopover>
                  </span>
                </td>
                <td className={`py-2 text-right font-mono tabular-nums ${
                  parseFloat(reData.netIncome) < 0 ? "text-destructive" : ""
                }`}>
                  {formatCurrency(reData.netIncome)}
                </td>
              </tr>

              {/* Ending Retained Earnings — double underline */}
              <tr className="border-t-2">
                <td className="pt-3 pb-1 font-bold text-base">
                  <span className="inline-flex items-center gap-1">
                    Retained Earnings, {formatPeriodDate(period, "end")}
                    <InfoPopover>
                      <p className="font-semibold text-sm mb-1">Ending Retained Earnings</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        The cumulative profit kept in the business as of the end of this month. This flows into the Balance Sheet as part of Owner&apos;s Equity.
                      </p>
                      <p className="text-xs font-mono bg-muted rounded px-2 py-1">
                        Ending = Beginning Balance + Net Income
                      </p>
                    </InfoPopover>
                  </span>
                </td>
                <td className="pt-3 pb-1 text-right font-mono tabular-nums font-bold text-base">
                  {formatCurrency(reData.endingBalance)}
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  <div className="border-b-[3px] border-double border-foreground/60 w-32 ml-auto" />
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
