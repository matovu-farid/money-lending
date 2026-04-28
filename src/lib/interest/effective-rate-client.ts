// src/lib/interest/effective-rate-client.ts
// Pure client-safe daily-rate computation. No DB access, no server imports.
//
// Mirrors `getBaseRate` + the daily-rate arithmetic from
// `src/lib/interest/overdue.ts → computeLoanOverdueInfo`:
//
//   Perpetual / reducing_balance:
//     dailyRate = outstandingBalance × (baseRate / 30)
//     (falls back to principalAmount when outstandingBalance is zero)
//
//   Fixed-rate:
//     dailyRate = principalAmount × baseRate / 30
//
// Returns the result as a toFixed(0) string (integer UGX), matching the
// server's `toFixed(0)` output for `dailyRate`.
//
// The `minInterestDays` column on the loans table is the minimum *interest
// period* (not the divisor). The divisor is always 30 — matching the server.

import BigNumber from "bignumber.js"
import type { LoanBaseRow } from "@/lib/schemas/collections"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Compute the daily interest amount (in base currency, as an integer string)
 * for a loan.
 *
 * @param loan              Raw loan row fields needed for the calculation.
 * @param outstandingBalance Current outstanding principal from loan_balances.
 *                           When omitted or zero, principalAmount is used as
 *                           fallback (matching the server's behaviour).
 *
 * Returns "0" when:
 * - the loan is not active
 * - the interest rate is zero
 */
export function computeDailyRate(
  loan: Pick<
    LoanBaseRow,
    | "status"
    | "loanType"
    | "principalAmount"
    | "interestRate"
    | "interestRateOverride"
    | "minInterestDays"
  >,
  outstandingBalance?: string,
): string {
  if (loan.status !== "active") return "0"

  // Mirror server getBaseRate: prefer interestRateOverride when set.
  const baseRate = loan.interestRateOverride ?? loan.interestRate ?? "0"

  const loanType = loan.loanType ?? "perpetual"

  let principalForRate: string

  if (loanType === "fixed_rate") {
    // Server: monthlyInterest = principalAmount × baseRate
    principalForRate = loan.principalAmount ?? "0"
  } else {
    // Server (perpetual + reducing_balance):
    //   use outstandingBalance; fall back to principalAmount when zero/absent.
    const bal = outstandingBalance ?? loan.principalAmount ?? "0"
    principalForRate =
      new BigNumber(bal).isGreaterThan(0) ? bal : (loan.principalAmount ?? "0")
  }

  // dailyRate = monthlyInterest / 30
  const monthlyInterest = new BigNumber(principalForRate).multipliedBy(baseRate)
  const dailyRate = monthlyInterest.dividedBy(30)

  return dailyRate.toFixed(0)
}
