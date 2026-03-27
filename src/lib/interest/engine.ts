import BigNumber from "bignumber.js"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Calculates the daily rate from a monthly rate decimal.
 * daily_rate = monthly_rate / 30
 */
export function calculateDailyRate(monthlyRateDecimal: string): BigNumber {
  return new BigNumber(monthlyRateDecimal).dividedBy(30)
}

/**
 * Calculates interest using the reducing-balance formula with minimum period enforcement.
 * Formula: interest = outstanding_balance × daily_rate × effective_days
 * Effective days = max(daysElapsed, minInterestDays)
 */
export function calculateInterest(
  outstandingBalance: string,
  monthlyRateDecimal: string,
  daysElapsed: number,
  minInterestDays: number = 30
): BigNumber {
  const balance = new BigNumber(outstandingBalance)
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  const effectiveDays = new BigNumber(Math.max(daysElapsed, minInterestDays))
  return balance.multipliedBy(dailyRate).multipliedBy(effectiveDays)
}

/**
 * Calculates the loan summary for the Review step of the loan issuance wizard.
 * Returns daily interest, total interest at minimum period, and total owed.
 * NOTE: Loans are perpetual — this function does NOT reference termDays or dueDate.
 */
export function calculateLoanSummary(
  principalAmount: string,
  monthlyRateDecimal: string,
  minInterestDays: number = 30
): {
  dailyInterest: string
  totalInterestAtMinPeriod: string
  totalOwedAtMinPeriod: string
  minInterestDays: number
} {
  const principal = new BigNumber(principalAmount)
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  const dailyInterest = principal.multipliedBy(dailyRate)
  const totalInterestAtMinPeriod = dailyInterest.multipliedBy(minInterestDays)
  const totalOwedAtMinPeriod = principal.plus(totalInterestAtMinPeriod)

  return {
    dailyInterest: formatAmount(dailyInterest),
    totalInterestAtMinPeriod: formatAmount(totalInterestAtMinPeriod),
    totalOwedAtMinPeriod: formatAmount(totalOwedAtMinPeriod),
    minInterestDays,
  }
}

/**
 * Calculates days overdue from unpaid interest and the current daily rate.
 * Formula: (totalInterestAccrued - totalInterestPaid) / currentDailyRate
 * Returns BigNumber(0) if unpaid interest is <= 0.
 * Used for the watchlist (RISK-01, RISK-02).
 */
export function calculateDaysOverdue(
  totalInterestAccrued: string,
  totalInterestPaid: string,
  currentDailyRate: string
): BigNumber {
  const unpaidInterest = new BigNumber(totalInterestAccrued).minus(
    new BigNumber(totalInterestPaid)
  )

  if (unpaidInterest.isLessThanOrEqualTo(0)) {
    return new BigNumber(0)
  }

  const rate = new BigNumber(currentDailyRate)
  if (rate.isZero()) {
    return new BigNumber(0)
  }

  return unpaidInterest.dividedBy(rate)
}

/**
 * Formats a BigNumber amount to 2 decimal places for display and storage.
 */
export function formatAmount(amount: BigNumber): string {
  return amount.toFixed(2)
}

/**
 * Allocation result from a single payment.
 * All monetary fields are NUMERIC(15,2) strings.
 */
export type PaymentAllocation = {
  interestPortion: string
  principalPortion: string
  principalBalanceBefore: string
  principalBalanceAfter: string
  loanFullyPaid: boolean
}

/**
 * Allocates a payment interest-first, then applies remainder to principal.
 * Pure function — no DB calls, no side effects.
 *
 * If payment <= interest owed: all goes to interest, principal unchanged.
 * If payment > interest owed: excess reduces principal.
 * If principal balance reaches zero: loanFullyPaid = true.
 *
 * LOAN-08: Interest-first allocation.
 * LOAN-09: Any amount accepted — no minimum.
 * LOAN-10: Minimum period enforced via calculateInterest (minInterestDays).
 */
export function allocatePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  monthlyRateDecimal: string
  daysElapsed: number
  minInterestDays: number
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays } = params
  const payment = new BigNumber(paymentAmount)
  const interestOwed = calculateInterest(principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays)

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      loanFullyPaid: false,
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = BigNumber.max(
    new BigNumber(principalBalanceBefore).minus(principalPortion),
    0
  )

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
