"use client"

import { useState } from "react"
import {
  allocatePayment,
  calculateDaysOverdue,
  calculateDailyRate,
  calculateInterest,
  formatAmount,
} from "@/lib/interest"
import type { PaymentAllocation } from "@/lib/interest"
import BigNumber from "bignumber.js"
import type { Loan, Payment } from "@/types"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface SimulatorPanelProps {
  loan: Loan
  payments: Payment[] // non-deleted payments only
}

interface SimulatorResult {
  allocation: PaymentAllocation
  currentDaysOverdue: string
  afterDaysOverdue: string
  currentOutstanding: string
  currentUnpaidInterest: string
  afterUnpaidInterest: string
}

function formatUGX(amount: string | null | undefined): string {
  if (!amount) return "—"
  const num = parseFloat(amount)
  if (isNaN(num)) return "—"
  return new Intl.NumberFormat("en-UG", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(num)
}

export function SimulatorPanel({ loan, payments }: SimulatorPanelProps) {
  const [amount, setAmount] = useState("")
  const [result, setResult] = useState<SimulatorResult | null>(null)

  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays
  const dailyRate = calculateDailyRate(effectiveRate)

  // Determine current outstanding balance from last payment
  const sortedPayments = [...payments].sort(
    (a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
  )
  const lastPayment = sortedPayments.at(-1)
  const currentOutstanding = lastPayment
    ? lastPayment.principalBalanceAfter
    : loan.principalAmount

  // Calculate current days elapsed since loan start
  const now = new Date()
  const totalDaysElapsed = Math.floor(
    (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
  )

  // Calculate total interest accrued
  const totalInterestAccrued = calculateInterest(
    loan.principalAmount,
    effectiveRate,
    totalDaysElapsed,
    effectiveMinDays
  )

  // Calculate total interest paid
  const totalInterestPaid = sortedPayments.reduce(
    (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
    new BigNumber(0)
  )

  // Calculate current days overdue
  const currentDaysOverdueBN = calculateDaysOverdue(
    totalInterestAccrued.toFixed(2),
    totalInterestPaid.toFixed(2),
    dailyRate.toFixed(10)
  )
  const currentUnpaidInterest = totalInterestAccrued.minus(totalInterestPaid)

  function handleSimulate() {
    if (!amount || new BigNumber(amount).isLessThanOrEqualTo(0)) return

    // Use allocatePayment from engine.ts (RISK-04: same implementation as real system)
    const allocation = allocatePayment({
      paymentAmount: amount,
      principalBalanceBefore: currentOutstanding,
      monthlyRateDecimal: effectiveRate,
      daysElapsed: totalDaysElapsed,
      minInterestDays: effectiveMinDays,
    })

    // Calculate after-payment days overdue
    const afterInterestPaid = totalInterestPaid.plus(new BigNumber(allocation.interestPortion))
    const afterDaysOverdueBN = calculateDaysOverdue(
      totalInterestAccrued.toFixed(2),
      afterInterestPaid.toFixed(2),
      dailyRate.toFixed(10)
    )
    const afterUnpaidInterestBN = totalInterestAccrued.minus(afterInterestPaid)

    setResult({
      allocation,
      currentDaysOverdue: currentDaysOverdueBN.toFixed(0),
      afterDaysOverdue: afterDaysOverdueBN.toFixed(0),
      currentOutstanding,
      currentUnpaidInterest: formatAmount(
        currentUnpaidInterest.isLessThan(0) ? new BigNumber(0) : currentUnpaidInterest
      ),
      afterUnpaidInterest: formatAmount(
        afterUnpaidInterestBN.isLessThan(0) ? new BigNumber(0) : afterUnpaidInterestBN
      ),
    })
  }

  const amountChanged =
    result !== null && result.allocation.principalBalanceAfter !== currentOutstanding
  const interestChanged =
    result !== null && result.afterUnpaidInterest !== result.currentUnpaidInterest
  const daysChanged =
    result !== null && result.afterDaysOverdue !== result.currentDaysOverdue

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Repayment Simulator</h2>
      <p className="text-sm text-muted-foreground">
        Simulate a payment to see how it would affect this loan without recording it.
      </p>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="simulatorAmount">Simulate payment of UGX</Label>
          <Input
            id="simulatorAmount"
            type="number"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-48"
            min="0"
          />
        </div>
        <Button
          onClick={handleSimulate}
          disabled={!amount || new BigNumber(amount || "0").isLessThanOrEqualTo(0)}
        >
          Simulate
        </Button>
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground">Enter an amount to simulate.</p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Current state card */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <p className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Current
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outstanding Balance</span>
                    <span className="font-medium">UGX {formatUGX(result.currentOutstanding)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unpaid Interest</span>
                    <span className="font-medium">UGX {formatUGX(result.currentUnpaidInterest)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Days Coverage</span>
                    <span className="font-medium">
                      {result.currentDaysOverdue === "0"
                        ? "Current"
                        : `${result.currentDaysOverdue} days overdue`}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* After payment card */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <p className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  After Simulated Payment
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outstanding Balance</span>
                    <span className={amountChanged ? "font-semibold" : "font-medium"}>
                      UGX {formatUGX(result.allocation.principalBalanceAfter)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unpaid Interest</span>
                    <span className={interestChanged ? "font-semibold" : "font-medium"}>
                      UGX {formatUGX(result.afterUnpaidInterest)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Days Coverage</span>
                    <span className={daysChanged ? "font-semibold" : "font-medium"}>
                      {result.afterDaysOverdue === "0"
                        ? "Loan is current — no overdue days."
                        : `${result.afterDaysOverdue} days overdue`}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Edge case messages */}
          {result.allocation.loanFullyPaid && (
            <p className="text-sm text-green-700 font-medium">
              This amount would fully pay off the loan.
            </p>
          )}
          {!result.allocation.loanFullyPaid &&
            result.allocation.principalPortion === "0.00" && (
              <p className="text-sm text-yellow-700">
                This amount covers partial interest only. No principal is reduced.
              </p>
            )}
          {result.afterDaysOverdue === "0" &&
            result.currentDaysOverdue === "0" &&
            !result.allocation.loanFullyPaid && (
              <p className="text-sm text-muted-foreground">
                Loan is current — no overdue days.
              </p>
            )}
        </>
      )}
    </div>
  )
}
