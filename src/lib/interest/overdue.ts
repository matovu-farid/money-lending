import BigNumber from "bignumber.js"
import { calculateInterest, calculateDailyRate, calculateDaysOverdue, calculateSchedule } from "./engine"
import { isPenaltyActive, getEffectiveRate } from "./effective-rate"
import type { LoanType, ScheduleEntry } from "@/types"

export interface LoanOverdueInfo {
  daysOverdue: number
  dailyRate: string
  unpaidInterest: string
  penaltyActive: boolean
  effectiveRate: string
}

/**
 * Compute overdue info for a single loan given its terms and payment history.
 * Single source of truth — used by dashboard, loans page, and daily collections.
 *
 * IMPORTANT: Overdue days are computed using the BASE rate (no penalty).
 * Penalty status is derived from the resulting daysOverdue.
 * The returned effectiveRate includes the penalty bump if active.
 */
export function computeLoanOverdueInfo(params: {
  principalAmount: string
  baseRate: string
  startDate: Date
  loanType: LoanType
  termMonths: number | null
  totalInterestPaid: string
  paymentCount: number
  outstandingBalance: string
  penaltyWaived: boolean
  penaltyMultiplier?: string | null
  loan: { interestRate: string; interestRateOverride: string | null; penaltyMultiplier?: string | null }
  asOf?: Date
}): LoanOverdueInfo {
  const now = params.asOf ?? new Date()
  const { principalAmount, baseRate, startDate, loanType, termMonths, totalInterestPaid, paymentCount, outstandingBalance, penaltyWaived, loan } = params

  let daysOverdue: number
  let dailyRate: string
  let unpaidInterest: string

  if (loanType === "perpetual" || !loanType) {
    const totalDaysElapsed = Math.floor(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    // Always use base rate for overdue calculation — penalty must not inflate this
    const totalInterestAccrued = calculateInterest(principalAmount, baseRate, totalDaysElapsed, 0)
    const dailyRateBN = calculateDailyRate(baseRate)
    const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0) ? outstandingBalance : principalAmount
    const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(dailyRateBN)
    const totalInterestPaidBN = new BigNumber(totalInterestPaid)
    const unpaidInterestBN = totalInterestAccrued.minus(totalInterestPaidBN)
    const daysOverdueBN = calculateDaysOverdue(totalInterestAccrued, totalInterestPaidBN, dailyInterestAmount)

    daysOverdue = Math.floor(daysOverdueBN.toNumber())
    dailyRate = dailyInterestAmount.toFixed(2)
    unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)
  } else {
    // Term loans (fixed_rate, reducing_balance)
    const monthsElapsed = (now.getFullYear() - startDate.getFullYear()) * 12
      + (now.getMonth() - startDate.getMonth())
      + (now.getDate() >= startDate.getDate() ? 0 : -1)
    const expectedPayments = Math.min(monthsElapsed, termMonths ?? 0)
    const actualPayments = paymentCount
    const missedPayments = Math.max(expectedPayments - actualPayments, 0)
    daysOverdue = missedPayments * 30

    const monthlyInterest = loanType === "fixed_rate"
      ? new BigNumber(principalAmount).multipliedBy(new BigNumber(baseRate))
      : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(baseRate))
    dailyRate = monthlyInterest.dividedBy(30).toFixed(2)

    const totalInterestPaidBN = new BigNumber(totalInterestPaid)
    const schedule = calculateSchedule(
      principalAmount,
      baseRate,
      termMonths!,
      loanType as "fixed_rate" | "reducing_balance"
    )
    const expectedInterest = schedule
      .slice(0, expectedPayments)
      .reduce((s: BigNumber, e: ScheduleEntry) => s.plus(new BigNumber(e.monthlyInterest)), new BigNumber(0))
    const unpaidInterestBN = expectedInterest.minus(totalInterestPaidBN)

    unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)
  }

  const penaltyIsActive = isPenaltyActive(daysOverdue, penaltyWaived)
  const effectiveRate = getEffectiveRate(loan, penaltyIsActive)

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest,
    penaltyActive: penaltyIsActive,
    effectiveRate,
  }
}
