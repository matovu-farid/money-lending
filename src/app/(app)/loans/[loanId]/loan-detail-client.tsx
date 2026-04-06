"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  MoreHorizontal,
  Loader2,
  Pencil,
  Trash2,
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  Percent,
  Banknote,
  Receipt,
  UserCircle,
  ShieldAlert,
} from "lucide-react"
import { editPaymentAction, deletePaymentAction, getLoanBalanceAction } from "@/actions/payment.actions"
import { updateLoanAction, deleteLoanAction } from "@/actions/loan.actions"
import { requestRateChangeAction, listRequestsForLoanAction } from "@/actions/rate-change-request.actions"
import { useLoanPayments } from "@/hooks/use-payments"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole, type RateChangeRequest } from "@/types"
import type { Loan, Payment } from "@/types"
import { SettleCollateralDialog } from "@/components/loans/settle-collateral-dialog"
import { SimulatorPanel } from "@/components/loans/simulator-panel"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
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
import { InfoPopover } from "@/components/ui/info-popover"
import { cn, formatDate, formatCurrency } from "@/lib/utils"
import { calculateSchedule } from "@/lib/interest/engine"

interface LoanDetailClientProps {
  loan: Loan
  initialPayments: Payment[]
  customerName: string | null
  canModify: boolean
  openEditOnMount?: boolean
  userNameMap: Record<string, string>
  ledgerBalance: string | null
  userRole: UserRole
  collateralNature?: string
  collateralDescription?: string | null
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
  if (status === "settled_with_collateral") return "Settled (Collateral)"
  if (status === "rolled_over") return "Rolled Over"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function LoanDetailClient({ loan, initialPayments, customerName, canModify, openEditOnMount, userNameMap, ledgerBalance, userRole, collateralNature, collateralDescription }: LoanDetailClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  // Use TanStack Query for payments so subsequent navigations are cached
  const { data: payments = initialPayments } = useLoanPayments(loan.id, true, initialPayments)

  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editReason, setEditReason] = useState("")
  const [isEditPending, startEditTransition] = useTransition()

  const [deletingPayment, setDeletingPayment] = useState<Payment | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeletePending, startDeleteTransition] = useTransition()

  const [editingLoan, setEditingLoan] = useState(false)
  const [loanPrincipal, setLoanPrincipal] = useState(loan.principalAmount)
  const [loanInterestRate, setLoanInterestRate] = useState(
    (parseFloat(loan.interestRate) * 100).toFixed(1)
  )
  const [loanStartDate, setLoanStartDate] = useState(formatDateForInput(loan.startDate))
  const [loanEditReason, setLoanEditReason] = useState("")
  const [isLoanEditPending, startLoanEditTransition] = useTransition()

  const [deletingLoan, setDeletingLoan] = useState(false)
  const [loanDeleteReason, setLoanDeleteReason] = useState("")
  const [isLoanDeletePending, startLoanDeleteTransition] = useTransition()

  const [settlingCollateral, setSettlingCollateral] = useState(false)

  const [requestingRateChange, setRequestingRateChange] = useState(false)
  const [newRate, setNewRate] = useState("")
  const [isRateChangePending, startRateChangeTransition] = useTransition()

  // Fetch pending rate change requests for this loan
  const { data: rateChangeRequests = [] } = useQuery({
    queryKey: queryKeys.rateChangeRequests.byLoan(loan.id),
    queryFn: async () => {
      const result = await listRequestsForLoanAction(loan.id)
      if ("error" in result) return []
      return result.data
    },
  })

  const { data: balanceData } = useQuery({
    queryKey: ["loan-balance", loan.id],
    queryFn: async () => {
      const result = await getLoanBalanceAction(loan.id)
      if ("error" in result) return null
      return result.data
    },
    enabled: loan.status === "active",
  })

  const pendingRateRequest = rateChangeRequests.find((r: RateChangeRequest) => r.status === "pending")

  useEffect(() => {
    if (openEditOnMount && canModify) {
      openLoanEditDialog()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activePayments = payments
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())
  // Prefer ledger-derived balance from server; fall back to payments-chain value
  const paymentsChainBalance =
    activePayments.length > 0
      ? activePayments[activePayments.length - 1].principalBalanceAfter
      : loan.principalAmount
  const outstandingBalance = ledgerBalance ?? paymentsChainBalance

  const principalNum = parseFloat(loan.principalAmount)
  const balanceNum = parseFloat(outstandingBalance)
  const totalPaid = principalNum - balanceNum
  const repaymentPercent = principalNum > 0 ? Math.min(100, Math.round((totalPaid / principalNum) * 100)) : 0

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

  function openLoanEditDialog() {
    setLoanPrincipal(loan.principalAmount)
    setLoanInterestRate((parseFloat(loan.interestRate) * 100).toFixed(1))
    setLoanStartDate(formatDateForInput(loan.startDate))
    setLoanEditReason("")
    setEditingLoan(true)
  }

  function closeLoanEditDialog() {
    setEditingLoan(false)
    setLoanEditReason("")
  }

  function openLoanDeleteDialog() {
    setLoanDeleteReason("")
    setDeletingLoan(true)
  }

  function closeLoanDeleteDialog() {
    setDeletingLoan(false)
    setLoanDeleteReason("")
  }

  function handleEditSubmit() {
    if (!editingPayment) return
    startEditTransition(async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.loans.all })
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.all })

      const result = await editPaymentAction({
        paymentId: editingPayment.id,
        amount: editAmount.trim(),
        paymentDate: editDate ? editDate + "T12:00:00" : undefined,
        reason: editReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Payment updated")
      closeEditDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loan.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    })
  }

  function handleDeleteSubmit() {
    if (!deletingPayment) return
    const deletedId = deletingPayment.id
    startDeleteTransition(async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.all })
      await queryClient.cancelQueries({ queryKey: queryKeys.loans.all })

      const result = await deletePaymentAction({
        paymentId: deletedId,
        reason: deleteReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Payment deleted")
      closeDeleteDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loan.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    })
  }

  function handleLoanEditSubmit() {
    startLoanEditTransition(async () => {
      const interestRateDecimal = loanInterestRate.trim()
        ? (parseFloat(loanInterestRate) / 100).toFixed(10)
        : undefined

      const result = await updateLoanAction({
        loanId: loan.id,
        principalAmount: loanPrincipal.trim() || undefined,
        interestRate: interestRateDecimal,
        startDate: loanStartDate ? new Date(loanStartDate).toISOString() : undefined,
        reason: loanEditReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Loan updated")
      closeLoanEditDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loan.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    })
  }

  function handleLoanDeleteSubmit() {
    startLoanDeleteTransition(async () => {
      const result = await deleteLoanAction({
        loanId: loan.id,
        reason: loanDeleteReason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast("Loan deleted")
      closeLoanDeleteDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      router.push("/loans")
    })
  }

  function openRateChangeDialog() {
    setNewRate((parseFloat(loan.interestRate) * 100).toFixed(1))
    setRequestingRateChange(true)
  }

  function closeRateChangeDialog() {
    setRequestingRateChange(false)
    setNewRate("")
  }

  function handleRateChangeSubmit() {
    startRateChangeTransition(async () => {
      const rateDecimal = (parseFloat(newRate) / 100).toFixed(4)

      const result = await requestRateChangeAction({
        loanId: loan.id,
        requestedRate: rateDecimal,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      if (result.data.applied) {
        toast.success("Interest rate updated immediately")
        queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loan.id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      } else {
        toast.success(result.data.message)
        queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.byLoan(loan.id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.pending() })
      }

      closeRateChangeDialog()
    })
  }

  const loanRef = `LOAN-${loan.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/loans"
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Back to Loans"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              {customerName && (
                <h1 className="text-xl font-semibold tracking-tight">{customerName}</h1>
              )}
              <Badge variant={loanStatusVariant(loan.status)}>{loanStatusLabel(loan.status)}</Badge>
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Loan Status</p>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p><strong>Pending</strong> — Loan created but not yet disbursed. No interest accrues.</p>
                  <p><strong>Active</strong> — Money has been given to the borrower. Interest accrues daily.</p>
                  <p><strong>Fully Paid</strong> — Outstanding balance has reached zero. No further payments needed.</p>
                  <p><strong>Settled (Collateral)</strong> — Loan closed by seizing the borrower&apos;s collateral.</p>
                  <p><strong>Rolled Over</strong> — Outstanding balance was rolled into a new loan.</p>
                </div>
              </InfoPopover>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{loanRef}</p>
          </div>
        </div>

        {canModify && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openLoanEditDialog}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={openLoanDeleteDialog} className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettlingCollateral(true)}
                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-300"
              >
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Settle with Collateral
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Loan Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Banknote className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Principal</span>
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Principal Amount</p>
              <p className="text-xs text-muted-foreground mb-2">
                The original amount disbursed to the borrower. Interest is calculated on the remaining principal balance, not this original amount.
              </p>
            </InfoPopover>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatCurrency(loan.principalAmount)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Percent className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Interest Rate</span>
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Monthly Interest Rate</p>
              <p className="text-xs text-muted-foreground mb-2">
                The rate charged per 30-day period. Interest accrues daily using this formula:
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                Daily Interest = Balance x (Rate / 30)
              </p>
              <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                <p className="font-medium">Example (10% / month):</p>
                <p>UGX 1,000,000 x (0.10 / 30) = UGX 3,333/day</p>
              </div>
            </InfoPopover>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {(parseFloat(loan.interestRate) * 100).toFixed(1)}%
            <span className="text-sm font-normal text-muted-foreground ml-1">/ month</span>
          </p>
          {pendingRateRequest && (
            <Badge variant="outline" className="mt-2 text-xs">
              Pending: {(parseFloat(pendingRateRequest.requestedRate) * 100).toFixed(1)}%
            </Badge>
          )}
          {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.loanOfficer && !pendingRateRequest && (
            <Button variant="outline" size="sm" className="mt-2" onClick={openRateChangeDialog}>
              <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
              Request Rate Change
            </Button>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Calendar className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Start Date</span>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatDate(loan.startDate)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Banknote className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Issuance Fee</span>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatCurrency(loan.issuanceFee)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Loan Type</span>
          </div>
          <p className="text-lg font-semibold">
            {loan.loanType === "fixed_rate" ? "Fixed Rate" : loan.loanType === "reducing_balance" ? "Reducing Balance" : "Perpetual"}
          </p>
        </div>
        {loan.termMonths && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Term</span>
            </div>
            <p className="text-lg font-semibold">{loan.termMonths} months</p>
          </div>
        )}
      </div>

      {/* Amortization Schedule */}
      {loan.loanType && loan.loanType !== "perpetual" && loan.termMonths && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">Amortization Schedule</h3>
          <div className="rounded-md border overflow-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-right">Principal</th>
                  <th className="px-3 py-2 text-right">Interest</th>
                  <th className="px-3 py-2 text-right">Installment</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {calculateSchedule(
                  loan.principalAmount,
                  loan.interestRateOverride ?? loan.interestRate,
                  loan.termMonths,
                  loan.loanType as "fixed_rate" | "reducing_balance"
                ).map((entry) => (
                  <tr key={entry.month} className="border-t">
                    <td className="px-3 py-2">{entry.month}</td>
                    <td className="px-3 py-2 text-right">{Number(entry.monthlyPrincipal).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(entry.monthlyInterest).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(entry.monthlyInstallment).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(entry.balanceAfter).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loan Description */}
      {loan.description && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Description</p>
          <p className="text-sm">{loan.description}</p>
        </div>
      )}

      {/* Principal Balance Card */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-3 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
              Principal Balance
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Principal Balance</p>
                <p className="text-xs text-muted-foreground mb-2">
                  The remaining principal the borrower still owes. This decreases only when a payment exceeds the accrued interest — the excess reduces the principal.
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Different from the total amount owed, which also includes unpaid interest.
                </p>
                <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                  Payment → Interest first, then Principal
                </p>
              </InfoPopover>
            </p>
            <p className="text-3xl font-bold font-mono tracking-tight tabular-nums">
              {formatCurrency(outstandingBalance)}
            </p>
            {/* Repayment progress */}
            <div className="space-y-1.5 max-w-md">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{repaymentPercent}% repaid</span>
                <span>{formatCurrency(totalPaid)} of {formatCurrency(loan.principalAmount)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    repaymentPercent === 100
                      ? "bg-green-500"
                      : repaymentPercent >= 50
                        ? "bg-primary"
                        : "bg-primary/70"
                  )}
                  style={{ width: `${repaymentPercent}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {loan.status === "active" && (
              <Link
                href={`/loans/${loan.id}/payments/new`}
                className={cn(buttonVariants())}
              >
                <Banknote className="h-4 w-4 mr-1.5" />
                Record Payment
              </Link>
            )}
            <Link
              href={`/receipts/disbursement/${loan.id}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Receipt className="h-4 w-4 mr-1.5" />
              Print Receipt
            </Link>
          </div>
        </div>
      </div>

      {/* Payments Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Payment History</h2>
          {activePayments.length > 0 && (
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {activePayments.length} payment{activePayments.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Banknote className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No payments recorded</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Record the first payment against this loan to start tracking repayments.
            </p>
            {loan.status === "active" && (
              <Link
                href={`/loans/${loan.id}/payments/new`}
                className={cn(buttonVariants({ size: "sm" }), "mt-2")}
              >
                Record Payment
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Amount</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Interest
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Interest Portion</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            The part of this payment that covers accrued interest. Interest is always paid first before any principal reduction.
                          </p>
                          <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                            Interest = Balance × (Rate ÷ 30) × Days Since Last Payment
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Minimum 30 days of interest is charged, even for early payments.
                          </p>
                        </InfoPopover>
                      </span>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Principal
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Principal Portion</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            The part of this payment that reduces the outstanding balance. Only the amount left after covering interest goes toward principal.
                          </p>
                          <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                            <p className="font-medium">Example:</p>
                            <p>Payment: UGX 150,000 − Interest: UGX 100,000</p>
                            <p>= UGX 50,000 applied to principal</p>
                          </div>
                        </InfoPopover>
                      </span>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Balance After
                        <InfoPopover>
                          <p className="font-semibold text-sm mb-1">Balance After Payment</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            The remaining principal balance after this payment was applied. When this reaches zero, the loan is fully paid.
                          </p>
                        </InfoPopover>
                      </span>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Recorded By</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => {
                    const isDeleted = payment.deletedAt !== null
                    const cellClass = isDeleted ? "opacity-50 line-through" : ""
                    const recorderName = userNameMap[payment.recordedBy] ?? payment.recordedBy.slice(0, 8)
                    return (
                      <TableRow key={payment.id} data-testid="data-row" className={isDeleted ? "bg-muted/20" : ""}>
                        <TableCell className={cn("font-mono tabular-nums text-sm", cellClass)}>
                          {formatDate(payment.paymentDate)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm text-muted-foreground", cellClass)}>
                          {formatCurrency(payment.interestPortion)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm text-muted-foreground", cellClass)}>
                          {formatCurrency(payment.principalPortion)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm font-medium", cellClass)}>
                          {formatCurrency(payment.principalBalanceAfter)}
                        </TableCell>
                        <TableCell className={cn("text-sm", cellClass)}>
                          <div className="flex items-center gap-1.5">
                            <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[120px]">{recorderName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isDeleted ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Deleted</Badge>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label="Payment actions"
                                className="flex h-8 w-8 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
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
            </div>
          </div>
        )}
      </div>

      {loan.status === "active" && (
        <SimulatorPanel
          loan={loan}
          payments={payments.filter(p => !p.deletedAt)}
          ledgerBalance={balanceData?.outstandingPrincipal ?? ledgerBalance}
        />
      )}

      {/* Edit Payment Dialog */}
      <DrawerDialog open={editingPayment !== null} onOpenChange={(open) => { if (!open) closeEditDialog() }}>
        <DrawerDialogContent>
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
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Delete Payment Dialog */}
      <DrawerDialog open={deletingPayment !== null} onOpenChange={(open) => { if (!open) closeDeleteDialog() }}>
        <DrawerDialogContent>
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
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Edit Loan Dialog */}
      <DrawerDialog open={editingLoan} onOpenChange={(open) => { if (!open) closeLoanEditDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Edit Loan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="loanPrincipal">Principal Amount (UGX)</Label>
              <Input
                id="loanPrincipal"
                type="text"
                value={loanPrincipal}
                onChange={(e) => setLoanPrincipal(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanInterestRate">Interest Rate (% per month)</Label>
              <Input
                id="loanInterestRate"
                type="number"
                min="0"
                step="0.1"
                value={loanInterestRate}
                onChange={(e) => setLoanInterestRate(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanStartDate">Start Date</Label>
              <Input
                id="loanStartDate"
                type="date"
                value={loanStartDate}
                onChange={(e) => setLoanStartDate(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanEditReason">Reason for edit</Label>
              <Textarea
                id="loanEditReason"
                value={loanEditReason}
                onChange={(e) => setLoanEditReason(e.target.value)}
                placeholder="Explain what is being corrected and why"
                disabled={isLoanEditPending}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeLoanEditDialog}
              disabled={isLoanEditPending}
            >
              Discard Changes
            </Button>
            <Button
              onClick={handleLoanEditSubmit}
              disabled={isLoanEditPending || !loanEditReason.trim()}
            >
              {isLoanEditPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Delete Loan Dialog */}
      <DrawerDialog open={deletingLoan} onOpenChange={(open) => { if (!open) closeLoanDeleteDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Delete loan?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the loan and all associated payments. This action cannot be undone.
            </p>
            <div className="space-y-1">
              <Label htmlFor="loanDeleteReason">Reason for deletion</Label>
              <Textarea
                id="loanDeleteReason"
                value={loanDeleteReason}
                onChange={(e) => setLoanDeleteReason(e.target.value)}
                placeholder="Explain why this loan is being deleted"
                disabled={isLoanDeletePending}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeLoanDeleteDialog}
              disabled={isLoanDeletePending}
            >
              Keep Loan
            </Button>
            <Button
              variant="destructive"
              onClick={handleLoanDeleteSubmit}
              disabled={isLoanDeletePending || !loanDeleteReason.trim()}
            >
              {isLoanDeletePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Deleting...
                </>
              ) : (
                "Delete Loan"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Rate Change Request Dialog */}
      <DrawerDialog open={requestingRateChange} onOpenChange={(open) => { if (!open) closeRateChangeDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Request Interest Rate Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current rate: {(parseFloat(loan.interestRate) * 100).toFixed(1)}% per month.
              {ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor
                ? " As a supervisor or above, rates between 8-10% will be applied immediately."
                : " Your request will be sent for supervisor or admin approval."}
            </p>
            <div className="space-y-1">
              <Label htmlFor="newRate">New Rate (% per month)</Label>
              <Input
                id="newRate"
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                disabled={isRateChangePending}
                placeholder="e.g. 8.0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {newRate && parseFloat(newRate) >= 10
                  ? "No approval required."
                  : newRate && parseFloat(newRate) >= 8 && parseFloat(newRate) < 10
                    ? "Requires supervisor approval (or higher)."
                    : newRate && parseFloat(newRate) > 0 && parseFloat(newRate) < 8
                      ? "Requires admin approval (or higher)."
                      : "Enter the new monthly interest rate."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeRateChangeDialog}
              disabled={isRateChangePending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRateChangeSubmit}
              disabled={isRateChangePending || !newRate.trim() || parseFloat(newRate) <= 0}
            >
              {isRateChangePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {balanceData && collateralNature && (
        <SettleCollateralDialog
          open={settlingCollateral}
          onOpenChange={setSettlingCollateral}
          loanId={loan.id}
          outstandingPrincipal={balanceData.outstandingPrincipal}
          accruedInterest={balanceData.accruedInterest}
          collateralNature={collateralNature}
          collateralDescription={collateralDescription ?? null}
        />
      )}
    </div>
  )
}
