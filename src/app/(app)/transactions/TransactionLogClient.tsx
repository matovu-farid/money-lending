"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useUrlFilters } from "@/hooks/use-url-filters"
import { useTransactionReportData } from "@/hooks/use-reports"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { downloadBlob } from "@/lib/download"
import type { TransactionRow, CategoryRow } from "@/types"

interface TransactionLogClientProps {
  transactions: TransactionRow[]
  total: number
  categories: CategoryRow[]
  page: number
  pageSize: number
}

import { formatDate, formatCurrency } from "@/lib/utils"

export function TransactionLogClient({
  transactions,
  total,
  categories,
  page,
  pageSize,
}: TransactionLogClientProps) {
  const { data: reportData } = useTransactionReportData()
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null)

  const handleExport = useCallback(async (format: "pdf" | "excel") => {
    if (!reportData || exporting) return
    setExporting(format)
    try {
      const categoryMap = new Map(reportData.categories)
      if (format === "pdf") {
        const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
        const buffer = generateTransactionsPdf(reportData.transactions, categoryMap)
        downloadBlob(new Blob([buffer as BlobPart], { type: "application/pdf" }), "transaction-log.pdf")
      } else {
        const { generateTransactionsExcel } = await import("@/services/export/excel.service")
        const buffer = await generateTransactionsExcel(reportData.transactions, categoryMap)
        downloadBlob(new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "transaction-log.xlsx")
      }
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setExporting(null)
    }
  }, [reportData, exporting])

  const { filters, setFilter, clearFilters, hasFilters: isFiltersActive, setPage } = useUrlFilters({
    basePath: "/transactions",
    defaults: { type: "all", categoryId: "all", dateFrom: "", dateTo: "" },
  })
  const { type: typeFilter, categoryId: categoryFilter, dateFrom, dateTo } = filters

  const columns: Column<TransactionRow>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => <span className="font-mono tabular-nums">{formatDate(row.transactionDate)}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (row) =>
        row.type === "credit" ? (
          <Badge className="text-green-600 border-green-200 bg-green-50">CR</Badge>
        ) : (
          <Badge className="text-blue-600 border-blue-200 bg-blue-50">DR</Badge>
        ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => <span>{row.category}</span>,
    },
    {
      key: "description",
      header: "Description",
      primary: true,
      render: (row) => (
        <span className="text-muted-foreground max-w-[200px] truncate block">
          {row.description ?? "\u2014"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <span className="font-mono tabular-nums">{formatCurrency(row.amount)}</span>
      ),
    },
    {
      key: "recordedBy",
      header: "Recorded By",
      render: (row) => (
        <span className="text-muted-foreground text-xs">{row.recordedBy}</span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={typeFilter} onValueChange={(value) => setFilter("type", value ?? "all")}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="credit">Credit (CR)</SelectItem>
              <SelectItem value="debit">Debit (DR)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={categoryFilter} onValueChange={(value) => setFilter("categoryId", value ?? "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <DatePicker
            size="sm"
            className="w-[160px]"
            value={dateFrom}
            onChange={(value) => setFilter("dateFrom", value)}
            max={dateTo || undefined}
            placeholder="From"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <DatePicker
            size="sm"
            className="w-[160px]"
            value={dateTo}
            onChange={(value) => setFilter("dateTo", value)}
            min={dateFrom || undefined}
            placeholder="To"
          />
        </div>

        {isFiltersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            Clear filters
          </Button>
        )}

        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("pdf")}
            disabled={!reportData || exporting !== null}
          >
            {exporting === "pdf" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {exporting === "pdf" ? "Exporting..." : "Export PDF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("excel")}
            disabled={!reportData || exporting !== null}
          >
            {exporting === "excel" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {exporting === "excel" ? "Exporting..." : "Export Excel"}
          </Button>
        </div>
      </div>

      {/* Table or empty state */}
      <ResponsiveTable
        columns={columns}
        rows={transactions}
        getRowKey={(row) => row.id}
        emptyState={
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <p className="text-lg font-medium">No transactions yet</p>
            <p className="text-muted-foreground max-w-sm">
              Transactions appear here automatically when payments and creditor repayments are recorded.
            </p>
          </div>
        }
      />

      {/* Pagination */}
      {transactions.length > 0 && total > pageSize && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-mono tabular-nums">{(page - 1) * pageSize + 1}</span>&ndash;<span className="font-mono tabular-nums">{Math.min(page * pageSize, total)}</span> of <span className="font-mono tabular-nums">{total}</span> transactions
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
