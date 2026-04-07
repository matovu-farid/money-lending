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
import { formatCurrency } from "@/lib/utils"

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-UG", {
      month: "long",
      year: "numeric",
    })
    options.push({ value, label })
  }
  return options
}

function formatPeriodDate(period: string, position: "start" | "end"): string {
  const [year, month] = period.split("-").map(Number)
  const date = position === "start"
    ? new Date(year, month - 1, 1)
    : new Date(year, month, 0)
  return date.toLocaleDateString("en-UG", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

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
                  Retained Earnings, {formatPeriodDate(period, "start")}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatCurrency(data.beginningBalance)}
                </td>
              </tr>

              {/* Add: Net Income */}
              <tr className="border-b">
                <td className="py-2">
                  Add: Net Income
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
                  Retained Earnings, {formatPeriodDate(period, "end")}
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
