"use client"

import { use, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useLoanWithBalance } from "@/collections/loan-views"
import { toast } from "sonner"
import { LoanDetailClient } from "./loan-detail-client"

export default function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = use(params)
  const router = useRouter()

  // Read loan from join hook — returns LoanListEntry shape (includes customerName)
  const { data: loans, isLoading: loanLoading } = useLoanWithBalance(loanId)
  const loanEntry = loans?.[0] ?? null

  // customerName comes from the projected LoanListEntry
  const customerName = loanEntry?.customerName ?? null

  // Guard against redirecting during Electric's IndexedDB re-hydration window.
  // On a fresh page load the collection status briefly cycles idle → loading →
  // ready before IndexedDB restores cached rows. If we redirect the moment
  // isLoading=false with 0 rows we'd bounce valid deep-links to /loans.
  // Once we've seen the loan entry at least once we know the ID is real and
  // we must never redirect, even during a transient empty window. The latch
  // is mutated inside an effect (not during render) so it's safe under the
  // react-hooks/refs rule.
  const hasSeenEntry = useRef(false)
  useEffect(() => {
    if (loanEntry) hasSeenEntry.current = true
  }, [loanEntry])

  // Rollback handling: loan disappeared from collection after optimistic insert rolled back.
  // Only redirect once the initial sync has completed — otherwise we'd bounce away
  // during the loading window before data arrives.
  useEffect(() => {
    if (!loanLoading && loans !== undefined && !loanEntry && !hasSeenEntry.current) {
      toast.error("Loan not found")
      router.replace("/loans")
    }
  }, [loanLoading, loans, loanEntry, router])

  if (!loanEntry) {
    return <LoanDetailSkeleton />
  }

  return (
    <LoanDetailClient
      loanEntry={loanEntry}
      customerName={customerName}
    />
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
