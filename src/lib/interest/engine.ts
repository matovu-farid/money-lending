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

  return unpaidInterest.dividedBy(new BigNumber(currentDailyRate))
}

/**
 * Formats a BigNumber amount to 2 decimal places for display and storage.
 */
export function formatAmount(amount: BigNumber): string {
  return amount.toFixed(2)
}
