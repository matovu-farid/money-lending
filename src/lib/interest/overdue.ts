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
      asOf,
    });
  } else {
    return computeFixedLoanOverdueInfo({
      principalAmount,

      baseRate,

      loanType,
      totalInterestPaid,
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
  asOf?: Date;
}) {
  const {
    principalAmount,
    baseRate,

    loanType,

    totalInterestPaid,
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
  } = params;
  const now = asOf ?? new Date();

  const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0)
    ? outstandingBalance
    : principalAmount;

  const dailyRateBN = calculateDailyRate(baseRate);
  const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(
    dailyRateBN,
  );

  const daysOverdueBN = calculateDaysOverdueFromInterestAccrued(
    interestAccrued,
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
    interestAccrued,
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
