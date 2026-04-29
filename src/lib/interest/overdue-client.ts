// src/lib/interest/overdue-client.ts
// Pure client-safe overdue computation. No DB access, no server imports.
//
// Implements the formula documented in the loans-page InfoPopover:
//
//   Total Interest Accrued = currentBalance × (rate / 30) × daysSinceStart
//   Days Overdue           = (Total Interest Accrued − Total Interest Paid) ÷ Daily Interest Amount
//
// where Daily Interest Amount = currentBalance × (rate / 30).
//
// Total Interest Paid is sourced from the `loan_balances` projection, which
// stores the net Interest Earned ledger balance for each loan. That value
// approximates cumulative cash interest paid (it is exact at steady state —
// after each payment the accrual cron's reversal entries cancel out).
//
// Precision: mirrors engine.ts BigNumber config exactly.

import BigNumber from "bignumber.js"
import type { LoanBaseRow } from "@/lib/schemas/collections"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Compute days overdue for a loan given its raw loan row, the cumulative
 * interest paid, the outstanding balance, and the current date.
 *
 * @param loan               Subset of the raw loan row (from loanCollection).
 * @param totalInterestPaid  `loan_balances.unpaidInterest` from the projection
 *                           — net Interest Earned ledger balance (proxies
 *                           cumulative cash interest paid).
 * @param outstandingBalance `loan_balances.outstandingBalance` — current principal.
 * @param today              Caller-supplied date — pass it in for testability.
 *
 * Returns 0 when:
 * - the loan is not active
 * - today <= startDate
 * - dailyInterestAmount is zero (zero-rate loan)
 * - paid >= accrued (no unpaid interest)
 */
export function computeDaysOverdue(
  loan: Pick<
    LoanBaseRow,
    | "status"
    | "loanType"
    | "principalAmount"
    | "interestRate"
    | "interestRateOverride"
    | "minInterestDays"
    | "startDate"
  >,
  totalInterestPaid: string,
  outstandingBalance: string,
  today: Date,
): number {
  if (loan.status !== "active") return 0

  const startDate = loan.startDate instanceof Date ? loan.startDate : new Date(loan.startDate as string)
  if (today.getTime() <= startDate.getTime()) return 0

  // Mirror server: use interestRateOverride when set (getBaseRate semantics).
  const baseRate = loan.interestRateOverride ?? loan.interestRate ?? "0"

  // Mirror server perpetual path: use outstanding balance (falls back to
  // principalAmount when the projection has not yet recorded a balance).
  const currentBalance =
    new BigNumber(outstandingBalance).isGreaterThan(0)
      ? outstandingBalance
      : (loan.principalAmount ?? "0")

  const dailyRateBN = new BigNumber(baseRate).dividedBy(30)
  const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(dailyRateBN)
  if (dailyInterestAmount.isZero()) return 0

  const daysSinceStart = Math.floor(
    (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  const totalAccrued = dailyInterestAmount.multipliedBy(daysSinceStart)
  const paid = new BigNumber(totalInterestPaid)
  const unpaid = BigNumber.max(totalAccrued.minus(paid), 0)
  if (unpaid.isZero()) return 0

  return Math.floor(unpaid.dividedBy(dailyInterestAmount).toNumber())
}

/**
 * Compute the unpaid-interest amount (`accruedToDate − paid`, clamped at 0)
 * for display in the legacy `LoanListEntry.unpaidInterest` field.
 *
 * Uses the same formula as `computeDaysOverdue` so the Total Due column,
 * the OverdueBadge, and the exported Excel columns all agree.
 */
export function computeUnpaidInterest(
  loan: Pick<
    LoanBaseRow,
    | "status"
    | "loanType"
    | "principalAmount"
    | "interestRate"
    | "interestRateOverride"
    | "minInterestDays"
    | "startDate"
  >,
  totalInterestPaid: string,
  outstandingBalance: string,
  today: Date,
): string {
  if (loan.status !== "active") return "0"

  const startDate = loan.startDate instanceof Date ? loan.startDate : new Date(loan.startDate as string)
  if (today.getTime() <= startDate.getTime()) return "0"

  const baseRate = loan.interestRateOverride ?? loan.interestRate ?? "0"
  const currentBalance =
    new BigNumber(outstandingBalance).isGreaterThan(0)
      ? outstandingBalance
      : (loan.principalAmount ?? "0")

  const dailyRateBN = new BigNumber(baseRate).dividedBy(30)
  const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(dailyRateBN)
  if (dailyInterestAmount.isZero()) return "0"

  const daysSinceStart = Math.floor(
    (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  const totalAccrued = dailyInterestAmount.multipliedBy(daysSinceStart)
  const unpaid = BigNumber.max(totalAccrued.minus(new BigNumber(totalInterestPaid)), 0)
  return unpaid.toFixed(0)
}
