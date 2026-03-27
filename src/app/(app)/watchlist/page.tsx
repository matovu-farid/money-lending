"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { getWatchlistAction } from "@/actions/watchlist.actions"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import type { WatchlistEntry } from "@/types"
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils"

export default function WatchlistPage() {
  const router = useRouter()
  const { data, isLoading: loading, error: queryError, dataUpdatedAt } = useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const result = await getWatchlistAction()
      if (result.error) throw new Error(result.error)
      return result.data!
    },
  })
  const entries = data ?? []
  const error = queryError?.message ?? null
  const calculatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Overdue and at-risk loans</p>
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
            No borrowers have exceeded the 30-day threshold. Check back after the next payment cycle.
          </p>
        </div>
      ) : (
        <ResponsiveTable
          columns={[
            {
              key: "customerName",
              header: "Customer Name",
              cardLabel: "Customer",
              primary: true,
              render: (e) => <span className="font-medium">{e.customerName}</span>,
            },
            {
              key: "loanAmount",
              header: "Loan Amount",
              cardLabel: "Loan",
              align: "right",
              render: (e) => formatCurrency(e.loanAmount),
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
              render: (e) => <OverdueBadge daysOverdue={parseInt(e.daysOverdue)} />,
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
          ] as Column<WatchlistEntry>[]}
          rows={entries}
          getRowKey={(e) => e.loanId}
          getRowProps={(e) => ({
            "data-testid": "data-row",
            className: "cursor-pointer hover:bg-muted/50",
            onClick: () => router.push(`/customers/${e.customerId}`),
            role: "button",
            "aria-label": `View ${e.customerName}'s profile`,
          })}
        />
      )}
    </div>
  )
}
