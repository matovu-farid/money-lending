"use client"

import { Printer } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { LoanStatement, StatementEvent, CycleSnapshot } from "@/lib/loan-statement"
import { formatCurrency, formatRate } from "@/lib/utils"

export interface LoanStatementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  statement: LoanStatement
  customerName: string
  loanRef: string
}

export function LoanStatementDialog({
  open,
  onOpenChange,
  statement,
  customerName,
  loanRef,
}: LoanStatementDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto print:max-h-none print:overflow-visible print:max-w-none print:w-auto print:shadow-none print:border-none">
        <div id="loan-statement-print">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Loan Statement</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="print:hidden"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs font-mono space-y-6 mt-4">
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
      </DrawerDialogContent>
    </DrawerDialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1 mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
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
      <Row label="Principal" value={`UGX ${formatCurrency(t.principal)}`} />
      <Row label="Base Rate" value={`${formatRate(t.baseRate)} / month`} />
      <Row
        label="Penalty Multiplier"
        value={`${formatRate(t.penaltyMultiplier)} → effective ${formatRate(t.effectiveRate)} / month when active`}
      />
      <Row
        label="Penalty Threshold"
        value={`${t.penaltyThresholdDays} days overdue`}
      />
      <Row label="Min Interest Period" value={`${t.minInterestDays} days`} />
      <Row label="Loan Type" value={t.loanType} />
      <Row label="Issuance Fee" value={`UGX ${formatCurrency(t.issuanceFee)}`} />
      {t.backdated && (
        <Row label="Backdated" value="Yes" />
      )}
    </Section>
  )
}

function EventsBlock({ events }: { events: StatementEvent[] }) {
  return (
    <Section title={`Chronological Events (${events.length})`}>
      <div className="space-y-2">
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
        <div className="border-l-2 border-primary/40 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-primary">Loan Issued</span>
          </div>
          <div className="text-muted-foreground space-y-0.5 mt-0.5">
            <div>Principal disbursed: UGX {formatCurrency(event.principal)}</div>
            {Number(event.issuanceFee) > 0 && (
              <div>Issuance fee charged: UGX {formatCurrency(event.issuanceFee)}</div>
            )}
            <div>Initial base rate: {formatRate(event.baseRate)} / month</div>
          </div>
        </div>
      )
    case "payment":
      return (
        <div className="border-l-2 border-emerald-500/40 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-emerald-600">Payment</span>
          </div>
          <div className="text-muted-foreground space-y-0.5 mt-0.5">
            <div>Amount paid: UGX {formatCurrency(event.amount)}</div>
            <div>Interest portion: UGX {formatCurrency(event.interestPortion)}</div>
            <div>Principal portion: UGX {formatCurrency(event.principalPortion)}</div>
            <div>
              Balance: UGX {formatCurrency(event.balanceBefore)} → UGX{" "}
              {formatCurrency(event.balanceAfter)}
            </div>
            {event.recordedBy && <div>Recorded by: {event.recordedBy}</div>}
          </div>
        </div>
      )
    case "penalty_active":
      return (
        <div className="border-l-2 border-destructive/40 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-destructive">
              Penalty Activated
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5">{event.reason}</div>
        </div>
      )
    case "penalty_waived":
      return (
        <div className="border-l-2 border-yellow-500/40 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-yellow-600">
              Penalty Waived
            </span>
          </div>
          {event.waivedBy && (
            <div className="text-muted-foreground mt-0.5">By: {event.waivedBy}</div>
          )}
        </div>
      )
    case "rate_changed":
      return (
        <div className="border-l-2 border-blue-500/40 pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{dayLabel} · {dateLabel}</span>
            <span className="text-[10px] uppercase tracking-wider text-blue-600">
              Rate Changed
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5">
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
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2">Cycle</th>
              <th className="py-1 pr-2">Range</th>
              <th className="py-1 pr-2 text-right">Start Bal</th>
              <th className="py-1 pr-2 text-right">End Bal</th>
              <th className="py-1 pr-2 text-right">@Base (days)</th>
              <th className="py-1 pr-2 text-right">@Pen (days)</th>
              <th className="py-1 pr-2 text-right">Accrued</th>
              <th className="py-1 pr-2 text-right">Cum. Paid</th>
              <th className="py-1 pr-2 text-right">Unpaid</th>
              <th className="py-1 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr
                key={c.cycle}
                className={`border-b border-border/50 ${c.isPartial ? "bg-muted/30 italic" : ""}`}
              >
                <td className="py-1 pr-2">
                  {c.cycle}
                  {c.isPartial && " *"}
                </td>
                <td className="py-1 pr-2 text-muted-foreground">
                  {format(c.startDate, "MMM d")} – {format(c.endDate, "MMM d")}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatCurrency(c.startBalance)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatCurrency(c.endBalance)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{c.daysAtBaseRate}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {c.daysAtEffectiveRate || "—"}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatCurrency(c.accruedInCycle)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatCurrency(c.cumulativePaid)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatCurrency(c.netUnpaidAtEnd)}
                </td>
                <td className="py-1 text-right tabular-nums">
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
      <Row label="Principal Balance" value={`UGX ${formatCurrency(f.principalBalance)}`} />
      <Row
        label="Cumulative Interest Accrued"
        value={`UGX ${formatCurrency(f.cumulativeInterestAccrued)}`}
      />
      <Row
        label="Cumulative Interest Paid"
        value={`UGX ${formatCurrency(f.cumulativeInterestPaid)}`}
      />
      <Row label="Net Unpaid Interest" value={`UGX ${formatCurrency(f.netUnpaidInterest)}`} />
      <div className="border-t border-border my-1.5" />
      <Row
        label="Total Due to Settle"
        value={<span className="text-base font-bold">UGX {formatCurrency(f.totalDue)}</span>}
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
