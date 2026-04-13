"use client"

import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { getLoanPaymentContextAction } from "@/actions/loan.actions"
import { getLoanBalanceAction } from "@/actions/payment.actions"
import { queryKeys } from "@/hooks/query-keys"
import { RecordPaymentForm } from "./record-payment-form"

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>()

  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: queryKeys.loans.paymentContext(loanId),
    queryFn: async () => {
      const result = await getLoanPaymentContextAction(loanId)
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: queryKeys.loans.balance(loanId),
    queryFn: async () => {
      const result = await getLoanBalanceAction(loanId)
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  if (contextLoading) {
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

  if (!context) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Loan not found.</p>
      </div>
    )
  }

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerName={context.customerName}
      loanReference={context.loanReference}
      balanceData={balanceData ?? null}
      balanceLoading={balanceLoading}
    />
  )
}
