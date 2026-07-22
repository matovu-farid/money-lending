"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { History, ArrowRight } from "lucide-react"
import {
  getLoanPredecessorChainAction,
  getLoanSuccessorAction,
  getRolloverAuditEntriesAction,
} from "@/actions/loan.actions"
import { queryKeys } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate, shortId } from "@/lib/utils"
import { loanStatusLabel, loanStatusVariant } from "@/lib/status"
import { isLoanReadOnly } from "@/lib/loan-visibility"
import type { Loan, LoanStatus } from "@/types"

interface LoanRolloverHistoryProps {
  loanId: string
  status: LoanStatus
  rolledOverFrom: string | null
}

export function LoanRolloverHistoryBanner({
  loanId,
  status,
  rolledOverFrom,
}: LoanRolloverHistoryProps) {
  const [open, setOpen] = useState(false)
  const readOnly = isLoanReadOnly(status)
  const showPredecessorBanner = !!rolledOverFrom
  const showSuccessorBanner = status === "rolled_over"

  const { data: predecessors = [] } = useQuery({
    queryKey: [...queryKeys.loans.detail(loanId), "predecessors"],
    queryFn: async () => {
      const result = await getLoanPredecessorChainAction(loanId)
      if ("error" in result) return [] as Loan[]
      return result.data
    },
    enabled: open && showPredecessorBanner,
    staleTime: 60_000,
  })

  const { data: successor } = useQuery({
    queryKey: [...queryKeys.loans.detail(loanId), "successor"],
    queryFn: async () => {
      const result = await getLoanSuccessorAction(loanId)
      if ("error" in result) return null
      return result.data
    },
    enabled: showSuccessorBanner,
    staleTime: 60_000,
  })

  const predecessorIds = predecessors.map((p) => p.id)
  const { data: auditEntries = [] } = useQuery({
    queryKey: [...queryKeys.loans.detail(loanId), "rollover-audit", predecessorIds],
    queryFn: async () => {
      const result = await getRolloverAuditEntriesAction(predecessorIds)
      if ("error" in result) return []
      return result.data
    },
    enabled: open && predecessorIds.length > 0,
    staleTime: 60_000,
  })

  if (!showPredecessorBanner && !showSuccessorBanner) return null

  return (
    <>
      {showPredecessorBanner && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            This loan includes balance rolled over from a previous loan.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="shrink-0"
          >
            <History className="h-3.5 w-3.5" />
            View loan history
          </Button>
        </div>
      )}

      {showSuccessorBanner && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            This loan was rolled into a new loan
            {readOnly ? " and is read-only." : "."}
          </p>
          {successor && (
            <Link
              href={`/loans/${successor.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0"
            >
              View current loan
              <ArrowRight className="h-3.5 w-3.5" />
              LOAN-{shortId(successor.id).toUpperCase()}
            </Link>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Loan history</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {predecessors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No predecessor loans found.
              </p>
            ) : (
              predecessors.map((pred, index) => (
                <Link
                  key={pred.id}
                  href={`/loans/${pred.id}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/50 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-mono">
                      #{index + 1} LOAN-{shortId(pred.id).toUpperCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(pred.startDate)} · Principal{" "}
                      {formatCurrency(pred.principalAmount)}
                      {pred.rolloverAmount
                        ? ` · carried ${formatCurrency(pred.rolloverAmount)}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant={loanStatusVariant(pred.status)}>
                    {loanStatusLabel(pred.status)}
                  </Badge>
                </Link>
              ))
            )}
            <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <div>
                <p className="text-sm font-mono font-medium">
                  Current · LOAN-{shortId(loanId).toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground">This loan</p>
              </div>
              <Badge variant={loanStatusVariant(status)}>
                {loanStatusLabel(status)}
              </Badge>
            </div>

            {auditEntries.length > 0 && (
              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Rollover events
                </p>
                {auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
                  >
                    <p>
                      {formatDate(entry.occurredAt)} · LOAN-
                      {shortId(entry.entityId).toUpperCase()}
                      {entry.afterValue?.rolledIntoLoanId
                        ? ` → LOAN-${shortId(entry.afterValue.rolledIntoLoanId).toUpperCase()}`
                        : ""}
                    </p>
                    {(entry.afterValue?.carriedPrincipal ||
                      entry.afterValue?.carriedInterest) && (
                      <p>
                        Carried principal{" "}
                        {formatCurrency(entry.afterValue.carriedPrincipal ?? "0")}
                        {entry.afterValue.carriedInterest
                          ? ` · interest ${formatCurrency(entry.afterValue.carriedInterest)}`
                          : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
