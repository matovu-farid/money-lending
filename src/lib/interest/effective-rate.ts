import BigNumber from "bignumber.js"

const PENALTY_THRESHOLD_DAYS = 60
const DEFAULT_PENALTY_MULTIPLIER = "0.1000" // 10% increase

/**
 * Returns the base rate (before penalty), respecting admin override.
 * Used for overdue calculation — penalty must NOT inflate the overdue computation.
 */
export function getBaseRate(loan: {
  interestRate: string
  interestRateOverride: string | null
}): string {
  return loan.interestRateOverride ?? loan.interestRate
}

/**
 * Derives whether penalty is active from overdue days and waiver status.
 * Pure function — no DB dependency, no cron dependency.
 *
 * Penalty kicks in at 60+ days overdue, unless an admin has waived it.
 * The waiver is reset when the borrower returns to good standing (< 60 days),
 * so future overdue episodes will be penalized again.
 */
export function isPenaltyActive(daysOverdue: number, penaltyWaived: boolean): boolean {
  return daysOverdue >= PENALTY_THRESHOLD_DAYS && !penaltyWaived
}

/**
 * Computes the effective interest rate, applying penalty bump if active.
 *
 * Callers must first compute daysOverdue (using the BASE rate, not the
 * penalized rate) and pass the derived penalty status here.
 *
 * Formula: effectiveRate = baseRate × (1 + penaltyMultiplier)
 */
export function getEffectiveRate(loan: {
  interestRate: string
  interestRateOverride: string | null
  penaltyMultiplier?: string | null
}, penaltyActive: boolean): string {
  const baseRate = getBaseRate(loan)
  if (!penaltyActive) return baseRate
  const multiplier = loan.penaltyMultiplier ?? DEFAULT_PENALTY_MULTIPLIER
  const bump = new BigNumber(baseRate).multipliedBy(multiplier)
  return new BigNumber(baseRate).plus(bump).toFixed(4)
}

export { PENALTY_THRESHOLD_DAYS }
