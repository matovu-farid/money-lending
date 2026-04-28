"use client"

import { useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useLoansWithBalances } from "@/collections/loan-views"
import { Plus, ChevronRight, Loader2 } from "lucide-react"
import { CustomerPickerDialog } from "@/components/customers/customer-picker-dialog"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LoanListEntry } from "@/types"
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils"
import { isPenaltyActive } from "@/lib/interest/effective-rate"
import { exportLoansExcelAction } from "@/actions/loan.actions"
import { toast } from "sonner"
import { Download } from "lucide-react"
import { downloadBase64 } from "@/lib/download"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { LoanTypeBadge } from "@/components/loans/loan-type-badge"

type FilterCategory = "all" | "critical" | "at-risk" | "early"

function categorize(daysOverdue: number): Exclude<FilterCategory, "all"> {
  if (daysOverdue >= 30) return "critical"
  if (daysOverdue >= 25) return "at-risk"
  return "early"
}

function criticalityRank(entry: LoanListEntry): number {
  if (entry.daysOverdue >= 30) return 0
  if (entry.daysOverdue >= 25) return 1
  if (entry.daysOverdue >= 0) return 2
  return 3
}


export default function LoansPage() {
  const router = useRouter()
  const { data, isLoading } = useLoansWithBalances()
  const entries = data ?? []
  const error: string | null = null
  const calculatedAt = new Date()

  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all")
  const [isExporting, setIsExporting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null)

  const handleExportExcel = useCallback(async () => {
    setIsExporting(true)
    try {
      const result = await exportLoansExcelAction(activeFilter)
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (!result.data) return

      const dateStr = new Date().toISOString().slice(0, 10)
      downloadBase64(
        result.data,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        `sovereign-ledger-loans-${dateStr}.xlsx`,
      )
      toast.success("Excel file downloaded")
    } catch {
      toast.error("Failed to export loans")
    } finally {
      setIsExporting(false)
    }
  }, [activeFilter])

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const rankDiff = criticalityRank(a) - criticalityRank(b)
      if (rankDiff !== 0) return rankDiff
      return b.daysOverdue - a.daysOverdue
    })
  }, [entries])

  const { critical, atRisk, early } = useMemo(() => {
    const groups = {
      critical: [] as LoanListEntry[],
      atRisk: [] as LoanListEntry[],
      early: [] as LoanListEntry[],
    }
    for (const entry of sortedEntries) {
      if (entry.daysOverdue < 0) continue
      const cat = categorize(entry.daysOverdue)
      if (cat === "critical") groups.critical.push(entry)
      else if (cat === "at-risk") groups.atRisk.push(entry)
      else groups.early.push(entry)
    }
    return groups
  }, [sortedEntries])

  const stats = useMemo(() => {
    function totalBalance(list: LoanListEntry[]) {
      return list.reduce((sum, e) => sum + parseFloat(e.outstandingBalance), 0)
    }
    return {
      critical: { count: critical.length, balance: totalBalance(critical) },
      atRisk: { count: atRisk.length, balance: totalBalance(atRisk) },
      early: { count: early.length, balance: totalBalance(early) },
      total: critical.length + atRisk.length + early.length,
    }
  }, [critical, atRisk, early])

  const filteredEntries = useMemo(() => {
    switch (activeFilter) {
      case "critical":
        return critical
      case "at-risk":
        return atRisk
      case "early":
        return early
      default:
        return sortedEntries
    }
  }, [activeFilter, critical, atRisk, early, sortedEntries])

  const handleLoanPrefetch = useCallback((loanId: string) => {
    router.prefetch(`/loans/${loanId}`)
  }, [router])

  const handleRowClick = useCallback((loanId: string) => {
    setNavigatingTo(loanId)
    router.push(`/loans/${loanId}`)
  }, [router])

  const columns: Column<LoanListEntry>[] = [
    {
      key: "customerName",
      header: "Customer Name",
      cardLabel: "Customer",
      primary: true,
      render: (e) => (
        <span className="font-medium">{e.customerName}</span>
      ),
    },
    {
      key: "principalAmount",
      header: (
        <span className="inline-flex items-center gap-1">
          Principal Amount
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Principal Amount</p>
            <p className="text-xs text-muted-foreground mb-2">
              The original amount disbursed to the borrower.
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              This does not change &mdash; it&apos;s the base amount the loan was issued for.
            </p>
            <p className="text-xs text-muted-foreground">
              Interest is calculated on the outstanding balance, not the original principal.
            </p>
          </InfoPopover>
        </span>
      ),
      cardLabel: "Principal",
      render: (e) => formatCurrency(e.principalAmount),
    },
    {
      key: "outstandingBalance",
      header: (
        <span className="inline-flex items-center gap-1">
          Principal Balance
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Principal Balance</p>
            <p className="text-xs text-muted-foreground mb-2">
              The remaining principal that the borrower still owes.
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Starts equal to the principal amount and decreases as payments are made.
            </p>
            <p className="text-xs font-semibold mb-1">Formula</p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
              Principal Balance = Principal &minus; Total Principal Payments Made
            </p>
            <p className="text-xs text-muted-foreground">
              Note: This does NOT include unpaid interest.
            </p>
          </InfoPopover>
        </span>
      ),
      cardLabel: "Principal Bal.",
      render: (e) => formatCurrency(e.outstandingBalance),
    },
    {
      key: "totalOwed",
      header: (
        <span className="inline-flex items-center gap-1">
          Total Due
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Total Due</p>
            <p className="text-xs text-muted-foreground mb-2">
              The total amount the borrower must pay right now to fully settle the loan.
            </p>
            <p className="text-xs font-semibold mb-1">Formula</p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
              Total Due = Principal Balance + Unpaid Interest
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Where Unpaid Interest = Total Interest Accrued &minus; Total Interest Paid
            </p>
            <p className="text-xs text-muted-foreground">
              This figure changes daily as interest continues to accrue.
            </p>
          </InfoPopover>
        </span>
      ),
      cardLabel: "Total Due",
      render: (e) => {
        const totalOwed = parseFloat(e.outstandingBalance) + parseFloat(e.unpaidInterest)
        return formatCurrency(totalOwed.toString())
      },
    },
    {
      key: "daysOverdue",
      header: (
        <span className="inline-flex items-center gap-1">
          Days Overdue
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Days Overdue</p>
            <p className="text-xs text-muted-foreground mb-2">
              How many days of interest remain unpaid on this loan.
            </p>
            <p className="text-xs font-semibold mb-1">Formula</p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
              Days Overdue = (Total Interest Accrued − Total Interest Paid) ÷ Daily Interest Amount
            </p>
            <p className="text-xs text-muted-foreground mb-1">Where:</p>
            <ul className="text-xs text-muted-foreground mb-2 list-disc pl-4 space-y-0.5">
              <li>Total Interest Accrued = Principal × (Monthly Rate ÷ 30) × Days Since Loan Start</li>
              <li>Daily Interest Amount = Principal × (Monthly Rate ÷ 30)</li>
            </ul>
            <p className="text-xs font-semibold mb-1">Example</p>
            <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
              <p>Loan: UGX 1,000,000 at 10% per month</p>
              <p>Daily interest = 1,000,000 × (0.10 ÷ 30) = UGX 3,333</p>
              <p>After 45 days, interest accrued = UGX 150,000</p>
              <p>If UGX 100,000 interest paid → Unpaid = UGX 50,000</p>
              <p>Days overdue = 50,000 ÷ 3,333 ≈ <strong>15 days</strong></p>
            </div>
          </InfoPopover>
        </span>
      ),
      cardLabel: "Overdue",
      render: (e) =>
        e.daysOverdue > 0 ? (
          <div className="flex items-center gap-1.5">
            <OverdueBadge daysOverdue={e.daysOverdue} />
            {isPenaltyActive(e.daysOverdue, e.penaltyWaived) && (
              <Badge variant="destructive" className="rounded-full text-[10px] px-1.5">
                Penalty
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "loanType",
      header: "Type",
      cardLabel: "Type",
      render: (e) => <LoanTypeBadge loanType={e.loanType} />,
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
      key: "chevron",
      header: "",
      hideInCard: true,
      render: (e) =>
        navigatingTo === e.id ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ),
    },
  ]


  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <PageHeader title="Loans" subtitle="All loans sorted by risk level" />
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Last calculated: {formatDateTime(calculatedAt)}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border rounded-md p-4 space-y-2">
              <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-24 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center">
          <h2 className="text-lg font-semibold">No loans yet.</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Issue your first loan by selecting a customer.
          </p>
          <Button className="mt-4" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" />
            Issue Loan
          </Button>
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 print:hidden">
            <button
              type="button"
              onClick={() => setActiveFilter(activeFilter === "critical" ? "all" : "critical")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "critical" ? "ring-2 ring-red-500" : ""
              } bg-red-100 dark:bg-red-950 hover:bg-red-200 dark:hover:bg-red-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-red-800 dark:text-red-300 inline-flex items-center gap-1">
                Critical (30+ days)
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Critical (30+ days)</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Loans where unpaid interest has accumulated for 30 or more days. These borrowers have missed at least one full interest cycle.
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Immediate follow-up is recommended to prevent further losses.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The &ldquo;principal balance&rdquo; amount shown is the remaining principal for loans in this category.
                  </p>
                </InfoPopover>
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
              onClick={() => setActiveFilter(activeFilter === "at-risk" ? "all" : "at-risk")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "at-risk" ? "ring-2 ring-yellow-500" : ""
              } bg-yellow-100 dark:bg-yellow-950 hover:bg-yellow-200 dark:hover:bg-yellow-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-yellow-800 dark:text-yellow-300 inline-flex items-center gap-1">
                At Risk (25-29 days)
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">At Risk (25-29 days)</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Loans approaching the 30-day overdue threshold. These borrowers are close to becoming critical &mdash; a payment now would prevent escalation.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Proactive contact is recommended.
                  </p>
                </InfoPopover>
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
              onClick={() => setActiveFilter(activeFilter === "early" ? "all" : "early")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                activeFilter === "early" ? "ring-2 ring-green-500" : ""
              } bg-green-100 dark:bg-green-950 hover:bg-green-200 dark:hover:bg-green-900`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-green-800 dark:text-green-300 inline-flex items-center gap-1">
                Early (0-24 days)
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Early (0-24 days)</p>
                  <p className="text-xs text-muted-foreground">
                    Loans with some overdue interest but still within the first interest cycle. These are normal operational loans that need routine collection.
                  </p>
                </InfoPopover>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                All Loans
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">All Loans</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Total count of all active loans regardless of overdue status.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The &ldquo;overdue&rdquo; count shown is loans with any days overdue (&gt; 0). Click to remove filters and see the full portfolio.
                  </p>
                </InfoPopover>
              </p>
              <p className="text-2xl font-bold mt-1">{sortedEntries.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stats.total} overdue
              </p>
            </button>
          </div>

          {/* Actions Row */}
          <div className="flex items-center justify-end gap-2 print:hidden">
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" />
              Issue Loan
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              disabled={isExporting}
            >
              <Download className="h-4 w-4" />
              {isExporting ? "Exporting..." : "Export Excel"}
            </Button>
          </div>

          {/* Filter empty state */}
          {filteredEntries.length === 0 && activeFilter !== "all" ? (
            <div className="py-12 text-center">
              <h2 className="text-lg font-semibold">No loans in this category.</h2>
              <p className="text-sm text-muted-foreground mt-2">
                No loans match the selected filter. Try a different category.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setActiveFilter("all")}
              >
                Show all loans
              </Button>
            </div>
          ) : (
            <ResponsiveTable
              columns={columns}
              rows={filteredEntries}
              getRowKey={(e) => e.id}
              getRowProps={(e) => ({
                "data-testid": "data-row",
                className: `cursor-pointer hover:bg-muted/50 ${navigatingTo === e.id ? "opacity-70" : ""}`,
                onClick: () => handleRowClick(e.id),
                onMouseEnter: () => handleLoanPrefetch(e.id),
                onFocus: () => handleLoanPrefetch(e.id),
                role: "button",
                "aria-label": `View loan for ${e.customerName}`,
              })}
            />
          )}
        </>
      )}
      <CustomerPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  )
}
