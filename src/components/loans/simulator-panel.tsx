"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  calculateDaysOverdue,
  calculateDailyRate,
  calculateInterest,
  formatAmount,
} from "@/lib/interest";
import BigNumber from "bignumber.js";
import type { Loan, PaymentWithCustomer } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { allocateLoanPayment } from "@/lib/interest/engine";
import { endOfDay } from "date-fns";

interface SimulatorPanelProps {
  loan: Loan;
  payments: PaymentWithCustomer[];
  ledgerBalance: string | null;
  totalInterestPaid?: string;
}

interface SimulatorResult {
  allocation: Awaited<ReturnType<typeof allocateLoanPayment>>;
  currentDaysOverdue: string;
  afterDaysOverdue: string;
  currentOutstanding: string;
  currentUnpaidInterest: string;
  afterUnpaidInterest: string;
}

export function SimulatorPanel({
  loan,
  payments,
  ledgerBalance,
  totalInterestPaid: totalInterestPaidProp,
}: SimulatorPanelProps) {
  const { control, watch } = useForm<{ amount: string }>({
    defaultValues: { amount: "" },
  });
  const amount = watch("amount");
  const [result, setResult] = useState<SimulatorResult | null>(null);

  const effectiveRate = loan.interestRateOverride ?? loan.interestRate;
  const dailyRate = calculateDailyRate(effectiveRate);
  const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(
    dailyRate,
  );

  const currentOutstanding = ledgerBalance ?? loan.principalAmount;

  const now = new Date();
  const totalDaysElapsed = Math.floor(
    (now.getTime() - new Date(loan.startDate).getTime()) /
      (1000 * 60 * 60 * 24),
  );

  // Use actual days for accrual — min period only applies to payment allocation
  const totalInterestAccrued = calculateInterest(
    currentOutstanding,
    effectiveRate,
    totalDaysElapsed,
    0,
  );

  const totalInterestPaid = totalInterestPaidProp
    ? new BigNumber(totalInterestPaidProp)
    : new BigNumber(0);

  const currentDaysOverdueBN = calculateDaysOverdue(
    totalInterestAccrued,
    totalInterestPaid,
    dailyInterestAmount,
  );
  const currentUnpaidInterest = totalInterestAccrued.minus(totalInterestPaid);

  async function handleSimulate() {
    if (!amount || new BigNumber(amount).isLessThanOrEqualTo(0)) return;

    const allocation = await allocateLoanPayment({
      paymentAmount: amount,
      loanId: loan.id,
      asOf: endOfDay(now),
    });

    const afterInterestPaid = totalInterestPaid.plus(
      new BigNumber(allocation.interestPortion),
    );
    const afterDaysOverdueBN = calculateDaysOverdue(
      totalInterestAccrued,
      afterInterestPaid,
      dailyInterestAmount,
    );
    const afterUnpaidInterestBN = totalInterestAccrued.minus(afterInterestPaid);

    setResult({
      allocation,
      currentDaysOverdue: currentDaysOverdueBN.toFixed(0),
      afterDaysOverdue: afterDaysOverdueBN.toFixed(0),
      currentOutstanding,
      currentUnpaidInterest: formatAmount(
        currentUnpaidInterest.isLessThan(0)
          ? new BigNumber(0)
          : currentUnpaidInterest,
      ),
      afterUnpaidInterest: formatAmount(
        afterUnpaidInterestBN.isLessThan(0)
          ? new BigNumber(0)
          : afterUnpaidInterestBN,
      ),
    });
  }

  const amountChanged =
    result !== null &&
    result.allocation.principalBalanceAfter !== currentOutstanding;
  const interestChanged =
    result !== null &&
    result.afterUnpaidInterest !== result.currentUnpaidInterest;
  const daysChanged =
    result !== null && result.afterDaysOverdue !== result.currentDaysOverdue;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold inline-flex items-center gap-2">
        Repayment Simulator
        <InfoPopover>
          <p className="font-semibold text-sm mb-1">How the Simulator Works</p>
          <p className="text-xs text-muted-foreground mb-2">
            The simulator shows what would happen if you made a payment right
            now, without actually recording it.
          </p>
          <p className="text-xs font-semibold mb-1">Payment Allocation</p>
          <div className="text-xs text-muted-foreground mb-2 space-y-1">
            <p>
              1. Interest is calculated first: Interest = Principal Balance ×
              (Monthly Rate ÷ 30) × Days Since Last Payment
            </p>
            <p>
              2. The minimum interest period (30 days) applies — even if you pay
              early, interest for 30 days is charged
            </p>
            <p>
              3. Payment covers interest first, then remaining amount reduces
              principal
            </p>
          </div>
          <p className="text-xs font-semibold mb-1">Formula</p>
          <div className="space-y-1 mb-2">
            <p className="text-xs font-mono bg-muted rounded px-2 py-1">
              Interest Portion = min(Payment, Accrued Interest)
            </p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1">
              Principal Portion = Payment − Interest Portion
            </p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1">
              New Balance = Outstanding − Principal Portion
            </p>
          </div>
          <p className="text-xs font-semibold mb-1">Example</p>
          <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
            <p>
              Outstanding: UGX 1,000,000, Rate: 10%/month, 35 days since last
              payment
            </p>
            <p>Accrued interest = 1,000,000 × (0.10 ÷ 30) × 35 = UGX 116,667</p>
            <p className="font-semibold mt-1">Payment of UGX 200,000:</p>
            <p>Interest portion: UGX 116,667</p>
            <p>Principal portion: 200,000 − 116,667 = UGX 83,333</p>
            <p>
              New balance: 1,000,000 − 83,333 = <strong>UGX 916,667</strong>
            </p>
          </div>
        </InfoPopover>
      </h2>
      <p className="text-sm text-muted-foreground">
        Simulate a payment to see how it would affect this loan without
        recording it.
      </p>

      <div className="flex items-end gap-3 flex-wrap">
        <MoneyInput
          name="amount"
          control={control}
          label="Simulate payment of UGX"
          placeholder="0"
          id="simulatorAmount"
        />
        <Button
          onClick={handleSimulate}
          disabled={
            !amount || new BigNumber(amount || "0").isLessThanOrEqualTo(0)
          }
        >
          Simulate
        </Button>
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground">
          Enter an amount to simulate.
        </p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <p className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Current
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Principal Balance
                    </span>
                    <span className="font-medium">
                      {formatCurrency(result.currentOutstanding)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Unpaid Interest
                    </span>
                    <span className="font-medium">
                      {formatCurrency(result.currentUnpaidInterest)}
                    </span>
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

            <Card>
              <CardContent className="pt-4 space-y-3">
                <p className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  After Simulated Payment
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Principal Balance
                    </span>
                    <span
                      className={
                        amountChanged ? "font-semibold" : "font-medium"
                      }
                    >
                      {formatCurrency(result.allocation.principalBalanceAfter)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Unpaid Interest
                    </span>
                    <span
                      className={
                        interestChanged ? "font-semibold" : "font-medium"
                      }
                    >
                      {formatCurrency(result.afterUnpaidInterest)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Days Coverage</span>
                    <span
                      className={daysChanged ? "font-semibold" : "font-medium"}
                    >
                      {result.afterDaysOverdue === "0"
                        ? "Loan is current — no overdue days."
                        : `${result.afterDaysOverdue} days overdue`}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {result.allocation.loanFullyPaid && (
            <p className="text-sm text-green-700 font-medium">
              This amount would fully pay off the loan.
            </p>
          )}
          {!result.allocation.loanFullyPaid &&
            result.allocation.principalPortion === "0.00" && (
              <p className="text-sm text-yellow-700">
                This amount covers partial interest only. No principal is
                reduced.
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
  );
}
