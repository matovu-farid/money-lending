"use client"

import { useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"
import { ReportToolbar } from "@/components/reports/report-toolbar"
import { usePortfolioReport } from "@/hooks/use-reports"

export function PortfolioClient() {
  const { data } = usePortfolioReport()
  const entries = data ?? []

  const onExport = useCallback(
    async (format: "pdf" | "excel") => {
      if (!data) throw new Error("No data")
      if (format === "pdf") {
        const { generatePortfolioPdf } = await import(
          "@/services/export/pdf.service"
        )
        const buffer = generatePortfolioPdf(data)
        return {
          blob: new Blob([buffer as BlobPart], { type: "application/pdf" }),
          filename: "portfolio-report.pdf",
        }
      }
      const { generatePortfolioExcel } = await import(
        "@/services/export/excel.service"
      )
      const buffer = await generatePortfolioExcel(data)
      return {
        blob: new Blob([buffer as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        filename: "portfolio-report.xlsx",
      }
    },
    [data],
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <ReportToolbar
        basePath="/reports/portfolio"
        showPeriodSelector={false}
        onExport={onExport}
      />

      {/* Table */}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No active loans to display.
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Loan Amount</TableHead>
                <TableHead className="text-right">
                  Outstanding
                </TableHead>
                <TableHead className="text-right">
                  Interest Accrued
                </TableHead>
                <TableHead className="text-right">Days Overdue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.loanId} data-testid="data-row">
                  <TableCell className="font-medium">
                    {entry.customerName}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(entry.principalAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(entry.outstandingBalance)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(entry.interestAccrued)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {entry.daysOverdue}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {entry.riskFlag ? (
                      <Badge variant="destructive">At Risk</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
