"use client"

import { useTransition, useEffect, useMemo, useRef } from "react"
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
import { editPaymentAction, deletePaymentAction, getLoanBalanceAction, getPaymentPortionsAction } from "@/actions/payment.actions"
import { updateLoanAction, deleteLoanAction, waivePenaltyAction, adjustPenaltyMultiplierAction, getLoanPaymentContextAction } from "@/actions/loan.actions"
import { getEffectiveRate, isPenaltyActive } from "@/lib/interest/effective-rate"
import { requestRateChangeAction, listRequestsForLoanAction } from "@/actions/rate-change-request.actions"
import { useLoanPayments } from "@/hooks/use-payments"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole, type RateChangeRequest } from "@/types"
import type { Loan, Payment, PaymentPortionsMap } from "@/types"
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
import { PermissionInfo } from "@/components/ui/permission-info"
import BigNumber from "bignumber.js"
import { cn, formatDate, formatCurrency, formatRate } from "@/lib/utils"
import { calculateSchedule } from "@/lib/interest/engine"
import { useLoanDetailStore } from "@/lib/stores/loan-detail"
import { loanStatusVariant, loanStatusLabel } from "@/lib/status"
import { PaymentReceiptButton } from "@/components/receipts/payment-receipt-button"
import { DisbursementReceiptButton } from "@/components/receipts/disbursement-receipt-button"

interface LoanDetailClientProps {
  loan: Loan
  initialPayments: Payment[]
  customerName: string | null
  canModify: boolean
  openEditOnMount?: boolean
  userNameMap: Record<string, string>
  ledgerBalance: string | null
  paymentPortions: PaymentPortionsMap
  userRole: UserRole
  collateralNature?: string
  collateralDescription?: string | null
  daysOverdue: number
}

export function LoanDetailClient({ loan, initialPayments, customerName, canModify, openEditOnMount, userNameMap, ledgerBalance, paymentPortions, userRole, collateralNature, collateralDescription, daysOverdue }: LoanDetailClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const penaltyActive = isPenaltyActive(daysOverdue, loan.penaltyWaived)

  // Use TanStack Query for payments so subsequent navigations are cached
  const { data: payments = initialPayments } = useLoanPayments(loan.id, true, initialPayments)

  // Client-side query for payment portions — refreshes when payments change
  const activePaymentIds = payments.filter((p) => p.deletedAt === null && !p.markedWrong).map((p) => p.id)
  const { data: livePortions } = useQuery<PaymentPortionsMap>({
    queryKey: [...queryKeys.payments.portions(loan.id), activePaymentIds.join(",")],
    queryFn: async () => {
      if (activePaymentIds.length === 0) return {}
      const result = await getPaymentPortionsAction(activePaymentIds)
      if ("error" in result) return {}
      return result.data
    },
    enabled: activePaymentIds.length > 0,
    initialData: paymentPortions,
  })
  const currentPortions = livePortions ?? paymentPortions

  const {
    editingPayment, editAmount, editDate, editReason,
    openPaymentEdit, closePaymentEdit, setEditAmount, setEditDate, setEditReason,
    deletingPayment, deleteReason,
    openPaymentDelete, closePaymentDelete, setDeleteReason,
    editingLoan, loanPrincipal, loanInterestRate, loanStartDate, loanEditReason,
    openLoanEdit, closeLoanEdit, setLoanPrincipal, setLoanInterestRate, setLoanStartDate, setLoanEditReason,
    deletingLoan, loanDeleteReason,
    openLoanDelete, closeLoanDelete, setLoanDeleteReason,
    settlingCollateral, openSettleCollateral, closeSettleCollateral,
    requestingRateChange, newRate,
    openRateChange, closeRateChange, setNewRate,
    adjustingPenalty, penaltyMultiplierInput,
    openPenaltyAdjust, closePenaltyAdjust, setPenaltyMultiplierInput,
    reset,
  } = useLoanDetailStore()

  const [isEditPending, startEditTransition] = useTransition()
  const [isDeletePending, startDeleteTransition] = useTransition()
  const [isLoanEditPending, startLoanEditTransition] = useTransition()
  const [isLoanDeletePending, startLoanDeleteTransition] = useTransition()
  const [isRateChangePending, startRateChangeTransition] = useTransition()
  const [isWaivingPenalty, startWaivePenaltyTransition] = useTransition()
  const [isAdjustingPenalty, startAdjustPenaltyTransition] = useTransition()

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
    queryKey: queryKeys.loans.balance(loan.id),
    queryFn: async () => {
      const result = await getLoanBalanceAction(loan.id)
      if ("error" in result) return null
      return result.data
    },
    enabled: loan.status === "active",
  })

  // Prefetch record-payment data so the page loads instantly
  useEffect(() => {
    if (loan.status !== "active") return;
    queryClient.prefetchQuery({
      queryKey: queryKeys.loans.paymentContext(loan.id),
      queryFn: () => getLoanPaymentContextAction(loan.id).then((r) => ("error" in r ? undefined : r.data)),
    });
  }, [loan.id, loan.status, queryClient]);

  const pendingRateRequest = rateChangeRequests.find((r: RateChangeRequest) => r.status === "pending")

  // Initialize penalty multiplier on mount and reset on unmount
  useEffect(() => {
    setPenaltyMultiplierInput((Number(loan.penaltyMultiplier) * 100).toFixed(0))
    return () => reset()
  }, [loan.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const didOpenRef = useRef(false)
  useEffect(() => {
    if (!didOpenRef.current && openEditOnMount && canModify) {
      didOpenRef.current = true
      openLoanEdit(loan)
    }
  }, [openEditOnMount, canModify, loan, openLoanEdit])

  const activePayments = payments
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())
  // Use ledger-derived balance from server; fall back to principalAmount
  const outstandingBalance = ledgerBalance ?? loan.principalAmount

  const principalNum = parseFloat(loan.principalAmount)
  const balanceNum = parseFloat(outstandingBalance)
  const totalPaid = Math.max(0, principalNum - balanceNum)
  const repaymentPercent = principalNum > 0 ? Math.min(100, Math.max(0, Math.round((totalPaid / principalNum) * 100))) : 0

  const schedule = useMemo(
    () => loan.termMonths
      ? calculateSchedule(
          loan.principalAmount,
          loan.interestRateOverride ?? loan.interestRate,
          loan.termMonths,
          loan.loanType as "fixed_rate" | "reducing_balance"
        ).entries
      : [],
    [loan.principalAmount, loan.interestRateOverride, loan.interestRate, loan.termMonths, loan.loanType]
  )

  // Compute running balance per payment for the "Balance" column
  const runningBalanceMap = useMemo(() => {
    const map: Record<string, string> = {}
    let balance = new BigNumber(loan.principalAmount)
    // Use non-deleted payments sorted by date
    const sorted = payments
      .filter((p) => p.deletedAt === null && !p.markedWrong)
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime() || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (const p of sorted) {
      const principal = currentPortions[p.id]?.principalPortion ?? "0"
      balance = balance.minus(new BigNumber(principal))
      if (balance.isLessThan(0)) balance = new BigNumber(0)
      map[p.id] = balance.toFixed(0)
    }
    return map
  }, [payments, currentPortions, loan.principalAmount])


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

      toast.success("Payment updated")
      closePaymentEdit()

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

      toast.success("Payment deleted")
      closePaymentDelete()

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

      toast.success("Loan updated")
      closeLoanEdit()

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

      toast.success("Loan deleted")
      closeLoanDelete()

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      router.push("/loans")
    })
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

      closeRateChange()
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
              {penaltyActive && (
                <Badge variant="destructive" className="text-xs">
                  Penalty Active
                </Badge>
              )}
              {loan.penaltyWaived && !penaltyActive && (
                <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                  Penalty Waived
                </Badge>
              )}
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
            <Button variant="outline" size="sm" onClick={() => openLoanEdit(loan)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={openLoanDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openSettleCollateral()}
                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-300"
              >
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Settle with Collateral
              </Button>
            )}
            <PermissionInfo
              requiredRole="admin"
              action="Edit or delete loan"
              detail="Admins can edit or delete any loan. Loan officers and supervisors can only edit their own loan immediately after creation."
            />
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
            {formatRate(loan.interestRate, 1)}
            <span className="text-sm font-normal text-muted-foreground ml-1">/ month</span>
          </p>
          {penaltyActive && (
            <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                <span className="text-xs font-medium text-destructive">Penalty Rate Active</span>
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Overdue Penalty</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    This loan has had unpaid interest for more than 60 days. A penalty of {formatRate(loan.penaltyMultiplier)} has been added to the base interest rate.
                  </p>
                  <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                    Effective Rate = {formatRate(loan.interestRate, 1)} + ({formatRate(loan.penaltyMultiplier)} penalty) = {formatRate(getEffectiveRate(loan, penaltyActive), 1)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The penalty is automatically removed when the borrower catches up on interest payments (less than 60 days overdue). An admin can also waive it manually.
                  </p>
                </InfoPopover>
              </div>
              <p className="text-sm font-mono font-semibold text-destructive">
                Effective: {formatRate(getEffectiveRate(loan, penaltyActive), 1)} / month
              </p>
              {ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin ? (
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isWaivingPenalty}
                    onClick={() => {
                      startWaivePenaltyTransition(async () => {
                        const result = await waivePenaltyAction(loan.id)
                        if ("error" in result) {
                          toast.error(result.error)
                        } else {
                          toast.success("Penalty waived")
                          router.refresh()
                        }
                      })
                    }}
                  >
                    {isWaivingPenalty ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Waive Penalty
                  </Button>
                  {!adjustingPenalty ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openPenaltyAdjust()}>
                      Adjust Rate
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-7 w-16 text-xs"
                        value={penaltyMultiplierInput}
                        onChange={(e) => setPenaltyMultiplierInput(e.target.value)}
                        placeholder="%"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isAdjustingPenalty}
                        onClick={() => {
                          startAdjustPenaltyTransition(async () => {
                            const decimal = (parseFloat(penaltyMultiplierInput) / 100).toFixed(4)
                            const result = await adjustPenaltyMultiplierAction(loan.id, decimal)
                            if ("error" in result) {
                              toast.error(result.error)
                            } else {
                              toast.success("Penalty rate adjusted")
                              closePenaltyAdjust()
                              router.refresh()
                            }
                          })
                        }}
                      >
                        {isAdjustingPenalty ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => closePenaltyAdjust()}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2">
                  <PermissionInfo
                    requiredRole="admin"
                    action="Waive or adjust penalty"
                    detail="Only admins can waive penalties or adjust the penalty multiplier rate."
                    locked
                  />
                </div>
              )}
            </div>
          )}
          {pendingRateRequest && (
            <Badge variant="outline" className="mt-2 text-xs">
              Pending: {formatRate(pendingRateRequest.requestedRate, 1)}
            </Badge>
          )}
          {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.loanOfficer && !pendingRateRequest && (
            <div className="flex items-center gap-1.5 mt-2">
              <Button variant="outline" size="sm" onClick={() => openRateChange(loan.interestRate)}>
                <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
                Request Rate Change
              </Button>
              <PermissionInfo
                requiredRole="loanOfficer"
                action="Request rate change"
                detail="Any loan officer can request a rate change. Rates ≥10% apply immediately. Rates 8-10% need supervisor approval. Rates below 8% need admin approval."
              />
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Calendar className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Start Date</span>
            {loan.backdatedFrom && (
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Backdated Loan</p>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>This loan was entered into the system on <strong>{formatDate(loan.backdatedFrom)}</strong> but backdated to <strong>{formatDate(loan.startDate)}</strong>.</p>
                  {loan.backdatedBy && userNameMap[loan.backdatedBy] && (
                    <p>Backdated by: <strong>{userNameMap[loan.backdatedBy]}</strong></p>
                  )}
                  {loan.backdateNote && (
                    <p>Reason: {loan.backdateNote}</p>
                  )}
                </div>
              </InfoPopover>
            )}
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatDate(loan.startDate)}
          </p>
          {loan.backdatedFrom && (
            <p className="text-xs text-amber-600 mt-1">Backdated (entered {formatDate(loan.backdatedFrom)})</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Banknote className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Issuance Fee</span>
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Issuance Fee</p>
              <p className="text-xs text-muted-foreground">
                A one-time fee charged when the loan is disbursed. This is deducted upfront and recorded as revenue. It does not affect the principal balance or interest calculations.
              </p>
            </InfoPopover>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatCurrency(loan.issuanceFee)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Loan Type</span>
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Loan Type</p>
              <div className="text-xs text-muted-foreground space-y-2">
                <p><strong>Fixed Rate</strong> — Interest is always calculated on the original principal amount, regardless of how much has been repaid.</p>
                <p><strong>Reducing Balance</strong> — Interest is calculated on the remaining principal balance, so it decreases as the borrower pays down the loan.</p>
                <p><strong>Perpetual</strong> — No maturity date. The loan runs indefinitely in 30-day cycles until fully paid or settled.</p>
              </div>
            </InfoPopover>
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
          <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            Amortization Schedule
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Amortization Schedule</p>
              <p className="text-xs text-muted-foreground mb-2">
                A projected breakdown of each monthly payment showing how much goes to interest vs principal. Actual payments may differ if payments are made early, late, or in different amounts.
              </p>
              <p className="text-xs text-muted-foreground">
                For <strong>Fixed Rate</strong> loans, interest is the same each month. For <strong>Reducing Balance</strong> loans, interest decreases as the principal is paid down.
              </p>
            </InfoPopover>
          </h3>
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
                {schedule.map((entry) => (
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
            <DisbursementReceiptButton loanId={loan.id} />
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

        {activePayments.length === 0 ? (
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
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Interest</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Principal</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Balance</TableHead>
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
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                          {formatCurrency(currentPortions[payment.id]?.interestPortion ?? "0.00")}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                          {formatCurrency(currentPortions[payment.id]?.principalPortion ?? "0.00")}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                          {payment.markedWrong ? "—" : formatCurrency(runningBalanceMap[payment.id] ?? outstandingBalance)}
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
                                <PaymentReceiptButton
                                  variant="dropdown-item"
                                  data={{
                                    paymentDate: payment.paymentDate,
                                    customerName: customerName ?? "—",
                                    loanReference: loanRef,
                                    amountPaid: payment.amount,
                                    interestPortion: currentPortions[payment.id]?.interestPortion ?? "0.00",
                                    principalPortion: currentPortions[payment.id]?.principalPortion ?? "0.00",
                                    balanceAfter: runningBalanceMap[payment.id] ?? outstandingBalance,
                                    depositLocation: payment.depositLocation,
                                    officerName: userNameMap[payment.recordedBy] ?? "Officer",
                                  }}
                                />
                                <DropdownMenuItem
                                  onClick={() => openPaymentEdit(payment)}
                                >
                                  Edit Payment
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openPaymentDelete(payment)}
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
          totalInterestPaid={Object.values(currentPortions).reduce(
            (sum, p) => sum.plus(p.interestPortion), new BigNumber(0)
          ).toFixed(0)}
        />
      )}

      {/* Edit Payment Dialog */}
      <DrawerDialog open={editingPayment !== null} onOpenChange={(open) => { if (!open) closePaymentEdit() }}>
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
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closePaymentEdit}
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
      <DrawerDialog open={deletingPayment !== null} onOpenChange={(open) => { if (!open) closePaymentDelete() }}>
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
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closePaymentDelete}
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
      <DrawerDialog open={editingLoan} onOpenChange={(open) => { if (!open) closeLoanEdit() }}>
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
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeLoanEdit}
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
      <DrawerDialog open={deletingLoan} onOpenChange={(open) => { if (!open) closeLoanDelete() }}>
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
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeLoanDelete}
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
      <DrawerDialog open={requestingRateChange} onOpenChange={(open) => { if (!open) closeRateChange() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Request Interest Rate Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current rate: {formatRate(loan.interestRate, 1)} per month.
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
              onClick={closeRateChange}
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
          onOpenChange={(v) => { if (!v) closeSettleCollateral() }}
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
