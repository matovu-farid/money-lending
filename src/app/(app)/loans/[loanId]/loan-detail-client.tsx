"use client"

import { useTransition, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeft,
  Banknote,
  ShieldAlert,
  PlusCircle,
} from "lucide-react"
import { updatePaymentWithInput, deletePaymentWithReason, currentUserRoleCollection, getLoanCollateralCollection, getUserNameMapCollection, getPaymentPortionsCollection, getLoanBalanceCollection, insertRateChangeRequestWithInput } from "@/collections"
import { waivePenaltyAction, adjustPenaltyMultiplierAction } from "@/actions/loan.actions"
import { isPenaltyActive } from "@/lib/interest/effective-rate"
import { generateClientId } from "@/lib/client-id"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { useLiveSuspenseQuery, useLiveQuery, eq } from "@tanstack/react-db"
import { paymentCollection, rateChangeRequestCollection } from "@/collections"
import type { UserRole, RateChangeRequest, LoanListEntry } from "@/types"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import { usePermissions } from "@/hooks/use-permissions"
import type { Loan, PaymentPortionsMap } from "@/types"
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
  loanEntry: LoanListEntry
  customerName: string | null
}

export function LoanDetailClient({ loanEntry, customerName }: LoanDetailClientProps) {
  // LoanListEntry extends Loan, so we can use it directly as a Loan
  const loan: Loan = loanEntry
  const daysOverdue = loanEntry.daysOverdue
  const ledgerBalance: string | null = loanEntry.outstandingBalance

  const router = useRouter()
  const { has } = usePermissions()
  const penaltyActive = isPenaltyActive(daysOverdue, loan.penaltyWaived)

  // Fetch userRole via collection
  const { data: userRoleRows } = useLiveSuspenseQuery((q) =>
    q.from({ r: currentUserRoleCollection }).select(({ r }) => r)
  )
  const userRole: UserRole = userRoleRows?.[0]?.role ?? ("unassigned" as UserRole)

  // Fetch collateral via collection
  const collateralColl = getLoanCollateralCollection(loan.id)
  const { data: collateralRows } = useLiveSuspenseQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ c: collateralColl as any }).select(({ c }: any) => c),
    [loan.id]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collateralData = (collateralRows as any)?.[0] ?? null
  const collateralNature = collateralData?.nature
  const collateralDescription = collateralData?.description ?? null

  // Use TanStack DB collection for payments — live, reactive, cached
  const { data: rawPayments } = useLiveSuspenseQuery(
    (q) => q.from({ p: paymentCollection }).where(({ p }) => eq(p.loanId, loan.id)),
    [loan.id]
  )
  const payments = Array.isArray(rawPayments) ? rawPayments : []

  // Resolve recordedBy user IDs to names
  const uniqueUserIds = useMemo(
    () => [...new Set(payments.map((p) => p.recordedBy))],
    [payments]
  )
  const userNameMapColl = getUserNameMapCollection(uniqueUserIds)
  const { data: userNameMapRows } = useLiveQuery(
    (q) => q.from({ u: userNameMapColl }).select(({ u }) => u),
    [uniqueUserIds.join(",")]
  )
  const userNameMap: Record<string, string> = userNameMapRows?.[0]?.map ?? {}

  // Client-side query for payment portions — refreshes when payments change
  const activePaymentIds = payments.map((p) => p.id)
  const portionsColl = getPaymentPortionsCollection(loan.id, activePaymentIds)
  const { data: portionsRows } = useLiveQuery(
    (q) => q.from({ pp: portionsColl }).select(({ pp }) => pp),
    [activePaymentIds.join(",")]
  )
  const currentPortions: PaymentPortionsMap = portionsRows?.[0]?.portions ?? {}

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

  // Edit/delete are now synchronous collection ops — no pending state needed
  const isEditPending = false
  const isDeletePending = false
  const isRateChangePending = false
  const [isWaivingPenalty, startWaivePenaltyTransition] = useTransition()
  const [isAdjustingPenalty, startAdjustPenaltyTransition] = useTransition()

  // Fetch rate change requests for this loan from collection
  const { data: rateChangeRequests = [] } = useLiveSuspenseQuery(
    (q) => q.from({ r: rateChangeRequestCollection }).where(({ r }) => eq(r.loanId, loan.id)),
    [loan.id]
  )

  const balanceColl = getLoanBalanceCollection(loan.id)
  const { data: balanceRows } = useLiveSuspenseQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q) => q.from({ b: balanceColl as any }).select(({ b }: any) => b),
    [loan.id]
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balanceData = (balanceRows as any)?.[0] ?? null

  // Route prefetch for record-payment page
  useEffect(() => {
    if (loan.status !== "active") return;
    router.prefetch(`/loans/${loan.id}/payments/new`);
  }, [loan.id, loan.status, router]);

  const rateChangeList = Array.isArray(rateChangeRequests) ? rateChangeRequests : []
  const pendingRateRequest = rateChangeList.find((r: RateChangeRequest) => r.status === "pending")

  // Initialize penalty multiplier on mount and reset on unmount
  useEffect(() => {
    setPenaltyMultiplierInput((Number(loan.penaltyMultiplier) * 100).toFixed(0))
    return () => reset()
  }, [loan.id]) // eslint-disable-line react-hooks/exhaustive-deps


  const activePayments = [...payments]
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
    try {
      const input = {
        paymentId: editingPayment.id,
        amount: editAmount.trim(),
        paymentDate: editDate ? editDate + "T12:00:00" : undefined,
        reason: editReason.trim(),
      }
      updatePaymentWithInput(editingPayment.id, input, (draft) => {
        if (editAmount.trim()) draft.amount = editAmount.trim()
        if (editDate) draft.paymentDate = new Date(editDate + "T12:00:00") as unknown as typeof draft.paymentDate
      })
      toast.success("Payment updated")
      closePaymentEdit()
    } catch {
      toast.error("Failed to update payment")
    }
  }

  function handleDeleteSubmit() {
    if (!deletingPayment) return
    try {
      deletePaymentWithReason(deletingPayment.id, deleteReason.trim())
      toast.success("Payment deleted")
      closePaymentDelete()
    } catch {
      toast.error("Failed to delete payment")
    }
  }

  function handleRateChangeSubmit() {
    const rateDecimal = (parseFloat(newRate) / 100).toFixed(4)
    const id = generateClientId()
    const now = new Date()

    const optimistic: RateChangeRequestWithLoan = {
      id,
      loanId: loan.id,
      requestedRate: rateDecimal,
      currentRate: loan.interestRateOverride ?? loan.interestRate,
      status: "pending",
      requestedBy: "",
      requiredApproverRole: "",
      reviewedBy: null,
      reviewNote: null,
      createdAt: now,
      reviewedAt: null,
      customerName: customerName ?? "",
      loanRef: `LOAN-${loan.id.slice(0, 6).toUpperCase()}`,
      principalAmount: loan.principalAmount,
    }

    try {
      insertRateChangeRequestWithInput(id, optimistic, {
        loanId: loan.id,
        requestedRate: rateDecimal,
      })
      toast.success("Rate change request submitted")
      closeRateChange()
    } catch {
      toast.error("Failed to submit rate change request")
    }
  }

  function handleWaivePenalty() {
    startWaivePenaltyTransition(async () => {
      const result = await waivePenaltyAction(loan.id)
      if ("error" in result) {
        toast.error(result.error)
      } else {
        toast.success("Penalty waived")
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loan.id) })
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
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.loans.balance(loan.id) })
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
          payments={payments}
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
