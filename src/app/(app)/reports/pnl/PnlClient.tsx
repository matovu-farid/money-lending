"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
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
import type { PnlData } from "@/types"
import { formatCurrency } from "@/lib/utils"
import { downloadFromUrl } from "@/lib/download"
import { InfoPopover } from "@/components/ui/info-popover"

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

function formatPeriodEnded(period: string): string {
  const [year, month] = period.split("-").map(Number)
  const lastDay = new Date(year, month, 0)
  return lastDay.toLocaleDateString("en-UG", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

interface PnlClientProps {
  data: PnlData
  period: string
}

export function PnlClient({ data, period }: PnlClientProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()
  const [downloading, setDownloading] = useState(false)

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`/reports/pnl?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    if (downloading) return
    setDownloading(true)
    const href = `/api/reports/pnl?format=${format}&period=${period}`
    const filename = format === "pdf" ? `pnl-${period}.pdf` : `pnl-${period}.xlsx`
    try {
      await downloadFromUrl(href, filename)
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(false)
    }
  }

  const hasData = data.income.length > 0 || data.expenses.length > 0

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

        <Button variant="outline" size="sm" onClick={() => handleDownload("pdf")} disabled={downloading}>
          {downloading ? "Exporting..." : "Export PDF"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleDownload("excel")} disabled={downloading}>
          {downloading ? "Exporting..." : "Export Excel"}
        </Button>
      </div>

      {/* Report Card */}
      {!hasData ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No data available for the selected period.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {/* Formal Accounting Header */}
            <div className="text-center mb-6">
              <p className="text-base font-semibold">Sovereign Ledger</p>
              <p className="text-sm font-medium">Income Statement</p>
              <p className="text-sm text-muted-foreground">
                For the Month Ended {formatPeriodEnded(period)}
              </p>
            </div>

            <table className="w-full text-sm">
              <tbody>
                {/* Revenue Section */}
                <tr>
                  <td className="py-2 font-semibold" colSpan={2}>
                    <span className="inline-flex items-center gap-1">
                      Revenues
                      <InfoPopover>
                        <p className="font-semibold text-sm mb-1">Revenues</p>
                        <p className="text-xs text-muted-foreground">
                          All income earned during this period, including interest collected from borrower payments, issuance fees, and any other credit transactions recorded.
                        </p>
                      </InfoPopover>
                    </span>
                  </td>
                </tr>
                {data.income.map((row) => (
                  <tr key={row.category}>
                    <td className="py-1.5 pl-6">{row.category}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))}
                {/* Total Revenue — single underline on last item, bold total */}
                <tr className="border-t">
                  <td className="py-2 pl-2 font-semibold">Total Revenue</td>
                  <td className="py-2 text-right font-mono tabular-nums font-semibold">
                    {formatCurrency(data.totalIncome)}
                  </td>
                </tr>

                {/* Spacer */}
                <tr><td className="py-2" colSpan={2}></td></tr>

                {/* Expenses Section */}
                <tr>
                  <td className="py-2 font-semibold" colSpan={2}>
                    <span className="inline-flex items-center gap-1">
                      Expenses
                      <InfoPopover>
                        <p className="font-semibold text-sm mb-1">Expenses</p>
                        <p className="text-xs text-muted-foreground">
                          All costs incurred during this period, including interest paid to creditors, operational expenses, salaries, and any other debit transactions recorded.
                        </p>
                      </InfoPopover>
                    </span>
                  </td>
                </tr>
                {data.expenses.map((row, i) => (
                  <tr
                    key={row.category}
                    className={i === data.expenses.length - 1 ? "border-b" : ""}
                  >
                    <td className="py-1.5 pl-6">{row.category}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))}
                {/* Total Expenses */}
                <tr>
                  <td className="py-2 pl-2 font-semibold">Total Expenses</td>
                  <td className="py-2 text-right font-mono tabular-nums font-semibold">
                    {formatCurrency(data.totalExpenses)}
                  </td>
                </tr>

                {/* Net Income — double underline (accounting convention) */}
                <tr className="border-t-2">
                  <td className="pt-3 pb-1 font-bold text-base">
                    <span className="inline-flex items-center gap-1">
                      Net Income
                      <InfoPopover>
                        <p className="font-semibold text-sm mb-1">Net Income</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Profit (or loss) for the period after subtracting all expenses from total revenue.
                        </p>
                        <p className="text-xs font-mono bg-muted rounded px-2 py-1">
                          Net Income = Total Revenue &minus; Total Expenses
                        </p>
                      </InfoPopover>
                    </span>
                  </td>
                  <td
                    className={`pt-3 pb-1 text-right font-mono tabular-nums font-bold text-base ${
                      parseFloat(data.netProfit) >= 0
                        ? "text-green-700 dark:text-green-400"
                        : "text-destructive"
                    }`}
                  >
                    {formatCurrency(data.netProfit)}
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
      )}
    </div>
  )
}
