import BigNumber from "bignumber.js"
import type { LoanType, ScheduleEntry } from "@/types"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Calculates the daily rate from a monthly rate decimal.
 * daily_rate = monthly_rate / 30
 */
export function calculateDailyRate(monthlyRateDecimal: string): BigNumber {
  return new BigNumber(monthlyRateDecimal).dividedBy(30)
}

/**
 * Calculates interest using the reducing-balance formula with optional minimum
 * period enforcement.
 * Formula: interest = outstanding_balance × daily_rate × effective_days
 * Effective days = max(daysElapsed, minInterestDays)
 *
 * Default `minInterestDays = 0` gives pure pro-rata interest. Pass an explicit
 * non-zero value at the rollover and collateral-settlement call sites where
 * the business rule mandates a minimum interest period.
 */
export function calculateInterest(
  outstandingBalance: string,
  monthlyRateDecimal: string,
  daysElapsed: number,
  minInterestDays: number = 0
): BigNumber {
  const balance = new BigNumber(outstandingBalance)
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  const effectiveDays = new BigNumber(Math.max(daysElapsed, minInterestDays))
  return balance.multipliedBy(dailyRate).multipliedBy(effectiveDays)
}

/**
 * Calculates the loan summary for the Review step of the loan issuance wizard.
 * Returns daily interest, total interest at minimum period, and total owed.
 *
 * For perpetual loans (default): returns daily interest, total at min period.
 * For fixed_rate/reducing_balance: returns schedule, totalInterest, totalOwed, monthlyInstallment.
 */
export function calculateLoanSummary(
  principalAmount: string,
  monthlyRateDecimal: string,
  minInterestDays?: number,
  loanType?: LoanType,
  termMonths?: number
): {
  dailyInterest: string
  totalInterestAtMinPeriod: string
  totalOwedAtMinPeriod: string
  minInterestDays: number
  schedule?: ScheduleEntry[]
  totalInterest?: string
  totalOwed?: string
  monthlyInstallment?: string
} {
  const effectiveMinDays = minInterestDays ?? 30
  const principal = new BigNumber(principalAmount)
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  const dailyInterest = principal.multipliedBy(dailyRate)
  const totalInterestAtMinPeriod = dailyInterest.multipliedBy(effectiveMinDays)
  const totalOwedAtMinPeriod = principal.plus(totalInterestAtMinPeriod)

  const base = {
    dailyInterest: formatAmount(dailyInterest),
    totalInterestAtMinPeriod: formatAmount(totalInterestAtMinPeriod),
    totalOwedAtMinPeriod: formatAmount(totalOwedAtMinPeriod),
    minInterestDays: effectiveMinDays,
  }

  if ((loanType === "fixed_rate" || loanType === "reducing_balance") && termMonths) {
    const { entries, totalInterest } = calculateSchedule(principalAmount, monthlyRateDecimal, termMonths, loanType)
    const totalOwed = principal.plus(totalInterest)

    return {
      ...base,
      schedule: entries,
      totalInterest: formatAmount(totalInterest),
      totalOwed: formatAmount(totalOwed),
      monthlyInstallment: entries[0].monthlyInstallment,
    }
  }

  return base
}

/**
 * Calculates days overdue from unpaid interest and the current daily rate.
 * Formula: (totalInterestAccrued - totalInterestPaid) / currentDailyRate
 * Returns BigNumber(0) if unpaid interest is <= 0.
 * Used for the watchlist (RISK-01, RISK-02).
 */
export function calculateDaysOverdue(
  totalInterestAccrued: string | BigNumber,
  totalInterestPaid: string | BigNumber,
  currentDailyRate: string | BigNumber
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
 * Computes total accrued interest by walking payment history segment by segment.
 * Each segment uses the actual outstanding balance during that period.
 * This avoids BUG-11 where using only the current balance for the entire period
 * under-accrues when the balance was higher earlier.
 *
 * Pure function — no DB calls.
 */
export function computeSegmentedInterest(params: {
  principalAmount: string
  monthlyRateDecimal: string
  startDate: Date
  asOfDate: Date
  /** Principal-reducing payments in chronological order */
  principalPayments: { date: Date; principalPortion: string }[]
}): BigNumber {
  const { principalAmount, monthlyRateDecimal, startDate, asOfDate, principalPayments } = params
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  let balance = new BigNumber(principalAmount)
  let totalInterest = new BigNumber(0)
  let segmentStart = startDate

  // Walk each payment that reduced principal
  for (const payment of principalPayments) {
    if (payment.date > asOfDate) break
    const days = Math.floor((payment.date.getTime() - segmentStart.getTime()) / (1000 * 60 * 60 * 24))
    if (days > 0) {
      totalInterest = totalInterest.plus(balance.multipliedBy(dailyRate).multipliedBy(days))
    }
    balance = BigNumber.max(balance.minus(new BigNumber(payment.principalPortion)), 0)
    segmentStart = payment.date
  }

  // Final segment: from last payment (or start) to asOfDate
  const remainingDays = Math.floor((asOfDate.getTime() - segmentStart.getTime()) / (1000 * 60 * 60 * 24))
  if (remainingDays > 0) {
    totalInterest = totalInterest.plus(balance.multipliedBy(dailyRate).multipliedBy(remainingDays))
  }

  return totalInterest
}

/**
 * Formats a BigNumber amount to 2 decimal places for display and storage.
 *
 * Uses banker's rounding (ROUND_HALF_EVEN) to avoid directional drift when
 * amounts are accumulated across many operations — e.g. cumulative principal
 * paid across a stream of payments. The global BigNumber config uses
 * ROUND_HALF_UP for general arithmetic; we override here for monetary output
 * because half-up biases upward and breaks conservation-of-money invariants
 * over long sequences of payments. Banker's rounding is the standard for
 * financial display.
 */
export function formatAmount(amount: BigNumber): string {
  return amount.toFixed(2, BigNumber.ROUND_HALF_EVEN)
}

/** Compute outstanding balance = principal + one period of interest */
function computeOutstanding(principalAfter: string | BigNumber, monthlyRateDecimal: string): string {
  const p = new BigNumber(principalAfter)
  return formatAmount(p.plus(p.multipliedBy(monthlyRateDecimal)))
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
  /** Principal balance + one period of interest (total owed at next payment) */
  outstandingBalanceAfter: string
  loanFullyPaid: boolean
}

/**
 * Generates an amortization schedule for fixed_rate or reducing_balance loans.
 *
 * Fixed rate: interest = originalPrincipal x monthlyRate each month (constant).
 * Reducing balance: interest = currentBalance x monthlyRate (decreasing).
 * Monthly principal = principal / termMonths (last month absorbs rounding remainder).
 */
/**
 * Result from calculateSchedule: the per-month rows plus a full-precision total.
 */
export interface ScheduleResult {
  entries: ScheduleEntry[]
  totalInterest: BigNumber
}

/**
 * Generates an amortization schedule for fixed_rate or reducing_balance loans.
 *
 * All arithmetic stays at full BigNumber precision throughout the loop.
 * Values are only rounded to 2dp at the very end for display strings.
 *
 * Fixed rate: interest = originalPrincipal x monthlyRate each month (constant).
 * Reducing balance: interest = currentBalance x monthlyRate (decreasing).
 * Monthly principal = principal / termMonths (last month absorbs rounding remainder).
 */
export function calculateSchedule(
  principalAmount: string,
  monthlyRateDecimal: string,
  termMonths: number,
  loanType: "fixed_rate" | "reducing_balance"
): ScheduleResult {
  const principal = new BigNumber(principalAmount)
  const rate = new BigNumber(monthlyRateDecimal)
  const monthlyPrincipal = principal.dividedBy(termMonths)

  const entries: ScheduleEntry[] = []
  let balance = principal
  let totalInterest = new BigNumber(0)

  for (let month = 1; month <= termMonths; month++) {
    // Last month absorbs rounding remainder
    const thisPrincipal = month === termMonths ? balance : monthlyPrincipal

    const interest =
      loanType === "fixed_rate"
        ? principal.multipliedBy(rate)
        : balance.multipliedBy(rate)

    totalInterest = totalInterest.plus(interest)
    const installment = thisPrincipal.plus(interest)
    balance = balance.minus(thisPrincipal)

    entries.push({
      month,
      monthlyPrincipal: formatAmount(thisPrincipal),
      monthlyInterest: formatAmount(interest),
      monthlyInstallment: formatAmount(installment),
      balanceAfter: formatAmount(balance),
    })
  }

  return { entries, totalInterest }
}

/**
 * Allocates a payment for a fixed_rate loan.
 *
 * Interest is ALWAYS calculated on the original principal amount.
 * Early payoff: borrower must pay ALL remaining term interest.
 * Interest-first: payment covers interest first, remainder to principal.
 */
export function allocateFixedRatePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  originalPrincipal: string
  monthlyRateDecimal: string
  termMonths: number
  paymentNumber: number
  /** Interest already collected from earlier payments within the same monthly period */
  interestAlreadyPaidInPeriod?: string
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, originalPrincipal, monthlyRateDecimal, termMonths, paymentNumber, interestAlreadyPaidInPeriod } = params
  const payment = new BigNumber(paymentAmount)
  const balance = new BigNumber(principalBalanceBefore)
  const monthlyInterest = new BigNumber(originalPrincipal).multipliedBy(new BigNumber(monthlyRateDecimal))
  const alreadyPaid = new BigNumber(interestAlreadyPaidInPeriod ?? "0")

  // Clamp remaining months to at least 1 (handles paymentNumber > termMonths from partial payments)
  const remainingMonths = Math.max(termMonths - paymentNumber + 1, 1)

  // Early payoff threshold: payment exceeds current month interest + remaining principal
  // This means the borrower intends to close the loan, so charge all remaining term interest
  const earlyPayoffThreshold = BigNumber.max(monthlyInterest.minus(alreadyPaid), 0).plus(balance)

  let interestOwed: BigNumber
  if (payment.isGreaterThanOrEqualTo(earlyPayoffThreshold)) {
    // Early payoff: charge all remaining term interest minus what's already paid this period
    interestOwed = BigNumber.max(monthlyInterest.multipliedBy(remainingMonths).minus(alreadyPaid), 0)
  } else {
    // Normal payment: charge one month of interest minus what's already paid this period
    interestOwed = BigNumber.max(monthlyInterest.minus(alreadyPaid), 0)
  }

  // Interest-first allocation
  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: formatAmount(balance),
      outstandingBalanceAfter: computeOutstanding(balance, monthlyRateDecimal),
      loanFullyPaid: false,
    }
  }

  const principalPortion = BigNumber.min(payment.minus(interestOwed), balance)
  const principalBalanceAfter = BigNumber.max(balance.minus(principalPortion), 0)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    outstandingBalanceAfter: computeOutstanding(principalBalanceAfter, monthlyRateDecimal),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}

/**
 * Allocates a payment for a reducing_balance loan.
 *
 * Interest is calculated on the CURRENT balance (not original principal).
 * Early payoff: only owes interest on current balance (saves money vs fixed rate).
 * Interest-first: payment covers interest first, remainder to principal.
 */
export function allocateReducingBalancePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  originalPrincipal: string
  monthlyRateDecimal: string
  termMonths: number
  /** Interest already collected from earlier payments within the same monthly period */
  interestAlreadyPaidInPeriod?: string
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal, interestAlreadyPaidInPeriod } = params
  const payment = new BigNumber(paymentAmount)
  const balance = new BigNumber(principalBalanceBefore)
  const alreadyPaid = new BigNumber(interestAlreadyPaidInPeriod ?? "0")
  const interestOwed = BigNumber.max(balance.multipliedBy(new BigNumber(monthlyRateDecimal)).minus(alreadyPaid), 0)

  // Interest-first allocation
  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: formatAmount(balance),
      outstandingBalanceAfter: computeOutstanding(balance, monthlyRateDecimal),
      loanFullyPaid: false,
    }
  }

  const principalPortion = BigNumber.min(payment.minus(interestOwed), balance)
  const principalBalanceAfter = BigNumber.max(balance.minus(principalPortion), 0)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    outstandingBalanceAfter: computeOutstanding(principalBalanceAfter, monthlyRateDecimal),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}

/**
 * Allocates a payment interest-first, then applies remainder to principal.
 * Pure function — no DB calls, no side effects.
 *
 * Dispatches to the right strategy based on loanType:
 * - "fixed_rate" → allocateFixedRatePayment
 * - "reducing_balance" → allocateReducingBalancePayment
 * - "perpetual" or undefined → existing perpetual logic
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
  loanType?: LoanType
  originalPrincipal?: string
  termMonths?: number
  paymentNumber?: number
  /** Interest already collected from earlier payments within the same min-interest period */
  interestAlreadyPaidInPeriod?: string
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays, loanType, originalPrincipal, termMonths, paymentNumber, interestAlreadyPaidInPeriod } = params

  // Dispatch to fixed_rate strategy
  if (loanType === "fixed_rate" && originalPrincipal && termMonths && paymentNumber) {
    return allocateFixedRatePayment({
      paymentAmount,
      principalBalanceBefore,
      originalPrincipal,
      monthlyRateDecimal,
      termMonths,
      paymentNumber,
      interestAlreadyPaidInPeriod,
    })
  }

  // Dispatch to reducing_balance strategy
  if (loanType === "reducing_balance" && originalPrincipal && termMonths) {
    return allocateReducingBalancePayment({
      paymentAmount,
      principalBalanceBefore,
      originalPrincipal,
      monthlyRateDecimal,
      termMonths,
      interestAlreadyPaidInPeriod,
    })
  }

  // Default: perpetual logic.
  //
  // Rule: interest owed = balance × dailyRate × max(daysElapsed, minInterestDays).
  // The min-interest period applies to all payments, not just payoff — the first
  // month's interest must be fully paid before any payment reduces principal.
  // After day `minInterestDays` (typically 30), interest accrues pro-rata.
  const payment = new BigNumber(paymentAmount)
  const balance = new BigNumber(principalBalanceBefore)
  const alreadyPaid = new BigNumber(interestAlreadyPaidInPeriod ?? "0")
  const grossInterest = calculateInterest(principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays)
  const interestOwed = BigNumber.max(grossInterest.minus(alreadyPaid), 0)

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      outstandingBalanceAfter: computeOutstanding(principalBalanceBefore, monthlyRateDecimal),
      loanFullyPaid: false,
    }
  }

  const principalPortion = BigNumber.min(payment.minus(interestOwed), balance)
  const principalBalanceAfter = BigNumber.max(balance.minus(principalPortion), 0)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    outstandingBalanceAfter: computeOutstanding(principalBalanceAfter, monthlyRateDecimal),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
