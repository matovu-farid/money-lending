"use client"

import { toast } from "sonner"
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
import BigNumber from "bignumber.js"
import type { BalanceSheetData } from "@/types"
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

interface BalanceSheetClientProps {
  data: BalanceSheetData
  period: string
}

export function BalanceSheetClient({ data, period }: BalanceSheetClientProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`/reports/balance-sheet?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    const href = `/api/reports/balance-sheet?format=${format}&period=${period}`
    try {
      const response = await fetch(href)
      if (!response.ok) throw new Error("Download failed")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download =
        format === "pdf"
          ? `balance-sheet-${period}.pdf`
          : `balance-sheet-${period}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Export failed. Please try again.")
    }
  }

  const totalLiabilitiesPlusEquity = new BigNumber(data.liabilities.totalCreditorBalances)
    .plus(data.equity.totalEquity)
    .toFixed(2)

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance Sheet — {period}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Assets */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Assets
            </h3>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Cash on Hand</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.cashBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Bank</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.bankBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Strong Room</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.strongRoomBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Loans Outstanding</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.totalLoansOutstanding)}
                  </td>
                </tr>
                <tr className="font-semibold bg-muted/30">
                  <td className="py-2 px-1">Total Assets</td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.totalAssets)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Liabilities */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Liabilities
            </h3>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-muted">
                  <td className="py-2">Total Creditor Balances</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.liabilities.totalCreditorBalances)}
                  </td>
                </tr>
                <tr className="font-semibold bg-muted/30">
                  <td className="py-2 px-1">Total Liabilities</td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {formatCurrency(data.liabilities.totalCreditorBalances)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Equity */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Equity
            </h3>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-muted">
                  <td className="py-2">Share Capital</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.equity.shareCapital)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2">Retained Earnings</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.equity.retainedEarnings)}
                  </td>
                </tr>
                <tr className="font-semibold bg-muted/30">
                  <td className="py-2 px-1">Total Equity</td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {formatCurrency(data.equity.totalEquity)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Balance Check */}
          <div className="border-t-2 pt-3">
            <div className="flex items-center justify-between font-bold text-base">
              <span>Total Liabilities + Equity</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(String(totalLiabilitiesPlusEquity))}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
