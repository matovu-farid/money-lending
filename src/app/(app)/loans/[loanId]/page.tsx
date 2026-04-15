"use client"

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useLiveSuspenseQuery, useLiveQuery, eq } from "@tanstack/react-db"
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
    <LoanDetailClient
      loanEntry={loanEntry}
      customerName={customerName}
    />
  )
}
