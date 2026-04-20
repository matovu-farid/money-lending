"use client"

import { useState, useTransition, Suspense } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { toast } from "sonner"
import { Check, X, Loader2, ClipboardCheck } from "lucide-react"
import { rateChangeRequestCollection, reviewRateChangeRequest } from "@/collections"
import type { Permission } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import { PageHeader } from "@/components/ui/page-header"
import { InfoPopover } from "@/components/ui/info-popover"
import { PermissionInfo } from "@/components/ui/permission-info"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"
import { approvalStatusBadgeVariant } from "@/lib/status"
import Link from "next/link"

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="space-y-1">
        <div className="h-7 w-36 rounded-md bg-muted-foreground/10 animate-pulse" />
        <div className="h-4 w-64 rounded-md bg-muted-foreground/10 animate-pulse" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-40 rounded-md bg-muted-foreground/10 animate-pulse" />
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="bg-muted/50 h-10" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-t border-border">
              <div className="h-4 w-20 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-28 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-24 rounded bg-muted-foreground/10 animate-pulse ml-auto" />
              <div className="h-4 w-16 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-16 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-6 w-20 rounded-full bg-muted-foreground/10 animate-pulse" />
              <div className="h-4 w-20 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-8 w-16 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ApprovalsPage() {
  const { has } = usePermissions()
  const isSupervisorOrAbove = has("rate-change:approve-standard")

  if (!isSupervisorOrAbove) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="supervisor" action="Review rate change approvals" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Supervisor or higher permissions to view approvals.
        </p>
      </div>
    )
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ApprovalsContent has={has} />
    </Suspense>
  )
}

function ApprovalsContent({ has }: { has: (p: Permission) => boolean }) {
  const [isPending, startTransition] = useTransition()

  const { data: requests = [] } = useLiveSuspenseQuery(
    (q) => q.from({ r: rateChangeRequestCollection }),
    []
  )

  const [reviewingRequest, setReviewingRequest] = useState<RateChangeRequestWithLoan | null>(null)
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">("approved")
  const [reviewNote, setReviewNote] = useState("")

  function openReviewDialog(request: RateChangeRequestWithLoan, action: "approved" | "rejected") {
    setReviewingRequest(request)
    setReviewAction(action)
    setReviewNote("")
  }

  function closeReviewDialog() {
    setReviewingRequest(null)
    setReviewNote("")
  }

  function handleReviewSubmit() {
    if (!reviewingRequest) return
    startTransition(() => {
      reviewRateChangeRequest(reviewingRequest.id, {
        requestId: reviewingRequest.id,
        action: reviewAction,
        reviewNote: reviewNote.trim() || undefined,
      })
      toast.success(reviewAction === "approved" ? "Rate change approved and applied" : "Rate change request rejected")
      closeReviewDialog()
    })
  }

  const pendingRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status === "pending")
  const reviewedRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status !== "pending")

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Approvals" subtitle="Rate change requests pending your review">
        <InfoPopover>
          <p className="font-semibold text-sm mb-1">How Rate Change Approvals Work</p>
          <p className="text-xs text-muted-foreground mb-2">
            When a loan officer requests a rate change, it may require approval depending on the size of the change. Small changes can be applied immediately, while larger changes require a Supervisor or Admin to approve.
          </p>
          <p className="text-xs text-muted-foreground">
            Once approved, the new rate takes effect immediately for future interest calculations. Rejected requests keep the current rate unchanged.
          </p>
        </InfoPopover>
      </PageHeader>

      {/* Pending Requests */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Pending Requests</h2>
        {pendingRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No pending requests</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              All rate change requests have been reviewed.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Loan</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Customer</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Principal</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Current Rate</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Requested Rate</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      <span className="inline-flex items-center gap-1">
                        Required Role
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Required Approver Role</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            The minimum role needed to approve this request. A user with a higher role can also approve.
                          </p>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p><strong>Supervisor</strong> — Can approve standard rate changes.</p>
                            <p><strong>Admin</strong> — Required for larger rate changes.</p>
                          </div>
                        </InfoPopover>
                      </span>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Requested</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((request: RateChangeRequestWithLoan) => {
                    const canReview = has(request.requiredApproverRole as Permission)
                    return (
                      <TableRow key={request.id} data-testid="pending-request-row">
                        <TableCell className="font-mono text-sm">
                          <Link href={`/loans/${request.loanId}`} className="text-primary hover:underline">
                            {request.loanRef}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{request.customerName}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm">
                          {formatCurrency(request.principalAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm">
                          {formatRate(request.currentRate, 1)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm font-medium">
                          {formatRate(request.requestedRate, 1)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {request.requiredApproverRole === "supervisor" ? "Supervisor" : "Admin"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                          {formatDate(request.createdAt)}
                        </TableCell>
                        <TableCell>
                          {canReview ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => openReviewDialog(request, "approved")}
                                aria-label="Approve"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => openReviewDialog(request, "rejected")}
                                aria-label="Reject"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Insufficient role</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Recently Reviewed */}
      {reviewedRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Recently Reviewed</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Loan</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Customer</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Rate Change</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Note</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewedRequests.map((request: RateChangeRequestWithLoan) => (
                    <TableRow key={request.id} data-testid="reviewed-request-row">
                      <TableCell className="font-mono text-sm">
                        <Link href={`/loans/${request.loanId}`} className="text-primary hover:underline">
                          {request.loanRef}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{request.customerName}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm">
                        {formatRate(request.currentRate, 1)} &rarr; {formatRate(request.requestedRate, 1)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={approvalStatusBadgeVariant(request.status)} className="text-xs capitalize">
                          {request.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {request.reviewNote || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {request.reviewedAt ? formatDate(request.reviewedAt) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <DrawerDialog open={reviewingRequest !== null} onOpenChange={(open) => { if (!open) closeReviewDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approved" ? "Approve" : "Reject"} Rate Change
            </DialogTitle>
          </DialogHeader>
          {reviewingRequest && (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <p>
                  <span className="text-muted-foreground">Loan:</span>{" "}
                  <span className="font-mono">{reviewingRequest.loanRef}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Customer:</span>{" "}
                  <span className="font-medium">{reviewingRequest.customerName}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Rate change:</span>{" "}
                  <span className="font-mono">
                    {formatRate(reviewingRequest.currentRate, 1)} &rarr; {formatRate(reviewingRequest.requestedRate, 1)}
                  </span>
                </p>
              </div>
              {reviewAction === "approved" && (
                <p className="text-sm text-muted-foreground bg-green-50 dark:bg-green-950/20 rounded-md p-3">
                  Approving this request will immediately update the loan&apos;s interest rate to{" "}
                  {formatRate(reviewingRequest.requestedRate, 1)}.
                </p>
              )}
              {reviewAction === "rejected" && (
                <p className="text-sm text-muted-foreground bg-destructive/10 rounded-md p-3">
                  Rejecting this request will keep the current rate at{" "}
                  {formatRate(reviewingRequest.currentRate, 1)}. The requester will see the rejection.
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="reviewNote">Note (optional)</Label>
                <Textarea
                  id="reviewNote"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={reviewAction === "approved" ? "Any additional notes..." : "Reason for rejection..."}
                  disabled={isPending}
                  maxLength={2500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeReviewDialog}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant={reviewAction === "approved" ? "default" : "destructive"}
              onClick={handleReviewSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  {reviewAction === "approved" ? "Approving..." : "Rejecting..."}
                </>
              ) : (
                reviewAction === "approved" ? "Approve & Apply" : "Reject"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>
    </div>
  )
}
