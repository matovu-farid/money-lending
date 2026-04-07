import BigNumber from "bignumber.js"
import { calculateInterest, calculateDailyRate, calculateDaysOverdue, calculateSchedule } from "./engine"
import type { LoanType, ScheduleEntry } from "@/types"

export interface LoanOverdueInfo {
  daysOverdue: number
  dailyRate: string
  unpaidInterest: string
}

/**
 * Compute overdue info for a single loan given its terms and payment history.
 * Single source of truth — used by dashboard, loans page, and daily collections.
 */
export function computeLoanOverdueInfo(params: {
  principalAmount: string
  effectiveRate: string
  startDate: Date
  loanType: LoanType
  termMonths: number | null
  totalInterestPaid: string
  paymentCount: number
  outstandingBalance: string
  asOf?: Date
}): LoanOverdueInfo {
  const now = params.asOf ?? new Date()
  const { principalAmount, effectiveRate, startDate, loanType, termMonths, totalInterestPaid, paymentCount, outstandingBalance } = params

  if (loanType === "perpetual" || !loanType) {
    const totalDaysElapsed = Math.floor(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    const totalInterestAccrued = calculateInterest(principalAmount, effectiveRate, totalDaysElapsed, 0)
    const dailyRateBN = calculateDailyRate(effectiveRate)
    const currentBalance = new BigNumber(outstandingBalance).isGreaterThan(0) ? outstandingBalance : principalAmount
    const dailyInterestAmount = new BigNumber(currentBalance).multipliedBy(dailyRateBN)
    const totalInterestPaidBN = new BigNumber(totalInterestPaid)
    const unpaidInterestBN = totalInterestAccrued.minus(totalInterestPaidBN)
    const daysOverdueBN = calculateDaysOverdue(totalInterestAccrued, totalInterestPaidBN, dailyInterestAmount)

    return {
      daysOverdue: Math.floor(daysOverdueBN.toNumber()),
      dailyRate: dailyInterestAmount.toFixed(2),
      unpaidInterest: BigNumber.max(unpaidInterestBN, 0).toFixed(2),
    }
  }

  // Term loans (fixed_rate, reducing_balance)
  const monthsElapsed = (now.getFullYear() - startDate.getFullYear()) * 12
    + (now.getMonth() - startDate.getMonth())
    + (now.getDate() >= startDate.getDate() ? 0 : -1)
  const expectedPayments = Math.min(monthsElapsed, termMonths ?? 0)
  const actualPayments = paymentCount
  const missedPayments = Math.max(expectedPayments - actualPayments, 0)
  const daysOverdue = missedPayments * 30

  const monthlyInterest = loanType === "fixed_rate"
    ? new BigNumber(principalAmount).multipliedBy(new BigNumber(effectiveRate))
    : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(effectiveRate))
  const dailyRate = monthlyInterest.dividedBy(30).toFixed(2)

  const totalInterestPaidBN = new BigNumber(totalInterestPaid)
  const schedule = calculateSchedule(
    principalAmount,
    effectiveRate,
    termMonths!,
    loanType as "fixed_rate" | "reducing_balance"
  )
  const expectedInterest = schedule
    .slice(0, expectedPayments)
    .reduce((s: BigNumber, e: ScheduleEntry) => s.plus(new BigNumber(e.monthlyInterest)), new BigNumber(0))
  const unpaidInterestBN = expectedInterest.minus(totalInterestPaidBN)

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest: BigNumber.max(unpaidInterestBN, 0).toFixed(2),
  }
}
