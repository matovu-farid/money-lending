"use client"

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection, customerCollection } from "@/collections"
import { toast } from "sonner"
import { LoanDetailClient } from "./loan-detail-client"

export default function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = use(params)
  const router = useRouter()

  // Read loan from loanCollection — instant if optimistic data exists
  const { data: loans, isLoading: loanLoading } = useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .where(({ loan }) => eq(loan.id, loanId)),
    [loanId]
  )
  const loanEntry = loans?.[0] ?? null

  // Read customer from customerCollection for the name
  const customerId = loanEntry?.customerId
  const { data: customersData } = useLiveQuery(
    (q) =>
      customerId
        ? q
            .from({ c: customerCollection })
            .where(({ c }) => eq(c.id, customerId))
        : null,
    [customerId]
  )
  const customerName = customersData?.[0]?.fullName ?? loanEntry?.customerName ?? null

  // Rollback handling: loan disappeared from collection after optimistic insert rolled back
  useEffect(() => {
    if (!loanLoading && !loanEntry) {
      toast.error("Loan not found")
      router.replace("/loans")
    }
  }, [loanLoading, loanEntry, router])

  if (loanLoading) {
    return (
      <div className="p-8 space-y-6 max-w-6xl mx-auto animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    )
  }

  if (!loanEntry) {
    // Will redirect via useEffect above
    return null
  }

  return (
    <LoanDetailClient
      loanEntry={loanEntry}
      customerName={customerName}
    />
  )
}
