"use client"

import { useCallback } from "react"
import { Loader2 } from "lucide-react"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import type { PnlData } from "@/types"
import { formatCurrency, formatPeriodDate } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { ReportToolbar } from "@/components/reports/report-toolbar"
import { usePnlReport } from "@/hooks/use-reports"

interface PnlClientProps {
  period: string
}

export function PnlClient({ period }: PnlClientProps) {
  const { data, isLoading } = usePnlReport(period)

  const onExport = useCallback(async (format: "pdf" | "excel") => {
    if (!data) throw new Error("No data")
    if (format === "pdf") {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      const buffer = generatePnlPdf(data)
      return { blob: new Blob([buffer as BlobPart], { type: "application/pdf" }), filename: `pnl-${period}.pdf` }
    }
    const { generatePnlExcel } = await import("@/services/export/excel.service")
    const buffer = await generatePnlExcel(data)
    return { blob: new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename: `pnl-${period}.xlsx` }
  }, [data, period])

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  const pnlData: PnlData = data ?? { period, income: [], totalIncome: "0", expenses: [], totalExpenses: "0", netProfit: "0" }
  const hasData = pnlData.income.length > 0 || pnlData.expenses.length > 0

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <ReportToolbar
        period={period}
        basePath="/reports/pnl"
        onExport={onExport}
      />

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
                For the Month Ended {formatPeriodDate(period, "end")}
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
                {pnlData.income.map((row) => (
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
                    {formatCurrency(pnlData.totalIncome)}
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
                {pnlData.expenses.map((row, i) => (
                  <tr
                    key={row.category}
                    className={i === pnlData.expenses.length - 1 ? "border-b" : ""}
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
                    {formatCurrency(pnlData.totalExpenses)}
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
                      parseFloat(pnlData.netProfit) >= 0
                        ? "text-green-700 dark:text-green-400"
                        : "text-destructive"
                    }`}
                  >
                    {formatCurrency(pnlData.netProfit)}
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
