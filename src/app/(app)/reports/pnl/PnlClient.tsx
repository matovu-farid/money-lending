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
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { PnlData } from "@/types"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(num)}`
}

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

interface PnlClientProps {
  data: PnlData
  period: string
}

export function PnlClient({ data, period }: PnlClientProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`/reports/pnl?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    const href = `/api/reports/pnl?format=${format}&period=${period}`
    try {
      const response = await fetch(href)
      if (!response.ok) throw new Error("Download failed")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = format === "pdf" ? `pnl-${period}.pdf` : `pnl-${period}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silently fail — user can retry
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

        <button
          onClick={() => handleDownload("pdf")}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent"
        >
          Export PDF
        </button>
        <button
          onClick={() => handleDownload("excel")}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent"
        >
          Export Excel
        </button>
      </div>

      {/* Report Card */}
      {!hasData ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No data available for the selected period.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Profit & Loss — {period}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Income Section */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Income
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.income.map((row) => (
                    <tr key={row.category} className="border-b border-muted">
                      <td className="py-2">{row.category}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatUGX(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-muted/30">
                    <td className="py-2 px-1">Total Income</td>
                    <td className="py-2 px-1 text-right font-mono tabular-nums">
                      {formatUGX(data.totalIncome)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Expense Section */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Expenses
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((row) => (
                    <tr key={row.category} className="border-b border-muted">
                      <td className="py-2">{row.category}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatUGX(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-muted/30">
                    <td className="py-2 px-1">Total Expenses</td>
                    <td className="py-2 px-1 text-right font-mono tabular-nums">
                      {formatUGX(data.totalExpenses)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Net Profit Row */}
            <div className="border-t-2 pt-3">
              <div className="flex items-center justify-between font-bold text-base">
                <span>Net Profit</span>
                <span
                  className={
                    parseFloat(data.netProfit) >= 0
                      ? "text-green-700 font-mono tabular-nums dark:text-green-400"
                      : "text-destructive font-mono tabular-nums"
                  }
                >
                  {formatUGX(data.netProfit)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
