"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import type { TransactionLogFilters, TransactionRow, CategoryRow } from "@/types"

interface TransactionLogClientProps {
  transactions: TransactionRow[]
  total: number
  categories: CategoryRow[]
  page: number
  pageSize: number
  filters: TransactionLogFilters
}

import { formatDate, formatCurrency } from "@/lib/utils"

// Map transaction type to filter select value
function typeToSelectValue(type?: string): string {
  if (type === "credit") return "credit"
  if (type === "debit") return "debit"
  return "all"
}

export function TransactionLogClient({
  transactions,
  total,
  categories,
  page,
  pageSize,
  filters,
}: TransactionLogClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Local filter state (debounced to URL)
  const [typeFilter, setTypeFilter] = useState<string>(typeToSelectValue(filters.type))
  const [categoryFilter, setCategoryFilter] = useState<string>(filters.categoryId ?? "all")
  const [dateFrom, setDateFrom] = useState<string>(filters.dateFrom ?? "")
  const [dateTo, setDateTo] = useState<string>(filters.dateTo ?? "")

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isFiltersActive =
    typeFilter !== "all" || categoryFilter !== "all" || dateFrom !== "" || dateTo !== ""

  const applyFilters = useCallback(
    (newType: string, newCategory: string, newDateFrom: string, newDateTo: string) => {
      const params = new URLSearchParams(searchParams.toString())

      if (newType !== "all") {
        params.set("type", newType)
      } else {
        params.delete("type")
      }

      if (newCategory !== "all") {
        params.set("categoryId", newCategory)
      } else {
        params.delete("categoryId")
      }

      if (newDateFrom) {
        params.set("dateFrom", newDateFrom)
      } else {
        params.delete("dateFrom")
      }

      if (newDateTo) {
        params.set("dateTo", newDateTo)
      } else {
        params.delete("dateTo")
      }

      // Reset to page 1 on filter change
      params.delete("page")

      router.push(`/transactions?${params.toString()}`)
    },
    [router, searchParams]
  )

  // Debounced filter application — 300ms
  const scheduleApply = useCallback(
    (newType: string, newCategory: string, newDateFrom: string, newDateTo: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        applyFilters(newType, newCategory, newDateFrom, newDateTo)
      }, 300)
    },
    [applyFilters]
  )

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  function handleTypeChange(value: string | null) {
    const newType = value ?? "all"
    setTypeFilter(newType)
    scheduleApply(newType, categoryFilter, dateFrom, dateTo)
  }

  function handleCategoryChange(value: string | null) {
    const newCategory = value ?? "all"
    setCategoryFilter(newCategory)
    scheduleApply(typeFilter, newCategory, dateFrom, dateTo)
  }

  function handleDateFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDateFrom = e.target.value
    setDateFrom(newDateFrom)
    scheduleApply(typeFilter, categoryFilter, newDateFrom, dateTo)
  }

  function handleDateToChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDateTo = e.target.value
    setDateTo(newDateTo)
    scheduleApply(typeFilter, categoryFilter, dateFrom, newDateTo)
  }

  function handleClearFilters() {
    setTypeFilter("all")
    setCategoryFilter("all")
    setDateFrom("")
    setDateTo("")
    router.push("/transactions")
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(newPage))
    router.push(`/transactions?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={typeFilter} onValueChange={handleTypeChange}>
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
          <Select value={categoryFilter} onValueChange={handleCategoryChange}>
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
            onChange={handleDateFromChange}
            className="w-[160px] h-8"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={handleDateToChange}
            className="w-[160px] h-8"
          />
        </div>

        {isFiltersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="text-muted-foreground"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table or empty state */}
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-lg font-medium">No transactions yet</p>
          <p className="text-muted-foreground max-w-sm">
            Transactions appear here automatically when payments and creditor repayments are recorded.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Recorded By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} data-testid="data-row">
                    <TableCell className="font-mono tabular-nums">{formatDate(tx.transactionDate)}</TableCell>
                    <TableCell>
                      {tx.type === "credit" ? (
                        <Badge className="text-green-600 border-green-200 bg-green-50">
                          CR
                        </Badge>
                      ) : (
                        <Badge className="text-blue-600 border-blue-200 bg-blue-50">
                          DR
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{tx.categoryName}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {tx.description ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-right font-mono tabular-nums"
                    >
                      {formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {tx.recordedBy}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-mono tabular-nums">{(page - 1) * pageSize + 1}</span>&ndash;<span className="font-mono tabular-nums">{Math.min(page * pageSize, total)}</span> of <span className="font-mono tabular-nums">{total}</span> transactions
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * pageSize >= total}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
