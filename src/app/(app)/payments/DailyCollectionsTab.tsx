"use client"

import { useState, useEffect, Suspense } from "react"
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
import { KpiCard } from "@/components/dashboard/kpi-card"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { useDailyCollections, useLoansDueToday } from "@/hooks/use-daily-collections"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatCurrency, formatNumberWithCommas, formatDate, shortId } from "@/lib/utils"
import BigNumber from "bignumber.js"

export function DailyCollectionsTab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const todayStr = format(new Date(), "yyyy-MM-dd")
  const dateParam = searchParams.get("date") ?? todayStr
  const [selectedDate, setSelectedDate] = useState(dateParam)
  const [calendarOpen, setCalendarOpen] = useState(false)

  // Sync selectedDate with URL param on browser back/forward navigation
  useEffect(() => { setSelectedDate(dateParam) }, [dateParam])

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
              <Button
                variant="outline"
                className="min-w-[180px] justify-start gap-2 font-normal"
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
              endMonth={new Date()}
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

      <Suspense fallback={<LoadingSkeleton />}>
        <DailyCollectionsContent selectedDate={selectedDate} />
      </Suspense>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted-foreground/10 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

function DailyCollectionsContent({ selectedDate }: { selectedDate: string }) {
  const { data: collections } = useDailyCollections(selectedDate)
  const { data: dueLoans } = useLoansDueToday()

  const totalCollected = collections?.totalCollected ?? "0.00"
  const paymentCount = collections?.paymentCount ?? 0
  const avgPayment =
    paymentCount > 0
      ? new BigNumber(totalCollected).dividedBy(paymentCount).toFixed(0)
      : null

  const formattedDate = format(new Date(selectedDate + "T12:00:00"), "EEE, MMM d, yyyy")

  return (
    <>
      {/* Summary Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
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
      </div>

      {/* Collections Breakdown Section */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold">Collections on {formattedDate}</h2>
        {(collections?.rows?.length ?? 0) === 0 ? (
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
                <TableHead className="text-right">Amount (UGX)</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections!.rows.map((row) => (
                <TableRow key={row.paymentId} data-testid="data-row">
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell>
                    <span className="text-xs font-mono tabular-nums">
                      LOAN-{shortId(row.loanId).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.amount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.interestPortion)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.principalPortion)}</TableCell>
                  <TableCell className="font-mono tabular-nums text-muted-foreground">
                    {formatDate(row.paymentDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Due Today Section */}
      <div className="mt-12">
        <h2 className="text-xl font-semibold inline-flex items-center gap-1.5">
          Due Today
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Due Today</p>
            <p className="text-xs text-muted-foreground mb-2">
              Loans where 30 or more days have passed since the last payment (or since the loan started if no payments exist). These borrowers owe at least one full month of interest.
            </p>
            <p className="text-xs text-muted-foreground">
              Collecting from these loans first helps prevent them from becoming critically overdue.
            </p>
          </InfoPopover>
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Active loans with no payment in 30 or more days
        </p>
        {(dueLoans?.length ?? 0) === 0 ? (
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
                <TableHead className="text-right">Principal Balance</TableHead>
                <TableHead>Days Since Last Payment</TableHead>
                <TableHead>Last Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueLoans!.map((loan) => (
                <TableRow key={loan.loanId} data-testid="data-row">
                  <TableCell>{loan.customerName}</TableCell>
                  <TableCell>
                    <span className="text-xs font-mono tabular-nums">
                      LOAN-{shortId(loan.loanId).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(loan.outstandingBalance)}</TableCell>
                  <TableCell>
                    <OverdueBadge daysOverdue={loan.daysOverdue} />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums text-muted-foreground">
                    {loan.lastPaymentDate ? formatDate(loan.lastPaymentDate) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  )
}
