import BigNumber from "bignumber.js";
import {
  calculateInterest,
  calculateDailyRate,
  calculateDaysOverdueFromInterestAccrued,
} from "./engine";
import { isPenaltyActive, getEffectiveRate } from "./effective-rate";
import type { LoanType } from "@/types";

export interface LoanOverdueInfo {
  daysOverdue: number;
  dailyRate: string;
  unpaidInterest: string;
  penaltyActive: boolean;
  effectiveRate: string;
}

export function computeLoanOverdueInfo(params: {
  principalAmount: string;
  baseRate: string;
  startDate: Date;
  loanType: LoanType;
  termMonths: number | null;
  totalInterestPaid: string;
  totalInterestAccrued?: string | BigNumber;
  paymentCount: number;
  totalBalanceOwed: string;
  penaltyWaived: boolean;
  penaltyMultiplier?: string | null;
  loan: {
    id: string;
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
    startDate: Date;
  };
  asOf: Date;
  lastPaymentDate: Date;
}) {
  const {
    principalAmount,
    baseRate,
    loanType,
    totalInterestPaid,
    totalInterestAccrued,
    totalBalanceOwed: outstandingBalance,
    penaltyWaived,
    loan,
    lastPaymentDate,
    asOf,
  } = params;
  if (loanType === "perpetual") {
    return computePerpetualOverdueInfo({
      principalAmount,
      baseRate,
      lastPaymentDate,
      outstandingBalance,
      penaltyWaived,
      loan,
      totalInterestPaid,
      totalInterestAccrued,
      asOf,
    });
  } else {
    return computeFixedLoanOverdueInfo({
      principalAmount,

      baseRate,

      loanType,
      totalInterestPaid,
      totalInterestAccrued,
      outstandingBalance,
      penaltyWaived,
      loan,
      asOf,
      lastPaymentDate,
    });
  }
}

/**
 * Compute overdue info for a single loan given its terms and payment history.
 * Single source of truth — used by dashboard, loans page, and daily collections.
 *
 * IMPORTANT: Overdue days are computed using the BASE rate (no penalty).
 * Penalty status is derived from the resulting daysOverdue.
 * The returned effectiveRate includes the penalty bump if active.
 */

export function computeFixedLoanOverdueInfo(params: {
  principalAmount: string;
  baseRate: string;
  loanType: Exclude<LoanType, "perpetual">;
  totalInterestPaid: string;
  outstandingBalance: string;
  penaltyWaived: boolean;
  loan: {
    id: string;
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
    startDate: Date;
  };
  lastPaymentDate: Date;
  totalInterestAccrued?: string | BigNumber;
  asOf?: Date;
}) {
  const {
    principalAmount,
    baseRate,

    loanType,

    totalInterestPaid,
    totalInterestAccrued,
    outstandingBalance,
    penaltyWaived,
    loan,
    lastPaymentDate,
    asOf,
  } = params;
  const now = asOf ?? new Date();

  const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0)
    ? outstandingBalance
    : principalAmount;

  const elapsedDays = Math.floor(
    (now.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const interestAccrued =
    loanType === "fixed_rate"
      ? calculateInterest(principalAmount.toString(), baseRate, elapsedDays, 0)
      : calculateInterest(currentBalance.toString(), baseRate, elapsedDays, 0);

  return computeOverdueInfoFromInterestAccrued({
    principalAmount,
    baseRate,
    totalInterestPaid,
    outstandingBalance,
    penaltyWaived,
    loan,
    asOf: now,
    interestAccrued,
    totalInterestAccrued,
  });
}

export function computePerpetualOverdueInfo(params: {
  principalAmount: string;
  baseRate: string;
  lastPaymentDate: Date;

  outstandingBalance: string;
  penaltyWaived: boolean;
  loan: {
    id: string;
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
    startDate: Date;
  };
  totalInterestPaid: string;
  totalInterestAccrued?: string | BigNumber;
  asOf: Date;
}) {
  const {
    principalAmount,
    baseRate,
    lastPaymentDate,
    outstandingBalance,
    penaltyWaived,
    loan,
    totalInterestPaid,
    totalInterestAccrued,
    asOf,
  } = params;
  const now = asOf ?? new Date();

  const elapsedDays = Math.floor(
    (now.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0)
    ? outstandingBalance
    : principalAmount;
  const interestAccrued = calculateInterest(
    currentBalance.toString(),
    baseRate,
    elapsedDays,
    0,
  );
  return computeOverdueInfoFromInterestAccrued({
    principalAmount,
    baseRate,
    outstandingBalance,
    penaltyWaived,
    loan,
    totalInterestPaid,
    asOf,
    interestAccrued,
    totalInterestAccrued,
  });
}

export function computeOverdueInfoFromInterestAccrued(params: {
  principalAmount: string;
  interestAccrued: BigNumber;
  baseRate: string;

  outstandingBalance: string;
  penaltyWaived: boolean;
  loan: {
    id: string;
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
    startDate: Date;
  };
  totalInterestPaid: string;
  totalInterestAccrued?: string | BigNumber;
  asOf: Date;
}) {
  const {
    principalAmount,
    baseRate,

    outstandingBalance,
    penaltyWaived,
    loan,
    totalInterestPaid,
    asOf,
    interestAccrued,
    totalInterestAccrued,
  } = params;
  const now = asOf ?? new Date();

  const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0)
    ? outstandingBalance
    : principalAmount;

  const dailyRateBN = calculateDailyRate(baseRate);
  const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(
    dailyRateBN,
  );

  const accruedInterest = totalInterestAccrued ?? interestAccrued;
  const unpaidAccruedInterest = totalInterestAccrued
    ? BigNumber.max(
        new BigNumber(accruedInterest).minus(new BigNumber(totalInterestPaid)),
        0,
      )
    : accruedInterest;
  const daysOverdueBN = calculateDaysOverdueFromInterestAccrued(
    unpaidAccruedInterest,
    dailyInterestAmount,
  );

  const daysOverdue = Math.floor(daysOverdueBN.toNumber());
  const dailyRate = dailyInterestAmount.toFixed(0);
  const penaltyIsActive = isPenaltyActive(daysOverdue, penaltyWaived);
  const effectiveRate = getEffectiveRate(loan, penaltyIsActive);
  const minimumDefaultInterest = BigNumber(principalAmount).multipliedBy(
    BigNumber(effectiveRate),
  );

  const remainingMinimumDefaultInterest = BigNumber.max(
    0,
    minimumDefaultInterest.minus(BigNumber(totalInterestPaid)),
  );
  const unpaidInterest = BigNumber.max(
    unpaidAccruedInterest,
    0,
    remainingMinimumDefaultInterest,
  ).toFixed(0);

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest,
    penaltyActive: penaltyIsActive,
    effectiveRate,
  };
}
