"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format, addDays, subDays } from "date-fns"
import { ChevronLeft, ChevronRight, CalendarIcon, Banknote, FileText, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { useDailyCollections, useLoansDueToday } from "@/hooks/use-daily-collections"
import { formatNumberWithCommas, formatDate } from "@/lib/utils"
import BigNumber from "bignumber.js"

export function DailyCollectionsTab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const todayStr = format(new Date(), "yyyy-MM-dd")
  const dateParam = searchParams.get("date") ?? todayStr
  const [selectedDate, setSelectedDate] = useState(dateParam)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const { data: collections, isLoading: collectionsLoading, isError: collectionsError } = useDailyCollections(selectedDate)
  const { data: dueLoans, isLoading: dueLoading, isError: dueError } = useLoansDueToday()

  function navigateDate(delta: -1 | 1) {
    const current = new Date(selectedDate + "T12:00:00")
    const next = delta === 1 ? addDays(current, 1) : subDays(current, 1)
    const nextStr = format(next, "yyyy-MM-dd")
    setSelectedDate(nextStr)
    updateUrl(nextStr)
  }

  function handleCalendarSelect(date: Date | undefined) {
    if (!date) return
    const dateStr = format(date, "yyyy-MM-dd")
    setSelectedDate(dateStr)
    updateUrl(dateStr)
    setCalendarOpen(false)
  }

  function updateUrl(date: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "daily")
    params.set("date", date)
    router.push(`/payments?${params.toString()}`)
  }

  const totalCollected = collections?.totalCollected ?? "0.00"
  const paymentCount = collections?.paymentCount ?? 0
  const avgPayment =
    paymentCount > 0
      ? new BigNumber(totalCollected).dividedBy(paymentCount).toFixed(2)
      : null

  const formattedDate = format(new Date(selectedDate + "T12:00:00"), "EEE, MMM d, yyyy")

  return (
    <div className="space-y-4 pt-4">
      {/* Date Navigation Bar */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          onClick={() => navigateDate(-1)}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex min-w-[180px] items-center justify-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-left hover:bg-accent hover:text-accent-foreground"
              />
            }
          >
            <CalendarIcon className="h-4 w-4" />
            {selectedDate === todayStr
              ? "Today"
              : format(new Date(selectedDate + "T12:00:00"), "EEE, MMM d")}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={new Date(selectedDate + "T12:00:00")}
              onSelect={handleCalendarSelect}
              disabled={(date) => date > new Date()}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          onClick={() => navigateDate(1)}
          disabled={selectedDate >= todayStr}
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        {collectionsLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="animate-pulse bg-muted rounded h-8 w-24" />
                  <div className="animate-pulse bg-muted rounded h-4 w-16 mt-2" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <KpiCard
              label="Total Collected"
              value={`UGX ${formatNumberWithCommas(totalCollected)}`}
              icon={Banknote}
            />
            <KpiCard
              label="Payments"
              value={String(paymentCount)}
              icon={FileText}
            />
            <KpiCard
              label="Average Payment"
              value={avgPayment ? `UGX ${formatNumberWithCommas(avgPayment)}` : "\u2014"}
              icon={BarChart3}
            />
          </>
        )}
      </div>

      {/* Collections Breakdown Section */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold">Collections on {formattedDate}</h2>
        {collectionsError && (
          <p className="text-sm text-destructive mt-1">
            Could not load collections. Refresh the page to try again.
          </p>
        )}
        {collectionsLoading ? (
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Amount (UGX)</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3].map((i) => (
                <TableRow key={i}>
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <TableCell key={j}>
                      <div className="animate-pulse bg-muted rounded h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (collections?.rows?.length ?? 0) === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg font-medium">No collections on this date</p>
            <p className="text-sm text-muted-foreground mt-1">
              No payments were recorded for {formattedDate}.
            </p>
          </div>
        ) : (
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Amount (UGX)</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections!.rows.map((row) => (
                <TableRow key={row.paymentId}>
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell>
                    <span className="text-xs font-mono">
                      LOAN-{row.loanId.slice(0, 8).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell>UGX {formatNumberWithCommas(row.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    UGX {formatNumberWithCommas(row.interestPortion)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    UGX {formatNumberWithCommas(row.principalPortion)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(row.paymentDate), "HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Due Today Section */}
      <div className="mt-12">
        <h2 className="text-xl font-semibold">Due Today</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Active loans with no payment in 30 or more days
        </p>
        {dueError && (
          <p className="text-sm text-destructive mt-1">
            Could not load due loans. Refresh the page to try again.
          </p>
        )}
        {dueLoading ? (
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Outstanding Balance</TableHead>
                <TableHead>Days Since Last Payment</TableHead>
                <TableHead>Last Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3].map((i) => (
                <TableRow key={i}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <TableCell key={j}>
                      <div className="animate-pulse bg-muted rounded h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (dueLoans?.length ?? 0) === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg font-medium">All loans are up to date</p>
            <p className="text-sm text-muted-foreground mt-1">
              No active loans are overdue for payment.
            </p>
          </div>
        ) : (
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Outstanding Balance</TableHead>
                <TableHead>Days Since Last Payment</TableHead>
                <TableHead>Last Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueLoans!.map((loan) => (
                <TableRow key={loan.loanId}>
                  <TableCell>{loan.customerName}</TableCell>
                  <TableCell>
                    <span className="text-xs font-mono">
                      LOAN-{loan.loanId.slice(0, 8).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell>UGX {formatNumberWithCommas(loan.outstandingBalance)}</TableCell>
                  <TableCell>
                    <OverdueBadge daysOverdue={loan.daysSinceLastPayment} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {loan.lastPaymentDate ? formatDate(loan.lastPaymentDate) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
