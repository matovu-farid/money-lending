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
import BigNumber from "bignumber.js"
import type { BalanceSheetData } from "@/types"
import { formatCurrency, getMonthOptions, formatPeriodDate } from "@/lib/utils"
import { downloadFromUrl } from "@/lib/download"
import { InfoPopover } from "@/components/ui/info-popover"

interface BalanceSheetClientProps {
  data: BalanceSheetData
  period: string
}

export function BalanceSheetClient({ data, period }: BalanceSheetClientProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()
  const [downloading, setDownloading] = useState(false)

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`/reports/balance-sheet?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    if (downloading) return
    setDownloading(true)
    const href = `/api/reports/balance-sheet?format=${format}&period=${period}`
    const filename = format === "pdf" ? `balance-sheet-${period}.pdf` : `balance-sheet-${period}.xlsx`
    try {
      await downloadFromUrl(href, filename)
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(false)
    }
  }

  const totalCurrentAssets = new BigNumber(data.assets.cashBalance)
    .plus(data.assets.bankBalance)
    .plus(data.assets.strongRoomBalance)
    .toFixed(0)

  const totalLiabilitiesPlusEquity = new BigNumber(data.liabilities.totalCreditorBalances)
    .plus(data.liabilities.interestPayable ?? "0")
    .plus(data.equity.totalEquity)
    .toFixed(0)

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

        <Button variant="outline" size="sm" onClick={() => handleDownload("pdf")} disabled={downloading}>
          {downloading ? "Exporting..." : "Export PDF"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleDownload("excel")} disabled={downloading}>
          {downloading ? "Exporting..." : "Export Excel"}
        </Button>
      </div>

      {/* Report Card */}
      <Card>
        <CardContent className="pt-6">
          {/* Formal Accounting Header */}
          <div className="text-center mb-6">
            <p className="text-base font-semibold">Sovereign Ledger</p>
            <p className="text-sm font-medium">Balance Sheet</p>
            <p className="text-sm text-muted-foreground">
              As at {formatPeriodDate(period, "end")}
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
                      <span className="inline-flex items-center gap-1">
                        Current Assets
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Current Assets</p>
                          <p className="text-xs text-muted-foreground">
                            Cash and cash-equivalents that are readily available for use in the business. These are liquid funds held across your three deposit locations.
                          </p>
                        </InfoPopover>
                      </span>
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
                      <span className="inline-flex items-center gap-1">
                        Non-Current Assets
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Non-Current Assets</p>
                          <p className="text-xs text-muted-foreground">
                            Assets that are not immediately liquid. These include money lent out to borrowers (loans outstanding), interest owed but not yet collected, and any collateral seized from defaulting borrowers.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6">
                      <span className="inline-flex items-center gap-1">
                        Loans Outstanding
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Loans Outstanding</p>
                          <p className="text-xs text-muted-foreground">
                            Total remaining principal balance across all active loans. This is money owed to the business by borrowers, excluding accrued interest.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.assets.totalLoansOutstanding)}
                    </td>
                  </tr>
                  {parseFloat(data.assets.interestReceivable) > 0 && (
                    <tr>
                      <td className="py-1.5 pl-6">
                        <span className="inline-flex items-center gap-1">
                          Interest Receivable
                          <InfoPopover>
                            <p className="font-semibold text-sm mb-1">Interest Receivable</p>
                            <p className="text-xs text-muted-foreground">
                              Total accrued but unpaid interest across all active loans. This is interest that borrowers owe but have not yet paid.
                            </p>
                          </InfoPopover>
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatCurrency(data.assets.interestReceivable)}
                      </td>
                    </tr>
                  )}
                  {parseFloat(data.assets.seizedCollateralValue) > 0 && (
                    <tr>
                      <td className="py-1.5 pl-6">
                      <span className="inline-flex items-center gap-1">
                        Seized Collateral
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Seized Collateral</p>
                          <p className="text-xs text-muted-foreground">
                            Estimated value of collateral seized from borrowers whose loans were settled with collateral. This is recorded at the value declared when the loan was created.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
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
                          .toFixed(0)
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
                      <span className="inline-flex items-center gap-1">
                        Current Liabilities
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Current Liabilities</p>
                          <p className="text-xs text-muted-foreground">
                            Obligations the business owes to external parties. For a lending business, this is primarily money owed to creditors (investors) who provided capital to fund loans.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
                  </tr>
                  <tr className={new BigNumber(data.liabilities.interestPayable ?? "0").isGreaterThan(0) ? "" : "border-b"}>
                    <td className="py-1.5 pl-6">
                      <span className="inline-flex items-center gap-1">
                        Creditor Balances
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Creditor Balances</p>
                          <p className="text-xs text-muted-foreground">
                            Total outstanding obligation to all creditors (investors). This is the sum of invested principal plus accrued interest, minus any repayments made back to them.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.liabilities.totalCreditorBalances)}
                    </td>
                  </tr>
                  {new BigNumber(data.liabilities.interestPayable ?? "0").isGreaterThan(0) && (
                    <tr className="border-b">
                      <td className="py-1.5 pl-6">Interest Payable</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatCurrency(data.liabilities.interestPayable!)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="py-2 pl-2 font-semibold">Total Liabilities</td>
                    <td className="py-2 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(new BigNumber(data.liabilities.totalCreditorBalances).plus(data.liabilities.interestPayable ?? "0").toFixed(0))}
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
                    <td className="py-1.5 pl-6">
                      <span className="inline-flex items-center gap-1">
                        Share Capital
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Share Capital</p>
                          <p className="text-xs text-muted-foreground">
                            Owner&apos;s initial investment into the business. This is the seed money used to start lending operations, separate from creditor funds.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCurrency(data.equity.shareCapital)}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5 pl-6">
                      <span className="inline-flex items-center gap-1">
                        Retained Earnings
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Retained Earnings</p>
                          <p className="text-xs text-muted-foreground">
                            Cumulative net profit that has been kept in the business rather than withdrawn. Calculated as total revenue earned minus total expenses since inception.
                          </p>
                        </InfoPopover>
                      </span>
                    </td>
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
                new BigNumber(data.assets.totalAssets).minus(totalLiabilitiesPlusEquity).toFixed(0)
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
