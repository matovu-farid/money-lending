"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MoreHorizontal, Loader2 } from "lucide-react"
import { listLoansAction, getCurrentUserRoleAction, deleteLoanAction } from "@/actions/loan.actions"
import type { LoanWithCustomer, UserRole } from "@/types"
import { ROLE_LEVELS } from "@/types"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatDate } from "@/lib/utils"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)
}

function loanStatusVariant(status: string): "default" | "outline" {
  if (status === "active") return "default"
  return "outline"
}

function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export default function LoansPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: loans = [], isLoading, isError } = useQuery<LoanWithCustomer[]>({
    queryKey: ["loans"],
    queryFn: async () => {
      const result = await listLoansAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const { data: userRole = "unassigned" as UserRole } = useQuery<UserRole>({
    queryKey: ["currentUserRole"],
    queryFn: () => getCurrentUserRoleAction(),
  })

  // Delete dialog state
  const [deletingLoanId, setDeletingLoanId] = useState<string | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeletePending, startDeleteTransition] = useTransition()

  const isAdmin = ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin

  const loanColumns: Column<LoanWithCustomer>[] = [
    {
      key: "slug",
      header: "Slug",
      hideInCard: true,
      render: (loan) => <span className="font-mono text-xs tabular-nums">{loan.id.slice(-5)}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      primary: true,
      render: (loan) => loan.customerName,
    },
    {
      key: "principalAmount",
      header: "Principal Amount",
      cardLabel: "Principal",
      align: "right",
      render: (loan) => <>UGX {formatUGX(loan.principalAmount)}</>,
    },
    {
      key: "interestRate",
      header: "Interest Rate",
      cardLabel: "Rate",
      align: "right",
      render: (loan) => <>{(parseFloat(loan.interestRate) * 100).toFixed(0)}% / month</>,
    },
    {
      key: "status",
      header: "Status",
      render: (loan) => (
        <Badge variant={loanStatusVariant(loan.status)}>
          {loanStatusLabel(loan.status)}
        </Badge>
      ),
    },
    {
      key: "startDate",
      header: "Start Date",
      cardLabel: "Started",
      render: (loan) => <span className="font-mono tabular-nums">{formatDate(loan.startDate)}</span>,
    },
    ...(isAdmin ? [{
      key: "actions",
      header: "Actions",
      hideInCard: false,
      render: (loan: LoanWithCustomer) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Loan actions"
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/loans/${loan.id}`)}>View</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/loans/${loan.id}?edit=1`)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDeleteDialog(loan.id)} variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    } satisfies Column<LoanWithCustomer>] : []),
  ]

  function openDeleteDialog(loanId: string) {
    setDeletingLoanId(loanId)
    setDeleteReason("")
  }

  function closeDeleteDialog() {
    setDeletingLoanId(null)
    setDeleteReason("")
  }

  function handleDeleteSubmit() {
    if (!deletingLoanId) return
    startDeleteTransition(async () => {
      const result = await deleteLoanAction({
        loanId: deletingLoanId,
        reason: deleteReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Loan deleted")
      queryClient.invalidateQueries({ queryKey: ["loans"] })
      closeDeleteDialog()
    })
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading loans...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Error loading loans</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Active and historical loans</p>
        </div>
        <Link href="/loans/new" className={cn(buttonVariants())}>
          New Loan
        </Link>
      </div>

      <ResponsiveTable
        columns={loanColumns}
        rows={loans}
        getRowKey={(loan) => loan.id}
        getRowProps={() => ({ "data-testid": "data-row" })}
        emptyState={
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <p className="text-muted-foreground">No loans issued yet.</p>
            <Link href="/loans/new" className={cn(buttonVariants())}>
              Issue First Loan
            </Link>
          </div>
        }
      />

      {/* Delete Loan Dialog */}
      <Dialog open={deletingLoanId !== null} onOpenChange={(open) => { if (!open) closeDeleteDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete loan?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the loan and all associated payments. This action cannot be undone.
            </p>
            <div className="space-y-1">
              <Label htmlFor="listDeleteReason">Reason for deletion</Label>
              <Textarea
                id="listDeleteReason"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Explain why this loan is being deleted"
                disabled={isDeletePending}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={isDeletePending}
            >
              Keep Loan
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSubmit}
              disabled={isDeletePending || !deleteReason.trim()}
            >
              {isDeletePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Deleting...
                </>
              ) : (
                "Delete Loan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
