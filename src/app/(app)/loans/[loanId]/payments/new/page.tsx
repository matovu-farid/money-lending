"use client"

import { useParams } from "next/navigation"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection } from "@/collections/loans"
import { customerCollection } from "@/collections/customers"
import { getLoanBalanceCollection } from "@/collections/loan-balance"
import { shortId } from "@/lib/utils"
import { RecordPaymentForm } from "./record-payment-form"

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>()

  // Loan + customer come from globally-synced Electric collections. They render
  // immediately when in cache; otherwise we show a brief loading skeleton.
  const { data: loans, isLoading: loansLoading } = useLiveQuery(
    (q) => q.from({ l: loanCollection }).where(({ l }) => eq(l.id, loanId)),
    [loanId]
  )
  const loan = loans?.[0] ?? null

  const loanLoading = loansLoading && !loan
  const { data: customers } = useLiveQuery(
    (q) => q.from({ c: customerCollection }).where(({ c }) => eq(c.id, loan?.customerId ?? "")),
    [loan?.customerId]
  )
  const customerName = customers?.[0]?.fullName ?? ""

  // Per-loan balance is a query collection that fetches fresh from the server
  // for every loan. Don't suspend on it — the form can render and let the
  // user start typing; balance-aware UI fills in once the data arrives.
  const balanceColl = getLoanBalanceCollection(loanId)
  const { data: balanceRows } = useLiveQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ b: balanceColl as any }).select(({ b }: any) => b),
    [loanId]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balanceData = (balanceRows as any)?.[0] ?? null
  const balanceLoading = !balanceData

  if (loanLoading) {
    return (
      <div className="p-4 md:p-6 max-w-xl">
        <div className="space-y-4">
          <div className="h-9 w-24 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-40 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
          <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
    )
  }

  if (!loan) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Loan not found.</p>
      </div>
    )
  }

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerId={loan.customerId}
      customerName={customerName}
      loanReference={`LOAN-${shortId(loan.id).toUpperCase()}`}
      loanStartDate={loan.startDate instanceof Date ? loan.startDate.toISOString() : String(loan.startDate)}
      balanceData={balanceData ?? null}
      balanceLoading={balanceLoading}
    />
  )
}
