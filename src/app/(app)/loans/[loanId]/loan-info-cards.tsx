"use client"

import {
  ArrowUpDown,
  Calendar,
  Percent,
  Banknote,
  ShieldAlert,
  Loader2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoPopover } from "@/components/ui/info-popover"
import { PermissionInfo } from "@/components/ui/permission-info"
import type { UserRole, RateChangeRequest, Loan } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"
import { getBaseRate, getEffectiveRate } from "@/lib/interest/effective-rate"

export interface LoanInfoCardsProps {
  loan: Loan
  penaltyActive: boolean
  userRole: UserRole
  userNameMap: Record<string, string>
  pendingRateRequest: RateChangeRequest | undefined
  // Penalty controls
  isWaivingPenalty: boolean
  onWaivePenalty: () => void
  adjustingPenalty: boolean
  penaltyMultiplierInput: string
  onPenaltyMultiplierInputChange: (value: string) => void
  isAdjustingPenalty: boolean
  onAdjustPenaltySave: () => void
  onOpenPenaltyAdjust: () => void
  onClosePenaltyAdjust: () => void
  // Rate change
  onOpenRateChange: (currentRate: string) => void
}

export function LoanInfoCards({
  loan,
  penaltyActive,
  userRole,
  userNameMap,
  pendingRateRequest,
  isWaivingPenalty,
  onWaivePenalty,
  adjustingPenalty,
  penaltyMultiplierInput,
  onPenaltyMultiplierInputChange,
  isAdjustingPenalty,
  onAdjustPenaltySave,
  onOpenPenaltyAdjust,
  onClosePenaltyAdjust,
  onOpenRateChange,
}: LoanInfoCardsProps) {
  const { has } = usePermissions()

  return (
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
          {formatRate(getBaseRate(loan), 1)}
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
                  Effective Rate = {formatRate(getBaseRate(loan), 1)} + ({formatRate(loan.penaltyMultiplier)} penalty) = {formatRate(getEffectiveRate(loan, penaltyActive), 1)}
                </p>
                <p className="text-xs text-muted-foreground">
                  The penalty is automatically removed when the borrower catches up on interest payments (less than 60 days overdue). An admin can also waive it manually.
                </p>
              </InfoPopover>
            </div>
            <p className="text-sm font-mono font-semibold text-destructive">
              Effective: {formatRate(getEffectiveRate(loan, penaltyActive), 1)} / month
            </p>
            {has("settings:update") ? (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isWaivingPenalty}
                  onClick={onWaivePenalty}
                >
                  {isWaivingPenalty ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Waive Penalty
                </Button>
                {!adjustingPenalty ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenPenaltyAdjust}>
                    Adjust Rate
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-7 w-16 text-xs"
                      value={penaltyMultiplierInput}
                      onChange={(e) => onPenaltyMultiplierInputChange(e.target.value)}
                      placeholder="%"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isAdjustingPenalty}
                      onClick={onAdjustPenaltySave}
                    >
                      {isAdjustingPenalty ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClosePenaltyAdjust}>
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
        {pendingRateRequest && loan.status === "active" && (
          <Badge variant="outline" className="mt-2 text-xs">
            Pending: {formatRate(pendingRateRequest.requestedRate, 1)}
          </Badge>
        )}
        {pendingRateRequest && loan.status !== "active" && (
          <Badge variant="outline" className="mt-2 text-xs text-muted-foreground">
            Request cancelled (loan closed)
          </Badge>
        )}
        {loan.status === "active" && has("rate-change:create") && !pendingRateRequest && (
          <div className="flex items-center gap-1.5 mt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenRateChange(getBaseRate(loan))}>
              <ArrowUpDown className="h-3.5 w-3.5" />
              Request Rate Change
            </Button>
            <PermissionInfo
              requiredRole="loanOfficer"
              action="Request rate change"
              detail="Any loan officer can request a rate change. Rates >=10% apply immediately. Rates 8-10% need supervisor approval. Rates below 8% need admin approval."
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
  )
}
