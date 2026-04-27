"use client"

import { Suspense, use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useLiveSuspenseQuery, useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection } from "@/collections/loans"
import { customerCollection } from "@/collections/customers"
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
  const { data: loans } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .where(({ loan }) => eq(loan.id, loanId)),
    [loanId]
  )
  const loanEntry = loans[0] ?? null

  // Read customer from customerCollection for the name
  const customerId = loanEntry?.customerId
  const { data: customersData } = useLiveQuery(
    (q) =>
      customerId
        ? q
            .from({ c: customerCollection })
            .where(({ c }) => eq(c.id, customerId))
        : undefined,
    [customerId]
  )
  const customerName = customersData?.[0]?.fullName ?? loanEntry?.customerName ?? null

  // Rollback handling: loan disappeared from collection after optimistic insert rolled back
  useEffect(() => {
    if (!loanEntry) {
      toast.error("Loan not found")
      router.replace("/loans")
    }
  }, [loanEntry, router])

  if (!loanEntry) {
    return null
  }

  return (
    <Suspense fallback={<LoanDetailSkeleton />}>
      <LoanDetailClient
        loanEntry={loanEntry}
        customerName={customerName}
      />
    </Suspense>
  )
}

function LoanDetailSkeleton() {
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted-foreground/10 animate-pulse" />
        <div className="space-y-1">
          <div className="h-6 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-4 w-24 rounded bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl border bg-muted-foreground/5 animate-pulse" />
        ))}
      </div>
      <div className="h-48 rounded-xl border bg-muted-foreground/5 animate-pulse" />
    </div>
  )
}
