"use client"

import { useParams } from "next/navigation"
import { useLiveSuspenseQuery, eq } from "@tanstack/react-db"
import { loanCollection, customerCollection, getLoanBalanceCollection } from "@/collections"
import { shortId } from "@/lib/utils"
import { RecordPaymentForm } from "./record-payment-form"

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>()

  // Get loan from collection
  const { data: loans } = useLiveSuspenseQuery(
    (q) => q.from({ l: loanCollection }).where(({ l }) => eq(l.id, loanId)),
    [loanId]
  )
  const loan = loans?.[0] ?? null

  // Get customer name from collection
  const loanLoading = false
  const { data: customers } = useLiveSuspenseQuery(
    (q) => q.from({ c: customerCollection }).where(({ c }) => eq(c.id, loan?.customerId ?? "")),
    [loan?.customerId]
  )
  const customerName = customers?.[0]?.fullName ?? ""

  const balanceColl = getLoanBalanceCollection(loanId)
  const { data: balanceRows } = useLiveSuspenseQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ b: balanceColl as any }).select(({ b }: any) => b),
    [loanId]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balanceLoading = false
  const balanceData = (balanceRows as any)?.[0] ?? null

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
