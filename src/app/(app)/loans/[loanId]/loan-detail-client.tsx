"use client"

import { useTransition, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { prefetchQueue, Priority } from "@/lib/prefetch-queue"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft,
  Banknote,
  Receipt,
  ShieldAlert,
  PlusCircle,
} from "lucide-react"
import { editPaymentAction, deletePaymentAction, getLoanBalanceAction, getPaymentPortionsAction } from "@/actions/payment.actions"
import { waivePenaltyAction, adjustPenaltyMultiplierAction, getLoanPaymentContextAction } from "@/actions/loan.actions"
import { isPenaltyActive } from "@/lib/interest/effective-rate"
import { requestRateChangeAction, listRequestsForLoanAction } from "@/actions/rate-change-request.actions"
import { useLoanPayments } from "@/hooks/use-payments"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/query-keys"
import type { UserRole, RateChangeRequest } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import type { Loan, Payment, PaymentPortionsMap } from "@/types"
import { SettleCollateralDialog } from "@/components/loans/settle-collateral-dialog"
import { SimulatorPanel } from "@/components/loans/simulator-panel"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { InfoPopover } from "@/components/ui/info-popover"
import BigNumber from "bignumber.js"
import { cn, formatCurrency, shortId } from "@/lib/utils"
import { calculateSchedule } from "@/lib/interest/engine"
import { useLoanDetailStore } from "@/lib/stores/loan-detail"
import { loanStatusVariant, loanStatusLabel } from "@/lib/status"
import { DisbursementReceiptButton } from "@/components/receipts/disbursement-receipt-button"
import { LoanInfoCards } from "./loan-info-cards"
import { PaymentTable } from "./payment-table"
import { EditPaymentDialog } from "./edit-payment-dialog"
import { DeletePaymentDialog } from "./delete-payment-dialog"
import { RateChangeDialog } from "./rate-change-dialog"

interface LoanDetailClientProps {
  loan: Loan
  initialPayments: Payment[]
  customerName: string | null
  userNameMap: Record<string, string>
  ledgerBalance: string | null
  paymentPortions: PaymentPortionsMap
  userRole: UserRole
  collateralNature?: string
  collateralDescription?: string | null
  daysOverdue: number
}

export function LoanDetailClient({ loan, initialPayments, customerName, userNameMap, ledgerBalance, paymentPortions, userRole, collateralNature, collateralDescription, daysOverdue }: LoanDetailClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const penaltyActive = isPenaltyActive(daysOverdue, loan.penaltyWaived)

  // Use TanStack Query for payments so subsequent navigations are cached
  const { data: rawPayments } = useLoanPayments(loan.id, true, initialPayments)
  const payments = Array.isArray(rawPayments) ? rawPayments : (Array.isArray(initialPayments) ? initialPayments : [])

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
    settlingCollateral, openSettleCollateral, closeSettleCollateral,
    requestingRateChange, newRate,
    openRateChange, closeRateChange, setNewRate,
    adjustingPenalty, penaltyMultiplierInput,
    openPenaltyAdjust, closePenaltyAdjust, setPenaltyMultiplierInput,
    reset,
  } = useLoanDetailStore()

  const [isEditPending, startEditTransition] = useTransition()
  const [isDeletePending, startDeleteTransition] = useTransition()
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
    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.loans.paymentContext(loan.id),
        queryFn: () => getLoanPaymentContextAction(loan.id).then((r) => ("error" in r ? undefined : r.data)),
      }), Priority.NORMAL, `data:loan-payment-context-${loan.id}`);
  }, [loan.id, loan.status, queryClient]);

  const rateChangeList = Array.isArray(rateChangeRequests) ? rateChangeRequests : []
  const pendingRateRequest = rateChangeList.find((r: RateChangeRequest) => r.status === "pending")

  // Initialize penalty multiplier on mount and reset on unmount
  useEffect(() => {
    setPenaltyMultiplierInput((Number(loan.penaltyMultiplier) * 100).toFixed(0))
    return () => reset()
  }, [loan.id]) // eslint-disable-line react-hooks/exhaustive-deps


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

  function handleWaivePenalty() {
    startWaivePenaltyTransition(async () => {
      const result = await waivePenaltyAction(loan.id)
      if ("error" in result) {
        toast.error(result.error)
      } else {
        toast.success("Penalty waived")
        router.refresh()
      }
    })
  }

  function handleAdjustPenaltySave() {
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
  }

  const loanRef = `LOAN-${shortId(loan.id).toUpperCase()}`

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
                <Link
                  href={`/customers/${loan.customerId}`}
                  className="text-xl font-semibold tracking-tight underline-offset-4 hover:underline cursor-pointer"
                >
                  {customerName}
                </Link>
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

        <div className="flex items-center gap-2">
          <Link
            href={`/loans/new?customerId=${loan.customerId}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            Issue New Loan
          </Link>
          {loan.status === "active" && has("loan:settle") && (
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
        </div>
      </div>

      {/* Loan Details Grid */}
      <LoanInfoCards
        loan={loan}
        penaltyActive={penaltyActive}
        userRole={userRole}
        userNameMap={userNameMap}
        pendingRateRequest={pendingRateRequest}
        isWaivingPenalty={isWaivingPenalty}
        onWaivePenalty={handleWaivePenalty}
        adjustingPenalty={adjustingPenalty}
        penaltyMultiplierInput={penaltyMultiplierInput}
        onPenaltyMultiplierInputChange={setPenaltyMultiplierInput}
        isAdjustingPenalty={isAdjustingPenalty}
        onAdjustPenaltySave={handleAdjustPenaltySave}
        onOpenPenaltyAdjust={openPenaltyAdjust}
        onClosePenaltyAdjust={closePenaltyAdjust}
        onOpenRateChange={openRateChange}
      />

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

      {/* Payments Section */}
      <PaymentTable
        payments={payments}
        activePayments={activePayments}
        loanId={loan.id}
        loanRef={loanRef}
        loanStatus={loan.status}
        customerName={customerName}
        userNameMap={userNameMap}
        currentPortions={currentPortions}
        runningBalanceMap={runningBalanceMap}
        outstandingBalance={outstandingBalance}
        onEditPayment={openPaymentEdit}
        onDeletePayment={openPaymentDelete}
      />

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

      {/* Dialogs */}
      <EditPaymentDialog
        open={editingPayment !== null}
        amount={editAmount}
        date={editDate}
        reason={editReason}
        isPending={isEditPending}
        onAmountChange={setEditAmount}
        onDateChange={setEditDate}
        onReasonChange={setEditReason}
        onSubmit={handleEditSubmit}
        onClose={closePaymentEdit}
      />
      <DeletePaymentDialog
        open={deletingPayment !== null}
        reason={deleteReason}
        isPending={isDeletePending}
        onReasonChange={setDeleteReason}
        onSubmit={handleDeleteSubmit}
        onClose={closePaymentDelete}
      />
      <RateChangeDialog
        open={requestingRateChange}
        loan={loan}
        userRole={userRole}
        newRate={newRate}
        isPending={isRateChangePending}
        onNewRateChange={setNewRate}
        onSubmit={handleRateChangeSubmit}
        onClose={closeRateChange}
      />

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
