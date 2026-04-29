"use client"

import { useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useLoansWithBalances } from "@/collections/loan-views"
import { Plus, ChevronRight, Loader2, Printer } from "lucide-react"
import { CustomerPickerDialog } from "@/components/customers/customer-picker-dialog"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LoanListEntry } from "@/types"
import { cn, formatDate, formatDateTime, formatCurrency } from "@/lib/utils"
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Builds an HTML document that mirrors the columns and totals of
 * generateLoansExcel (src/services/export/excel.service.ts) for printing.
 */
function buildLoansPrintHtml(entries: LoanListEntry[]): string {
  const generated = formatDate(new Date())
  let totalPrincipal = 0
  let totalOutstanding = 0
  let totalOwed = 0
  let totalInterest = 0

  const rows = entries.map((e) => {
    const principal = parseFloat(e.principalAmount)
    const outstanding = parseFloat(e.outstandingBalance)
    const interest = parseFloat(e.unpaidInterest)
    const owed = outstanding + interest
    totalPrincipal += principal
    totalOutstanding += outstanding
    totalOwed += owed
    totalInterest += interest
    const last = e.lastPaymentDate ? formatDate(e.lastPaymentDate) : "No payments"
    return `<tr>
      <td>${escapeHtml(e.customerName)}</td>
      <td>${escapeHtml(e.customerContact ?? "")}</td>
      <td class="num">${formatCurrency(e.principalAmount)}</td>
      <td class="num">${formatCurrency(e.outstandingBalance)}</td>
      <td class="num">${formatCurrency(owed.toFixed(2))}</td>
      <td class="num">${formatCurrency(e.unpaidInterest)}</td>
      <td class="num">${e.daysOverdue}</td>
      <td>${escapeHtml(last)}</td>
    </tr>`
  }).join("")

  const countLabel = `${entries.length} loan${entries.length === 1 ? "" : "s"}`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Kaks Credit — Active Loans Report</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  .meta { color: #555; font-size: 10pt; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #1f2937; color: #fff; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f7f7f9; }
  tfoot td { background: #1f2937; color: #fff; font-weight: 700; }
</style>
</head>
<body>
  <h1>Kaks Credit — Active Loans Report</h1>
  <div class="meta">Generated: ${escapeHtml(generated)} · ${escapeHtml(countLabel)}</div>
  <table>
    <thead>
      <tr>
        <th>Customer Name</th>
        <th>Contact</th>
        <th class="num">Principal Amount (UGX)</th>
        <th class="num">Principal Balance (UGX)</th>
        <th class="num">Total Due (UGX)</th>
        <th class="num">Accrued Interest (UGX)</th>
        <th class="num">Days Overdue</th>
        <th>Last Payment</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#666;padding:24px;">No loans</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td>TOTAL</td>
        <td></td>
        <td class="num">${formatCurrency(totalPrincipal.toFixed(2))}</td>
        <td class="num">${formatCurrency(totalOutstanding.toFixed(2))}</td>
        <td class="num">${formatCurrency(totalOwed.toFixed(2))}</td>
        <td class="num">${formatCurrency(totalInterest.toFixed(2))}</td>
        <td></td>
        <td>${escapeHtml(countLabel)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`
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

  const handlePrint = useCallback(() => {
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.left = "-9999px"
    iframe.style.top = "-9999px"
    iframe.srcdoc = buildLoansPrintHtml(filteredEntries)
    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe)
      }, 1000)
    }
    document.body.appendChild(iframe)
  }, [filteredEntries])

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
          {/* Stat Cards — quiet filter buttons; severity signaled via dot, not background */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:hidden">
            {([
              {
                key: "critical",
                label: "Critical (30+ days)",
                dotClass: "bg-red-500",
                count: stats.critical.count,
                balance: stats.critical.balance,
                info: (
                  <>
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
                  </>
                ),
              },
              {
                key: "at-risk",
                label: "At Risk (25-29 days)",
                dotClass: "bg-yellow-500",
                count: stats.atRisk.count,
                balance: stats.atRisk.balance,
                info: (
                  <>
                    <p className="font-semibold text-sm mb-1">At Risk (25-29 days)</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      Loans approaching the 30-day overdue threshold. These borrowers are close to becoming critical &mdash; a payment now would prevent escalation.
                    </p>
                    <p className="text-xs text-muted-foreground">Proactive contact is recommended.</p>
                  </>
                ),
              },
              {
                key: "early",
                label: "Early (0-24 days)",
                dotClass: "bg-green-500",
                count: stats.early.count,
                balance: stats.early.balance,
                info: (
                  <>
                    <p className="font-semibold text-sm mb-1">Early (0-24 days)</p>
                    <p className="text-xs text-muted-foreground">
                      Loans with some overdue interest but still within the first interest cycle. These are normal operational loans that need routine collection.
                    </p>
                  </>
                ),
              },
              {
                key: "all",
                label: "All Loans",
                dotClass: "bg-foreground/40",
                count: sortedEntries.length,
                balance: null as string | null,
                overdueText: `${stats.total} overdue`,
                info: (
                  <>
                    <p className="font-semibold text-sm mb-1">All Loans</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      Total count of all active loans regardless of overdue status.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      The &ldquo;overdue&rdquo; count shown is loans with any days overdue (&gt; 0). Click to remove filters and see the full portfolio.
                    </p>
                  </>
                ),
              },
            ] as const).map((card) => {
              const isActive = activeFilter === card.key
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() =>
                    setActiveFilter(card.key === "all" ? "all" : isActive ? "all" : card.key)
                  }
                  className={cn(
                    "group relative rounded-xl border bg-card p-4 text-left transition-all duration-150 ease-out shadow-xs",
                    "hover:shadow-md hover:-translate-y-0.5",
                    isActive
                      ? "border-foreground/40 ring-2 ring-foreground/15"
                      : "border-border/60 hover:border-border"
                  )}
                  aria-pressed={isActive}
                >
                  <div className="space-y-3">
                    {/* Label row: dot + label + info — proximity groups them, alignment via flex */}
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className={cn("h-1.5 w-1.5 rounded-full shrink-0", card.dotClass)}
                      />
                      <p className="text-sm font-medium text-foreground/80">{card.label}</p>
                      <InfoPopover>{card.info}</InfoPopover>
                    </div>
                    {/* Hero number — same scale across all 4 cards (repetition) */}
                    <p className="text-3xl font-semibold tracking-tight tabular-nums">
                      {card.count}
                    </p>
                    {/* Subtitle — uniform line height across cards (alignment) */}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {card.balance != null
                        ? `${formatCurrency(card.balance)} outstanding`
                        : ("overdueText" in card ? card.overdueText : "Total portfolio")}
                    </p>
                  </div>
                </button>
              )
            })}
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
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" />
              Print
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
