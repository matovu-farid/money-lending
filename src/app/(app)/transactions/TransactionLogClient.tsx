"use client"

import { useUrlFilters } from "@/hooks/use-url-filters"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
      render: (row) => <span>{row.categoryName}</span>,
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
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setFilter("dateFrom", e.target.value)}
            className="w-[160px] h-8"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setFilter("dateTo", e.target.value)}
            className="w-[160px] h-8"
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
