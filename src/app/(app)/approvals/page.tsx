"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { Check, X, Loader2, ClipboardCheck } from "lucide-react"
import { listAllRequestsAction, reviewRateChangeRequestAction } from "@/actions/rate-change-request.actions"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import { PageHeader } from "@/components/ui/page-header"
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
import { formatDate, formatCurrency } from "@/lib/utils"
import Link from "next/link"

function statusBadgeVariant(status: string): "default" | "outline" | "secondary" | "destructive" {
  if (status === "pending") return "default"
  if (status === "approved") return "secondary"
  if (status === "rejected") return "destructive"
  return "outline"
}

export default function ApprovalsPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const isSupervisorOrAbove = actorLevel >= ROLE_LEVELS.supervisor

  const { data: requests = [], isLoading } = useQuery({
    queryKey: queryKeys.rateChangeRequests.pending(),
    queryFn: async () => {
      const result = await listAllRequestsAction()
      if ("error" in result) return []
      return result.data
    },
    enabled: !!session && isSupervisorOrAbove,
  })

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
    startTransition(async () => {
      const result = await reviewRateChangeRequestAction({
        requestId: reviewingRequest.id,
        action: reviewAction,
        reviewNote: reviewNote.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success(reviewAction === "approved" ? "Rate change approved and applied" : "Rate change request rejected")
      closeReviewDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.pendingCount() })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
    })
  }

  if (!session || (isLoading && !requests.length)) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!isSupervisorOrAbove) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive font-medium">Access denied.</p>
        <p className="text-muted-foreground text-sm mt-1">
          You need Supervisor or higher permissions to view approvals.
        </p>
      </div>
    )
  }

  const pendingRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status === "pending")
  const reviewedRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status !== "pending")

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Approvals" subtitle="Rate change requests pending your review" />

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
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Required Role</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Requested</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((request: RateChangeRequestWithLoan) => {
                    const canReview = ROLE_LEVELS[actorRole] >= ROLE_LEVELS[request.requiredApproverRole as UserRole]
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
                          {(parseFloat(request.currentRate) * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm font-medium">
                          {(parseFloat(request.requestedRate) * 100).toFixed(1)}%
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
                        {(parseFloat(request.currentRate) * 100).toFixed(1)}% &rarr; {(parseFloat(request.requestedRate) * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(request.status)} className="text-xs capitalize">
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
                    {(parseFloat(reviewingRequest.currentRate) * 100).toFixed(1)}% &rarr; {(parseFloat(reviewingRequest.requestedRate) * 100).toFixed(1)}%
                  </span>
                </p>
              </div>
              {reviewAction === "approved" && (
                <p className="text-sm text-muted-foreground bg-green-50 dark:bg-green-950/20 rounded-md p-3">
                  Approving this request will immediately update the loan&apos;s interest rate to{" "}
                  {(parseFloat(reviewingRequest.requestedRate) * 100).toFixed(1)}%.
                </p>
              )}
              {reviewAction === "rejected" && (
                <p className="text-sm text-muted-foreground bg-destructive/10 rounded-md p-3">
                  Rejecting this request will keep the current rate at{" "}
                  {(parseFloat(reviewingRequest.currentRate) * 100).toFixed(1)}%. The requester will see the rejection.
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
                  maxLength={500}
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
