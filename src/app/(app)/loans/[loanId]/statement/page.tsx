"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db"
import { format } from "date-fns"
import { ArrowLeft, Printer } from "lucide-react"
import { loanCollection } from "@/collections/loans"
import { customerCollection } from "@/collections/customers"
import { paymentCollection } from "@/collections/payments"
import { rateChangeRequestCollection } from "@/collections/rate-change-requests"
import { getUserNameMapCollection, getPaymentPortionsCollection } from "@/collections/loan-extras"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { cn, formatCurrency, formatRate, shortId } from "@/lib/utils"
import { buildLoanStatement } from "@/lib/loan-statement"
import type {
  LoanStatement,
  StatementEvent,
  CycleSnapshot,
} from "@/lib/loan-statement"
import type { RateChangeRequest, PaymentPortionsMap } from "@/types"

export default function LoanStatementPage() {
  const { loanId } = useParams<{ loanId: string }>()

  // Loan
  const { data: loans, isLoading: loansLoading } = useLiveQuery(
    (q) =>
      q
        .from({ l: loanCollection })
        .where(({ l }) => and(eq(l.id, loanId), isNull(l.deletedAt))),
    [loanId],
  )
  const loan = loans?.[0] ?? null

  // Customer
  const { data: customers } = useLiveQuery(
    (q) =>
      q
        .from({ c: customerCollection })
        .where(({ c }) => eq(c.id, loan?.customerId ?? "")),
    [loan?.customerId],
  )
  const customerName = customers?.[0]?.fullName ?? "—"

  // Payments (non-deleted)
  const { data: rawPayments } = useLiveQuery(
    (q) =>
      q
        .from({ p: paymentCollection })
        .where(({ p }) => and(eq(p.loanId, loanId), isNull(p.deletedAt))),
    [loanId],
  )
  const payments = useMemo(
    () =>
      (rawPayments ?? [])
        .slice()
        .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime()),
    [rawPayments],
  )

  // User-name resolution for "Recorded by"
  const uniqueUserIds = useMemo(
    () => [...new Set(payments.map((p) => p.recordedBy))].sort(),
    [payments],
  )
  const userNameMapColl = useMemo(
    () => getUserNameMapCollection(uniqueUserIds),
    [uniqueUserIds],
  )
  const { data: userNameMapRows } = useLiveQuery(
    (q) => q.from({ u: userNameMapColl }).select(({ u }) => u),
    [userNameMapColl],
  )
  const userNameMap: Record<string, string> = userNameMapRows?.[0]?.map ?? {}

  // Payment portions (from ledger)
  const paymentIdsKey = useMemo(
    () => payments.map((p) => p.id).sort().join(","),
    [payments],
  )
  const paymentIds = useMemo(
    () => (paymentIdsKey ? paymentIdsKey.split(",") : []),
    [paymentIdsKey],
  )
  const portionsColl = useMemo(
    () => getPaymentPortionsCollection(loanId, paymentIds),
    [loanId, paymentIds],
  )
  const { data: portionsRows } = useLiveQuery(
    (q) => q.from({ pp: portionsColl }).select(({ pp }) => pp),
    [portionsColl],
  )
  const portions: PaymentPortionsMap = portionsRows?.[0]?.portions ?? {}

  // Rate change history
  const { data: rateChanges = [] } = useLiveQuery(
    (q) =>
      q.from({ r: rateChangeRequestCollection }).where(({ r }) => eq(r.loanId, loanId)),
    [loanId],
  )

  const statement: LoanStatement | null = useMemo(() => {
    if (!loan) return null
    return buildLoanStatement({
      loan: {
        id: loan.id,
        principalAmount: loan.principalAmount,
        interestRate: loan.interestRate,
        interestRateOverride: loan.interestRateOverride,
        penaltyMultiplier: loan.penaltyMultiplier,
        penaltyWaived: loan.penaltyWaived,
        penaltyWaivedAt: loan.penaltyWaivedAt ?? null,
        penaltyWaivedBy: loan.penaltyWaivedBy ?? null,
        minInterestDays: loan.minInterestDays,
        issuanceFee: loan.issuanceFee,
        loanType: loan.loanType ?? "perpetual",
        startDate: loan.startDate,
        createdAt: loan.createdAt,
      },
      payments: payments.map((p) => {
        const portion = portions[p.id]
        return {
          paymentDate: p.paymentDate,
          amount: p.amount,
          interestPortion: portion?.interestPortion ?? "0",
          principalPortion: portion?.principalPortion ?? "0",
          recorderName: userNameMap[p.recordedBy] ?? "",
        }
      }),
      rateChanges: (rateChanges as RateChangeRequest[])
        .filter((r) => r.status === "approved")
        .map((r) => ({
          effectiveDate: r.createdAt,
          fromRate: r.currentRate,
          toRate: r.requestedRate,
        })),
      today: new Date(),
    })
  }, [loan, payments, portions, userNameMap, rateChanges])

  if (loansLoading && !loan) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <div className="h-9 w-32 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="h-8 w-64 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="h-96 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
      </div>
    )
  }

  if (!loan || !statement) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Loan not found.</p>
      </div>
    )
  }

  const loanRef = `LOAN-${shortId(loan.id).toUpperCase()}`

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Top bar — hidden on print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link
          href={`/loans/${loanId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to loan
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <h1 className="text-2xl font-semibold mb-6">Loan Statement</h1>

      <div className="text-sm font-mono space-y-8">
        <HeaderBlock
          loanRef={loanRef}
          customerName={customerName}
          statement={statement}
        />
        <TermsBlock statement={statement} />
        <EventsBlock events={statement.events} />
        <CyclesBlock cycles={statement.cycles} />
        <FinalStateBlock statement={statement} />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1 mb-3">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-right">{value}</span>
    </div>
  )
}

function HeaderBlock({
  loanRef,
  customerName,
  statement,
}: {
  loanRef: string
  customerName: string
  statement: LoanStatement
}) {
  return (
    <Section title="Statement">
      <Row label="Loan" value={loanRef} />
      <Row label="Customer" value={customerName} />
      <Row label="Generated" value={format(statement.generatedAt, "MMM d, yyyy HH:mm")} />
      <Row
        label="Period"
        value={`${format(statement.startDate, "MMM d, yyyy")} → ${format(statement.today, "MMM d, yyyy")} (${statement.daysSinceStart} days)`}
      />
    </Section>
  )
}

function TermsBlock({ statement }: { statement: LoanStatement }) {
  const t = statement.terms
  return (
    <Section title="Loan Terms">
      <Row label="Principal" value={formatCurrency(t.principal)} />
      <Row label="Base Rate" value={`${formatRate(t.baseRate)} / month`} />
      <Row
        label="Penalty Multiplier"
        value={`${formatRate(t.penaltyMultiplier)} → effective ${formatRate(t.effectiveRate)} / month when active`}
      />
      <Row
        label="Penalty Threshold"
        value={`${t.penaltyThresholdDays} days overdue`}
      />
      <Row
        label="Min Interest Period"
        value={`${t.minInterestDays} days (first payment only — subsequent payments accrue pro-rata)`}
      />
      <Row label="Loan Type" value={t.loanType} />
      <Row label="Issuance Fee" value={formatCurrency(t.issuanceFee)} />
      {t.backdated && <Row label="Backdated" value="Yes" />}
    </Section>
  )
}

function EventsBlock({ events }: { events: StatementEvent[] }) {
  return (
    <Section title={`Chronological Events (${events.length})`}>
      <div className="space-y-3">
        {events.map((e, i) => (
          <EventRow key={i} event={e} />
        ))}
      </div>
    </Section>
  )
}

function EventRow({ event }: { event: StatementEvent }) {
  const dayLabel = `Day ${event.day}`
  const dateLabel = format(event.date, "MMM d, yyyy")
  switch (event.kind) {
    case "issue":
      return (
        <div className="border-l-2 border-primary/40 pl-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-primary">Loan Issued</span>
          </div>
          <div className="text-muted-foreground space-y-0.5 mt-1">
            <div>Principal disbursed: {formatCurrency(event.principal)}</div>
            {Number(event.issuanceFee) > 0 && (
              <div>Issuance fee charged: {formatCurrency(event.issuanceFee)}</div>
            )}
            <div>Initial base rate: {formatRate(event.baseRate)} / month</div>
          </div>
        </div>
      )
    case "payment":
      return (
        <div className="border-l-2 border-emerald-500/40 pl-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-emerald-600">Payment</span>
          </div>
          <div className="text-muted-foreground space-y-0.5 mt-1">
            <div>Amount paid: {formatCurrency(event.amount)}</div>
            <div>Interest portion: {formatCurrency(event.interestPortion)}</div>
            <div>Principal portion: {formatCurrency(event.principalPortion)}</div>
            <div>
              Balance: {formatCurrency(event.balanceBefore)} → {formatCurrency(event.balanceAfter)}
            </div>
            {event.recordedBy && <div>Recorded by: {event.recordedBy}</div>}
          </div>
        </div>
      )
    case "penalty_active":
      return (
        <div className="border-l-2 border-destructive/40 pl-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-destructive">
              Penalty Activated
            </span>
          </div>
          <div className="text-muted-foreground mt-1">{event.reason}</div>
        </div>
      )
    case "penalty_waived":
      return (
        <div className="border-l-2 border-yellow-500/40 pl-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-yellow-600">
              Penalty Waived
            </span>
          </div>
          {event.waivedBy && (
            <div className="text-muted-foreground mt-1">By: {event.waivedBy}</div>
          )}
        </div>
      )
    case "rate_changed":
      return (
        <div className="border-l-2 border-blue-500/40 pl-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-blue-600">
              Rate Changed
            </span>
          </div>
          <div className="text-muted-foreground mt-1">
            {formatRate(event.from)} → {formatRate(event.to)} / month
          </div>
        </div>
      )
  }
}

function CyclesBlock({ cycles }: { cycles: CycleSnapshot[] }) {
  if (cycles.length === 0) {
    return (
      <Section title="Monthly Interest Cycles">
        <p className="text-muted-foreground">No cycles yet — loan is younger than one day.</p>
      </Section>
    )
  }
  return (
    <Section title={`Monthly Interest Cycles (${cycles.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3">Cycle</th>
              <th className="py-2 pr-3">Range</th>
              <th className="py-2 pr-3 text-right">Start Bal</th>
              <th className="py-2 pr-3 text-right">End Bal</th>
              <th className="py-2 pr-3 text-right">@Base (d)</th>
              <th className="py-2 pr-3 text-right">@Pen (d)</th>
              <th className="py-2 pr-3 text-right">Accrued</th>
              <th className="py-2 pr-3 text-right">Cum. Paid</th>
              <th className="py-2 pr-3 text-right">Unpaid</th>
              <th className="py-2 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr
                key={c.cycle}
                className={cn(
                  "border-b border-border/50",
                  c.isPartial && "bg-muted/30 italic",
                )}
              >
                <td className="py-1.5 pr-3">
                  {c.cycle}
                  {c.isPartial && " *"}
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground">
                  {format(c.startDate, "MMM d")} – {format(c.endDate, "MMM d")}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCurrency(c.startBalance)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCurrency(c.endBalance)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.daysAtBaseRate}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {c.daysAtEffectiveRate || "—"}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCurrency(c.accruedInCycle)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCurrency(c.cumulativePaid)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCurrency(c.netUnpaidAtEnd)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {c.daysOverdueAtEnd}d
                  {c.penaltyActiveAtEnd && (
                    <span className="ml-1 text-destructive">⚠</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-muted-foreground mt-2">
          * Partial cycle — current 30-day window has not closed yet.
        </p>
      </div>
    </Section>
  )
}

function FinalStateBlock({ statement }: { statement: LoanStatement }) {
  const f = statement.finalState
  return (
    <Section title={`As Of ${format(statement.today, "MMM d, yyyy")}`}>
      <Row label="Principal Balance" value={formatCurrency(f.principalBalance)} />
      <Row
        label="Cumulative Interest Accrued"
        value={formatCurrency(f.cumulativeInterestAccrued)}
      />
      <Row
        label="Cumulative Interest Paid"
        value={formatCurrency(f.cumulativeInterestPaid)}
      />
      <Row label="Net Unpaid Interest" value={formatCurrency(f.netUnpaidInterest)} />
      <div className="border-t border-border my-2" />
      <Row
        label="Total Due to Settle"
        value={
          <span className="text-lg font-bold">{formatCurrency(f.totalDue)}</span>
        }
      />
      <Row label="Days Overdue" value={`${f.daysOverdue} days`} />
      <Row
        label="Penalty Active"
        value={
          f.penaltyActive ? (
            <span className="text-destructive font-bold">YES</span>
          ) : (
            "No"
          )
        }
      />
    </Section>
  )
}
