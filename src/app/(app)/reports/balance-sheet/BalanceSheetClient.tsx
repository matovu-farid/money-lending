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

function formatAsOfDate(period: string): string {
  const [year, month] = period.split("-").map(Number)
  const lastDay = new Date(year, month, 0)
  return lastDay.toLocaleDateString("en-UG", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
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

  const totalCurrentAssets = new BigNumber(data.assets.cashBalance)
    .plus(data.assets.bankBalance)
    .plus(data.assets.strongRoomBalance)
    .toFixed(2)

  const totalLiabilitiesPlusEquity = new BigNumber(data.liabilities.totalCreditorBalances)
    .plus(data.equity.totalEquity)
    .toFixed(2)

  const isBalanced = new BigNumber(data.assets.totalAssets).isEqualTo(totalLiabilitiesPlusEquity)

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
        <CardContent className="pt-6">
          {/* Formal Accounting Header */}
          <div className="text-center mb-6">
            <p className="text-base font-semibold">Sovereign Ledger</p>
            <p className="text-sm font-medium">Balance Sheet</p>
            <p className="text-sm text-muted-foreground">
              As at {formatAsOfDate(period)}
            </p>
          </div>

          {/* Two-column layout on larger screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Assets */}
            <div>
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="py-2 font-bold text-base" colSpan={2}>Assets</td>
                  </tr>

                  {/* Current Assets */}
                  <tr>
                    <td className="py-1.5 font-semibold text-muted-foreground" colSpan={2}>
                      Current Assets
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6">Cash on Hand</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.assets.cashBalance)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6">Bank</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.assets.bankBalance)}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5 pl-6">Strong Room</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.assets.strongRoomBalance)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-2 font-semibold">Total Current Assets</td>
                    <td className="py-2 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(totalCurrentAssets)}
                    </td>
                  </tr>

                  {/* Non-Current Assets */}
                  <tr>
                    <td className="py-1.5 font-semibold text-muted-foreground" colSpan={2}>
                      Non-Current Assets
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6">Loans Outstanding</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.assets.totalLoansOutstanding)}
                    </td>
                  </tr>
                  {parseFloat(data.assets.interestReceivable) > 0 && (
                    <tr>
                      <td className="py-1.5 pl-6">Interest Receivable</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatCurrency(data.assets.interestReceivable)}
                      </td>
                    </tr>
                  )}
                  {parseFloat(data.assets.seizedCollateralValue) > 0 && (
                    <tr>
                      <td className="py-1.5 pl-6">Seized Collateral</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatCurrency(data.assets.seizedCollateralValue)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t">
                    <td className="py-2 pl-2 font-semibold">Total Non-Current Assets</td>
                    <td className="py-2 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(
                        new BigNumber(data.assets.totalLoansOutstanding)
                          .plus(data.assets.interestReceivable)
                          .plus(data.assets.seizedCollateralValue)
                          .toFixed(2)
                      )}
                    </td>
                  </tr>

                  {/* Total Assets — double underline */}
                  <tr className="border-t-2">
                    <td className="pt-3 pb-1 font-bold text-base">Total Assets</td>
                    <td className="pt-3 pb-1 text-right font-mono tabular-nums font-bold text-base">
                      {formatCurrency(data.assets.totalAssets)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2}>
                      <div className="border-b-[3px] border-double border-foreground/60 w-32 ml-auto" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right Column: Liabilities & Equity */}
            <div>
              <table className="w-full text-sm">
                <tbody>
                  {/* Liabilities */}
                  <tr>
                    <td className="py-2 font-bold text-base" colSpan={2}>Liabilities</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-semibold text-muted-foreground" colSpan={2}>
                      Current Liabilities
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5 pl-6">Creditor Balances</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.liabilities.totalCreditorBalances)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-2 font-semibold">Total Liabilities</td>
                    <td className="py-2 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(data.liabilities.totalCreditorBalances)}
                    </td>
                  </tr>

                  {/* Spacer */}
                  <tr><td className="py-2" colSpan={2}></td></tr>

                  {/* Stockholders' Equity */}
                  <tr>
                    <td className="py-2 font-bold text-base" colSpan={2}>
                      Owner&apos;s Equity
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6">Share Capital</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.equity.shareCapital)}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5 pl-6">Retained Earnings</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.equity.retainedEarnings)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-2 font-semibold">Total Equity</td>
                    <td className="py-2 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(data.equity.totalEquity)}
                    </td>
                  </tr>

                  {/* Total Liabilities + Equity — double underline */}
                  <tr className="border-t-2">
                    <td className="pt-3 pb-1 font-bold text-base">
                      Total Liabilities & Equity
                    </td>
                    <td className="pt-3 pb-1 text-right font-mono tabular-nums font-bold text-base">
                      {formatCurrency(totalLiabilitiesPlusEquity)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2}>
                      <div className="border-b-[3px] border-double border-foreground/60 w-32 ml-auto" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Balance Check */}
          {!isBalanced && (
            <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              Balance sheet does not balance. Assets ({formatCurrency(data.assets.totalAssets)})
              {" "}&ne;{" "}
              Liabilities + Equity ({formatCurrency(totalLiabilitiesPlusEquity)}).
              Difference: {formatCurrency(
                new BigNumber(data.assets.totalAssets).minus(totalLiabilitiesPlusEquity).toFixed(2)
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
