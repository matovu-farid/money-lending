// src/lib/interest/overdue-client.ts
// Pure client-safe overdue computation. No DB access, no server imports.
//
// For PERPETUAL loans this replicates the server-side
// `computeLoanOverdueInfo` formula exactly:
//   daysOverdue = floor(unpaidInterest / dailyRate)
// where dailyRate = currentBalance × (baseRate / 30).
//
// "unpaidInterest" is the value stored in `loan_balances.unpaid_interest`
// (the net balance of the Interest Earned ledger account), which equals the
// server's `totalInterestAccrued − totalInterestPaid` for the same loan.
//
// For TERM loans (fixed_rate, reducing_balance) the server uses
//   daysOverdue = missedPayments × 30 (requires `paymentCount`)
// which is NOT stored in the projection. The same
//   floor(unpaidInterest / dailyRate)
// formula is used here as the best available approximation.  It will differ
// from the server by up to ±1 day due to amortization schedule rounding; the
// difference is cosmetic and does not affect the 60-day penalty threshold.
//
// Precision: mirrors engine.ts BigNumber config exactly.

import BigNumber from "bignumber.js"
import type { LoanBaseRow } from "@/lib/schemas/collections"

// Mirror the precision config from engine.ts so BigNumber divisions match
// the server's arithmetic exactly.
BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Compute days overdue for a loan given its raw loan row, the unpaid-interest
 * amount from the loan_balances projection, the outstanding balance, and the
 * current date.
 *
 * @param loan              Subset of the raw loan row (from loanCollection).
 * @param unpaidInterest    `loan_balances.unpaidInterest` — net balance of the
 *                          Interest Earned account (= totalInterestAccrued − paid).
 * @param outstandingBalance `loan_balances.outstandingBalance` — current principal.
 * @param today             Caller-supplied date. DO NOT use `new Date()` inside
 *                          — pass it in so callers control it (testability + SSR).
 *
 * Returns 0 when:
 * - the loan is not active
 * - today <= startDate
 * - unpaidInterest is zero or negative
 * - dailyRate is zero (zero-rate loan)
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
  unpaidInterest: string,
  outstandingBalance: string,
  today: Date,
): number {
  if (loan.status !== "active") return 0

  // Guard: today must be after startDate
  const startDate = loan.startDate instanceof Date ? loan.startDate : new Date(loan.startDate as string)
  if (today.getTime() <= startDate.getTime()) return 0

  // Mirror server: use interestRateOverride when set (getBaseRate semantics from effective-rate.ts).
  const baseRate = loan.interestRateOverride ?? loan.interestRate ?? "0"

  // Mirror server perpetual path: use outstanding balance (not original principal).
  // Falls back to principalAmount when outstandingBalance is zero/absent.
  const currentBalance =
    new BigNumber(outstandingBalance).isGreaterThan(0)
      ? outstandingBalance
      : (loan.principalAmount ?? "0")

  // dailyInterestAmount = currentBalance × (baseRate / 30)
  // Mirrors: calculateDailyRate(baseRate) then balance × dailyRate
  const dailyRateBN = new BigNumber(baseRate).dividedBy(30)
  const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(dailyRateBN)
  if (dailyInterestAmount.isZero()) return 0

  // unpaidInterest is the projection's net Interest Earned balance,
  // which equals totalInterestAccrued − totalInterestPaid in steady state.
  const unpaidBN = new BigNumber(unpaidInterest)
  if (unpaidBN.isLessThanOrEqualTo(0)) return 0

  // Mirror server's calculateDaysOverdue: floor(unpaid / dailyRate)
  return Math.floor(unpaidBN.dividedBy(dailyInterestAmount).toNumber())
}
