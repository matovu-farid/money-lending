"use client"

import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import type { RetainedEarningsData } from "@/types"
import { formatCurrency, getMonthOptions, formatPeriodDate } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"

interface RetainedEarningsClientProps {
  data: RetainedEarningsData
  period: string
}

export function RetainedEarningsClient({ data, period }: RetainedEarningsClientProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`/reports/retained-earnings?period=${value}`)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
                  {formatCurrency(data.beginningBalance)}
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
                  parseFloat(data.netIncome) < 0 ? "text-destructive" : ""
                }`}>
                  {formatCurrency(data.netIncome)}
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
                  {formatCurrency(data.endingBalance)}
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
