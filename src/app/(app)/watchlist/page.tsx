"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useLoans } from "@/hooks/use-loans"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Button } from "@/components/ui/button"
import type { LoanListEntry } from "@/types"
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils"

type FilterCategory = "all" | "critical" | "at-risk" | "early"

function categorize(daysOverdue: number): Exclude<FilterCategory, "all"> {
  if (daysOverdue >= 30) return "critical"
  if (daysOverdue >= 15) return "at-risk"
  return "early"
}

export default function WatchlistPage() {
  const router = useRouter()
  const { data: allLoans, isLoading: loading, error: queryError, dataUpdatedAt } = useLoans()
  // Watchlist = overdue active loans only
  const entries = (allLoans ?? []).filter((l) => l.status === "active" && l.daysOverdue > 0)
  const error = queryError?.message ?? null
  const calculatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date()

  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all")

  // Categorized entries
  const { critical, atRisk, early } = useMemo(() => {
    const groups = { critical: [] as LoanListEntry[], atRisk: [] as LoanListEntry[], early: [] as LoanListEntry[] }
    for (const entry of entries) {
      const cat = categorize(entry.daysOverdue)
      if (cat === "critical") groups.critical.push(entry)
      else if (cat === "at-risk") groups.atRisk.push(entry)
      else groups.early.push(entry)
    }
    return groups
  }, [entries])

  // Stats
  const stats = useMemo(() => {
    function totalBalance(list: LoanListEntry[]) {
      return list.reduce((sum, e) => sum + parseFloat(e.outstandingBalance), 0)
    }
    return {
      critical: { count: critical.length, balance: totalBalance(critical) },
      atRisk: { count: atRisk.length, balance: totalBalance(atRisk) },
      early: { count: early.length, balance: totalBalance(early) },
      total: entries.length,
    }
  }, [critical, atRisk, early, entries.length])

  // Filtered rows
  const filteredEntries = useMemo(() => {
    switch (activeFilter) {
      case "critical": return critical
      case "at-risk": return atRisk
      case "early": return early
      default: return entries
    }
  }, [activeFilter, critical, atRisk, early, entries])

  const columns: Column<LoanListEntry>[] = [
    {
      key: "customerName",
      header: "Customer Name",
      cardLabel: "Customer",
      primary: true,
      render: (e) => (
        <Link
          href={`/customers/${e.customerId}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.customerName}
        </Link>
      ),
    },
    {
      key: "principalAmount",
      header: "Loan Amount",
      cardLabel: "Loan",
      align: "right",
      render: (e) => formatCurrency(e.principalAmount),
    },
    {
      key: "outstandingBalance",
      header: "Outstanding Balance",
      cardLabel: "Outstanding",
      align: "right",
      render: (e) => formatCurrency(e.outstandingBalance),
    },
    {
      key: "daysOverdue",
      header: "Days Overdue",
      cardLabel: "Overdue",
      render: (e) => <OverdueBadge daysOverdue={e.daysOverdue} />,
    },
    {
      key: "interestOwed",
      header: "Interest Owed",
      cardLabel: "Interest Owed",
      align: "right",
      render: (e) => {
        const interest = e.daysOverdue * parseFloat(e.dailyRate)
        return formatCurrency(interest)
      },
    },
    {
      key: "dailyRate",
      header: "Daily Rate (UGX)",
      cardLabel: "Daily Rate",
      align: "right",
      render: (e) => formatCurrency(e.dailyRate),
    },
    {
      key: "lastPayment",
      header: "Last Payment",
      cardLabel: "Last Paid",
      render: (e) => (
        <span className="font-mono tabular-nums">
          {e.lastPaymentDate ? formatDate(e.lastPaymentDate) : "No payments"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      hideInCard: false,
      render: (e) => (
        <Link
          href={`/loans/${e.id}`}
          className="text-sm text-primary underline-offset-4 hover:underline whitespace-nowrap"
          onClick={(ev) => ev.stopPropagation()}
        >
          View Loan
        </Link>
      ),
    },
  ]

  const filterTabs: { key: FilterCategory; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "critical", label: "Critical (30+)", count: stats.critical.count },
    { key: "at-risk", label: "At Risk (15-29)", count: stats.atRisk.count },
    { key: "early", label: "Early (1-14)", count: stats.early.count },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overdue Loans</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Dashboard for all overdue and at-risk loans
        </p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Last calculated: {formatDateTime(calculatedAt)}
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border rounded-md p-4 space-y-2">
              <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-24 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center">
          <h2 className="text-lg font-semibold">All borrowers are current.</h2>
          <p className="text-sm text-muted-foreground mt-2">
            No borrowers are overdue. Check back after the next payment cycle.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => setActiveFilter("critical")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "critical" ? "ring-2 ring-red-500" : ""
              } bg-red-100 dark:bg-red-950 hover:bg-red-200 dark:hover:bg-red-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-red-800 dark:text-red-300">
                Critical (30+ days)
              </p>
              <p className="text-2xl font-bold text-red-800 dark:text-red-300 mt-1">
                {stats.critical.count}
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                {formatCurrency(stats.critical.balance)} outstanding
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("at-risk")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "at-risk" ? "ring-2 ring-yellow-500" : ""
              } bg-yellow-100 dark:bg-yellow-950 hover:bg-yellow-200 dark:hover:bg-yellow-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-yellow-800 dark:text-yellow-300">
                At Risk (15-29 days)
              </p>
              <p className="text-2xl font-bold text-yellow-800 dark:text-yellow-300 mt-1">
                {stats.atRisk.count}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                {formatCurrency(stats.atRisk.balance)} outstanding
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("early")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "early" ? "ring-2 ring-green-500" : ""
              } bg-green-100 dark:bg-green-950 hover:bg-green-200 dark:hover:bg-green-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-green-800 dark:text-green-300">
                Early (1-14 days)
              </p>
              <p className="text-2xl font-bold text-green-800 dark:text-green-300 mt-1">
                {stats.early.count}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                {formatCurrency(stats.early.balance)} outstanding
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "all" ? "ring-2 ring-primary" : ""
              } bg-muted/50 hover:bg-muted`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Overdue
              </p>
              <p className="text-2xl font-bold mt-1">
                {stats.total}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                all categories
              </p>
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            {filterTabs.map((tab) => (
              <Button
                key={tab.key}
                variant={activeFilter === tab.key ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label} ({tab.count})
              </Button>
            ))}
          </div>

          {/* Table */}
          {filteredEntries.length === 0 ? (
            <div className="py-16 text-center">
              <h2 className="text-lg font-semibold">No loans in this category</h2>
              <p className="text-sm text-muted-foreground mt-2">
                There are no overdue loans matching this filter.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setActiveFilter("all")}
              >
                Show all overdue loans
              </Button>
            </div>
          ) : (
            <ResponsiveTable
              columns={columns}
              rows={filteredEntries}
              getRowKey={(e) => e.id}
              getRowProps={(e) => ({
                "data-testid": "data-row",
                className: "cursor-pointer hover:bg-muted/50",
                onClick: () => router.push(`/customers/${e.customerId}`),
                role: "button",
                "aria-label": `View ${e.customerName}'s profile`,
              })}
            />
          )}
        </>
      )}
    </div>
  )
}
