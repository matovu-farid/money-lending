"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { MoreHorizontal, Loader2 } from "lucide-react"
import { editPaymentAction, deletePaymentAction } from "@/actions/payment.actions"
import type { Loan, Payment } from "@/types"
import { SimulatorPanel } from "@/components/loans/simulator-panel"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatDate } from "@/lib/utils"

interface LoanDetailClientProps {
  loan: Loan
  payments: Payment[]
  customerName: string | null
}

function formatUGX(amount: string | null | undefined): string {
  if (!amount) return "—"
  const num = parseFloat(amount)
  if (isNaN(num)) return "—"
  return new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)
}

function formatDateForInput(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  return d.toISOString().split("T")[0]
}

function loanStatusVariant(status: string): "default" | "outline" {
  if (status === "active") return "default"
  return "outline"
}

function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function LoanDetailClient({ loan, payments, customerName }: LoanDetailClientProps) {
  const router = useRouter()

  // Edit dialog state
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editReason, setEditReason] = useState("")
  const [isEditPending, startEditTransition] = useTransition()

  // Delete dialog state
  const [deletingPayment, setDeletingPayment] = useState<Payment | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeletePending, startDeleteTransition] = useTransition()

  // Outstanding balance: last active payment's principalBalanceAfter, or loan principal if none
  const activePayments = payments.filter((p) => p.deletedAt === null)
  const outstandingBalance =
    activePayments.length > 0
      ? activePayments[activePayments.length - 1].principalBalanceAfter
      : loan.principalAmount

  function openEditDialog(payment: Payment) {
    setEditingPayment(payment)
    setEditAmount(payment.amount)
    setEditDate(formatDateForInput(payment.paymentDate))
    setEditReason("")
  }

  function closeEditDialog() {
    setEditingPayment(null)
    setEditAmount("")
    setEditDate("")
    setEditReason("")
  }

  function openDeleteDialog(payment: Payment) {
    setDeletingPayment(payment)
    setDeleteReason("")
  }

  function closeDeleteDialog() {
    setDeletingPayment(null)
    setDeleteReason("")
  }

  function handleEditSubmit() {
    if (!editingPayment) return
    startEditTransition(async () => {
      const result = await editPaymentAction({
        paymentId: editingPayment.id,
        amount: editAmount.trim(),
        paymentDate: editDate ? editDate + "T00:00:00.000Z" : undefined,
        reason: editReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Payment updated")
      closeEditDialog()
      router.refresh()
    })
  }

  function handleDeleteSubmit() {
    if (!deletingPayment) return
    startDeleteTransition(async () => {
      const result = await deletePaymentAction({
        paymentId: deletingPayment.id,
        reason: deleteReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Payment deleted")
      closeDeleteDialog()
      router.refresh()
    })
  }

  const loanRef = `LOAN-${loan.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Back link */}
      <Link href="/loans" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to Loans
      </Link>

      {/* Loan header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs text-muted-foreground">{loanRef}</span>
          <Badge variant={loanStatusVariant(loan.status)}>{loanStatusLabel(loan.status)}</Badge>
        </div>
        {customerName && (
          <p className="text-lg font-semibold">{customerName}</p>
        )}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mt-3">
          <div>
            <dt className="text-xs text-muted-foreground">Principal</dt>
            <dd className="font-medium">UGX {formatUGX(loan.principalAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Interest Rate</dt>
            <dd className="font-medium">
              {(parseFloat(loan.interestRate) * 100).toFixed(1)}% / month
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Start Date</dt>
            <dd className="font-medium">{formatDate(loan.startDate)}</dd>
          </div>
        </dl>
      </div>

      {/* Outstanding Balance focal point */}
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-xs text-muted-foreground">Outstanding Balance</p>
        <p className="text-2xl font-semibold mt-1">UGX {formatUGX(outstandingBalance)}</p>
        <div className="flex gap-3 mt-4 flex-wrap">
          <Link
            href={`/loans/${loan.id}/payments/new`}
            className={cn(buttonVariants())}
          >
            Record Payment
          </Link>
          <Link
            href={`/receipts/disbursement/${loan.id}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Print Receipt
          </Link>
        </div>
      </div>

      {/* Payments section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Payments</h2>

        {payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <p className="text-lg font-semibold">No payments recorded</p>
            <p className="text-sm text-muted-foreground">
              Record the first payment against this loan to start tracking repayments.
            </p>
            <Link
              href={`/loans/${loan.id}/payments/new`}
              className={cn(buttonVariants())}
            >
              Record Payment
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount (UGX)</TableHead>
                <TableHead>Interest Paid (UGX)</TableHead>
                <TableHead>Principal Paid (UGX)</TableHead>
                <TableHead>Balance After (UGX)</TableHead>
                <TableHead>Recorded By</TableHead>
                <TableHead className="w-12">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => {
                const isDeleted = payment.deletedAt !== null
                const cellClass = isDeleted ? "opacity-60 line-through" : ""
                return (
                  <TableRow key={payment.id}>
                    <TableCell className={cellClass}>
                      {formatDate(payment.paymentDate)}
                    </TableCell>
                    <TableCell className={cellClass}>
                      {formatUGX(payment.amount)}
                    </TableCell>
                    <TableCell className={cellClass}>
                      {formatUGX(payment.interestPortion)}
                    </TableCell>
                    <TableCell className={cellClass}>
                      {formatUGX(payment.principalPortion)}
                    </TableCell>
                    <TableCell className={cellClass}>
                      {formatUGX(payment.principalBalanceAfter)}
                    </TableCell>
                    <TableCell className={cn("font-mono text-xs", cellClass)}>
                      {payment.recordedBy.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      {isDeleted ? (
                        <span className="text-xs text-muted-foreground">Deleted</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label="Payment actions"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => openEditDialog(payment)}
                            >
                              Edit Payment
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openDeleteDialog(payment)}
                              variant="destructive"
                            >
                              Delete Payment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Repayment Simulator */}
      {loan.status === "active" && (
        <SimulatorPanel
          loan={loan}
          payments={payments.filter(p => !p.deletedAt)}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={editingPayment !== null} onOpenChange={(open) => { if (!open) closeEditDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="editAmount">Amount (UGX)</Label>
              <Input
                id="editAmount"
                type="text"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                disabled={isEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editDate">Payment Date</Label>
              <Input
                id="editDate"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                disabled={isEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editReason">Reason for edit</Label>
              <Textarea
                id="editReason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Explain what is being corrected and why"
                disabled={isEditPending}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeEditDialog}
              disabled={isEditPending}
            >
              Discard Changes
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={isEditPending || !editReason.trim()}
            >
              {isEditPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deletingPayment !== null} onOpenChange={(open) => { if (!open) closeDeleteDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete payment?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This payment will be marked as deleted. The record is not permanently removed. All
              subsequent balances will be recalculated.
            </p>
            <div className="space-y-1">
              <Label htmlFor="deleteReason">Reason for deletion</Label>
              <Textarea
                id="deleteReason"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Explain why this payment is being deleted"
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
              Keep Payment
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
                "Delete Payment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
