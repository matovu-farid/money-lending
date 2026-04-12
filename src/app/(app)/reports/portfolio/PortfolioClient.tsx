"use client"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PortfolioEntry } from "@/types"
import { formatCurrency } from "@/lib/utils"
import { ReportToolbar } from "@/components/reports/report-toolbar"

interface PortfolioClientProps {
  data: PortfolioEntry[]
  exportPdfHref: string
  exportExcelHref: string
}

export function PortfolioClient({
  data,
  exportPdfHref,
  exportExcelHref,
}: PortfolioClientProps) {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <ReportToolbar
        basePath="/reports/portfolio"
        showPeriodSelector={false}
        exportHref={(fmt) => fmt === "pdf" ? exportPdfHref : exportExcelHref}
        exportFilename={(fmt) => `portfolio-report.${fmt === "pdf" ? "pdf" : "xlsx"}`}
      />

      {/* Table */}
      {data.length === 0 ? (
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
              {data.map((entry) => (
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
