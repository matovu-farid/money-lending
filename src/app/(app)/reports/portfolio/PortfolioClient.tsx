"use client"

import { useState } from "react"
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
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null)

  async function handleDownload(format: "pdf" | "excel", href: string) {
    setDownloading(format)
    try {
      const response = await fetch(href)
      if (!response.ok) throw new Error("Download failed")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download =
        format === "pdf" ? "portfolio-report.pdf" : "portfolio-report.xlsx"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      const { toast } = await import("sonner")
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleDownload("pdf", exportPdfHref)}
          disabled={downloading !== null}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading === "pdf" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : null}
          Export PDF
        </button>
        <button
          onClick={() => handleDownload("excel", exportExcelHref)}
          disabled={downloading !== null}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading === "excel" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : null}
          Export Excel
        </button>
      </div>

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
