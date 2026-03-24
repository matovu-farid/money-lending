"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getWatchlistAction } from "@/actions/watchlist.actions"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { WatchlistEntry } from "@/types"
import { formatDate, formatDateTime } from "@/lib/utils"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

export default function WatchlistPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [calculatedAt] = useState(() => new Date())

  useEffect(() => {
    getWatchlistAction().then((result) => {
      if (result.error) {
        setError(result.error)
      } else if (result.data) {
        setEntries(result.data)
      }
      setLoading(false)
    })
  }, [])

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
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead className="text-right">Loan Amount</TableHead>
                <TableHead className="text-right">Outstanding Balance</TableHead>
                <TableHead>Days Overdue</TableHead>
                <TableHead className="text-right">Daily Rate (UGX)</TableHead>
                <TableHead>Last Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3].map((i) => (
                <TableRow key={i}>
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-24 rounded bg-muted-foreground/10 animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center">
          <h2 className="text-lg font-semibold">All borrowers are current.</h2>
          <p className="text-sm text-muted-foreground mt-2">
            No borrowers have exceeded the 30-day threshold. Check back after the next payment cycle.
          </p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead className="text-right">Loan Amount</TableHead>
                <TableHead className="text-right">Outstanding Balance</TableHead>
                <TableHead>Days Overdue</TableHead>
                <TableHead className="text-right">Daily Rate (UGX)</TableHead>
                <TableHead>Last Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.loanId}
                  data-testid="data-row"
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/customers/${entry.customerId}`)}
                  role="button"
                  aria-label={`View ${entry.customerName}'s profile`}
                >
                  <TableCell className="font-medium">{entry.customerName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatUGX(entry.loanAmount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatUGX(entry.outstandingBalance)}</TableCell>
                  <TableCell>
                    <OverdueBadge daysOverdue={parseInt(entry.daysOverdue)} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatUGX(entry.dailyRate)}</TableCell>
                  <TableCell className="font-mono tabular-nums">{entry.lastPaymentDate ? formatDate(entry.lastPaymentDate) : "No payments"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
