"use client"

import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection, customerCollection } from "@/collections"
import { getLoanBalanceAction } from "@/actions/payment.actions"
import { queryKeys } from "@/hooks/query-keys"
import { shortId } from "@/lib/utils"
import { RecordPaymentForm } from "./record-payment-form"

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>()

  // Get loan from collection
  const { data: loans, isLoading: loanLoading } = useLiveQuery(
    (q) => q.from({ l: loanCollection }).where(({ l }) => eq(l.id, loanId)),
    [loanId]
  )
  const loan = loans?.[0] ?? null

  // Get customer name from collection
  const { data: customers } = useLiveQuery(
    (q) => q.from({ c: customerCollection }).where(({ c }) => eq(c.id, loan?.customerId ?? "")),
    [loan?.customerId]
  )
  const customerName = customers?.[0]?.fullName ?? ""

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: queryKeys.loans.balance(loanId),
    queryFn: async () => {
      const result = await getLoanBalanceAction(loanId)
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

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
