import BigNumber from "bignumber.js";
import {
  calculateInterest,
  calculateDailyRate,
  calculateDaysOverdue,
  calculateSchedule,
  calculateDaysOverdueFromInterestAccrued,
} from "./engine";
import { isPenaltyActive, getEffectiveRate } from "./effective-rate";
import type { LoanType, ScheduleEntry } from "@/types";

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
  outstandingBalance: string;
  penaltyWaived: boolean;
  penaltyMultiplier?: string | null;
  loan: {
    id: string;
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
  };
  asOf: Date;
  lastPaymentDate: Date;
}): LoanOverdueInfo {
  const {
    principalAmount,
    baseRate,
    startDate,
    loanType,
    termMonths,
    totalInterestPaid,
    paymentCount,
    outstandingBalance,
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
      asOf,
    });
  } else {
    return computeFixedLoanOverdueInfo({
      principalAmount,

      baseRate,
      startDate,
      loanType,
      termMonths,
      totalInterestPaid,
      paymentCount,
      outstandingBalance,
      penaltyWaived,
      loan,
      asOf,
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
  startDate: Date;
  loanType: Exclude<LoanType, "perpetual">;
  termMonths: number | null;
  totalInterestPaid: string;
  paymentCount: number;
  outstandingBalance: string;
  penaltyWaived: boolean;
  penaltyMultiplier?: string | null;
  loan: {
    interestRate: string;
    interestRateOverride: string | null;
    penaltyMultiplier?: string | null;
  };
  asOf: Date;
}): LoanOverdueInfo {
  const now = params.asOf ?? new Date();
  const {
    principalAmount,
    baseRate,
    startDate,
    loanType,
    termMonths,
    totalInterestPaid,
    paymentCount,
    outstandingBalance,
    penaltyWaived,
    loan,
  } = params;

  // Term loans (fixed_rate, reducing_balance)
  // When start day exceeds days in current month (e.g., started 31st, now in Feb),
  // treat the last day of the current month as having completed the month.
  const lastDayOfCurrentMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dayReached =
    now.getDate() >= startDate.getDate() ||
    now.getDate() >= lastDayOfCurrentMonth;
  const monthsElapsed =
    (now.getFullYear() - startDate.getFullYear()) * 12 +
    (now.getMonth() - startDate.getMonth()) +
    (dayReached ? 0 : -1);
  const expectedPayments = Math.min(monthsElapsed, termMonths ?? 0);
  const actualPayments = paymentCount;
  const missedPayments = Math.max(expectedPayments - actualPayments, 0);
  const daysOverdue = missedPayments * 30;

  const monthlyInterest =
    loanType === "fixed_rate"
      ? new BigNumber(principalAmount).multipliedBy(new BigNumber(baseRate))
      : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(baseRate));
  const dailyRate = monthlyInterest.dividedBy(30).toFixed(0);

  const totalInterestPaidBN = new BigNumber(totalInterestPaid);
  const { entries } = calculateSchedule(
    principalAmount,
    baseRate,
    termMonths!,
    loanType as "fixed_rate" | "reducing_balance",
  );
  const expectedInterest = entries
    .slice(0, expectedPayments)
    .reduce(
      (s: BigNumber, e: ScheduleEntry) =>
        s.plus(new BigNumber(e.monthlyInterest)),
      new BigNumber(0),
    );
  const unpaidInterestBN = expectedInterest.minus(totalInterestPaidBN);

  const unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(0);

  const penaltyIsActive = isPenaltyActive(daysOverdue, penaltyWaived);
  const effectiveRate = getEffectiveRate(loan, penaltyIsActive);

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest,
    penaltyActive: penaltyIsActive,
    effectiveRate,
  };
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
  };
  asOf: Date;
}): LoanOverdueInfo {
  const {
    principalAmount,
    baseRate,
    lastPaymentDate,
    outstandingBalance,
    penaltyWaived,
    loan,
    asOf,
  } = params;
  const now = asOf ?? new Date();

  const elapsedDays = Math.floor(
    (now.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  // Always use base rate for overdue calculation — penalty must not inflate this
  // Use outstanding balance (not original principal) so that partial principal
  // repayments correctly reduce the interest accrual and overdue calculation.
  const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0)
    ? outstandingBalance
    : principalAmount;
  const interestAccrued = calculateInterest(
    currentBalance.toString(),
    baseRate,
    elapsedDays,
    0,
  );
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
  const unpaidInterest = BigNumber.max(interestAccrued, 0).toFixed(0);

  const penaltyIsActive = isPenaltyActive(daysOverdue, penaltyWaived);
  const effectiveRate = getEffectiveRate(loan, penaltyIsActive);

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest,
    penaltyActive: penaltyIsActive,
    effectiveRate,
  };
}

/**
 * Determine whether a loan's penalty waiver should be reset.
 * The waiver should only be reset when the borrower is fully current
 * (0 days overdue), not merely below the 60-day penalty threshold.
 */
export function shouldResetPenaltyWaiver(
  daysOverdue: number,
  penaltyWaived: boolean,
): boolean {
  return daysOverdue === 0 && penaltyWaived;
}
