// Builds a chronological statement of everything that has affected a loan.
//
// Pure function — no DB, no network, no React. Takes a loan row plus its
// payments and the rate-change-request history (both already sorted client-
// side by the caller), and simulates the loan day-by-day from start to today.
//
// What "events" are captured:
//   - issuance (day 0)
//   - each payment (interest/principal allocation, balance before/after)
//   - approved rate-change effective dates (rate transitions)
//   - the day penalty became active (when daysOverdue first hit the threshold)
//   - the day penalty was waived (from loan.penaltyWaivedAt, if set)
//
// What "cycle snapshots" are: one row per 30-day cycle from startDate. Each
// row shows the balance, base/effective-rate breakdown of interest accrued in
// that cycle, cumulative totals, days overdue at end of cycle, and penalty
// state. A partial final cycle is included for today's date.
//
// The simulation accrues interest day-by-day at the rate that's active that
// day (base or effective). Penalty activation is determined by the same rule
// the UI uses (daysOverdue >= PENALTY_THRESHOLD_DAYS, ignoring waiver only
// if waiver isn't set at that point in time — we don't have historical
// waiver-toggle logs, so we treat the current waiver flag as a static input).
//
// Lazy = ~1s of CPU for a 365-day loan in the browser. More than enough.

import BigNumber from "bignumber.js"
import { PENALTY_THRESHOLD_DAYS } from "./interest/effective-rate"

const DAY_MS = 86_400_000

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

export type StatementEvent =
  | {
      kind: "issue"
      day: number
      date: Date
      principal: string
      issuanceFee: string
      baseRate: string
    }
  | {
      kind: "payment"
      day: number
      date: Date
      amount: string
      interestPortion: string
      principalPortion: string
      balanceBefore: string
      balanceAfter: string
      recordedBy: string
    }
  | {
      kind: "penalty_active"
      day: number
      date: Date
      reason: string
    }
  | {
      kind: "penalty_waived"
      day: number
      date: Date
      waivedBy: string | null
    }
  | {
      kind: "rate_changed"
      day: number
      date: Date
      from: string
      to: string
    }

export interface CycleSnapshot {
  cycle: number
  startDay: number
  endDay: number
  startDate: Date
  endDate: Date
  isPartial: boolean
  startBalance: string
  endBalance: string
  daysAtBaseRate: number
  daysAtEffectiveRate: number
  accruedAtBase: string
  accruedAtEffective: string
  accruedInCycle: string
  cumulativeAccrued: string
  cumulativePaid: string
  netUnpaidAtEnd: string
  daysOverdueAtEnd: number
  penaltyActiveAtEnd: boolean
}

export interface LoanStatement {
  loanId: string
  generatedAt: Date
  startDate: Date
  today: Date
  daysSinceStart: number
  terms: {
    principal: string
    baseRate: string
    penaltyMultiplier: string
    effectiveRate: string
    penaltyThresholdDays: number
    minInterestDays: number
    loanType: string
    issuanceFee: string
    backdated: boolean
  }
  events: StatementEvent[]
  cycles: CycleSnapshot[]
  finalState: {
    principalBalance: string
    cumulativeInterestAccrued: string
    cumulativeInterestPaid: string
    netUnpaidInterest: string
    totalDue: string
    daysOverdue: number
    penaltyActive: boolean
  }
}

export interface BuildStatementInput {
  loan: {
    id: string
    principalAmount: string
    interestRate: string
    interestRateOverride: string | null
    penaltyMultiplier: string
    penaltyWaived: boolean
    penaltyWaivedAt: Date | null
    penaltyWaivedBy: string | null
    minInterestDays: number
    issuanceFee: string
    loanType: string
    startDate: Date
    createdAt: Date
  }
  payments: Array<{
    paymentDate: Date
    amount: string
    interestPortion: string
    principalPortion: string
    recorderName: string
  }>
  /** Approved rate-change history (optional). If omitted, the current rate is treated as in effect since day 0. */
  rateChanges?: Array<{
    effectiveDate: Date
    fromRate: string
    toRate: string
  }>
  today: Date
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

export function buildLoanStatement(input: BuildStatementInput): LoanStatement {
  const { loan, payments, rateChanges = [], today } = input

  const principalBN = new BigNumber(loan.principalAmount)
  const initialBaseRate = loan.interestRateOverride ?? loan.interestRate
  const multiplier = new BigNumber(loan.penaltyMultiplier ?? "0.1000")
  const initialEffective = new BigNumber(initialBaseRate)
    .plus(new BigNumber(initialBaseRate).multipliedBy(multiplier))
    .toFixed(4)

  const daysSinceStart = Math.max(0, daysBetween(loan.startDate, today))

  const events: StatementEvent[] = [
    {
      kind: "issue",
      day: 0,
      date: loan.startDate,
      principal: loan.principalAmount,
      issuanceFee: loan.issuanceFee,
      baseRate: initialBaseRate,
    },
  ]

  // Sort payments and rate changes by date for chronological iteration.
  const sortedPayments = [...payments].sort(
    (a, b) => a.paymentDate.getTime() - b.paymentDate.getTime(),
  )
  const sortedRateChanges = [...rateChanges].sort(
    (a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime(),
  )

  // Index into events as we walk forward.
  let nextPaymentIdx = 0
  let nextRateChangeIdx = 0

  // Running state.
  let balance = principalBN
  let baseRate = new BigNumber(initialBaseRate)
  let cumulativeAccrued = new BigNumber(0)
  let cumulativePaid = new BigNumber(0)
  let penaltyActive = false
  let penaltyActivatedDay: number | null = null

  // Track cycle bucket.
  let cycleStartDay = 0
  let cycleStartBalance = balance
  let cycleAccruedBase = new BigNumber(0)
  let cycleAccruedEffective = new BigNumber(0)
  let cycleDaysAtBase = 0
  let cycleDaysAtEffective = 0
  const cycles: CycleSnapshot[] = []

  function pushCycle(endDay: number, isPartial: boolean) {
    const accruedInCycle = cycleAccruedBase.plus(cycleAccruedEffective)
    const dailyAtBaseEnd = balance.multipliedBy(baseRate).dividedBy(30)
    const netUnpaid = BigNumber.max(cumulativeAccrued.minus(cumulativePaid), 0)
    const daysOverdueAtEnd = dailyAtBaseEnd.isZero()
      ? 0
      : Math.floor(netUnpaid.dividedBy(dailyAtBaseEnd).toNumber())
    cycles.push({
      cycle: cycles.length + 1,
      startDay: cycleStartDay,
      endDay,
      startDate: addDays(loan.startDate, cycleStartDay),
      endDate: addDays(loan.startDate, endDay),
      isPartial,
      startBalance: cycleStartBalance.toFixed(0),
      endBalance: balance.toFixed(0),
      daysAtBaseRate: cycleDaysAtBase,
      daysAtEffectiveRate: cycleDaysAtEffective,
      accruedAtBase: cycleAccruedBase.toFixed(0),
      accruedAtEffective: cycleAccruedEffective.toFixed(0),
      accruedInCycle: accruedInCycle.toFixed(0),
      cumulativeAccrued: cumulativeAccrued.toFixed(0),
      cumulativePaid: cumulativePaid.toFixed(0),
      netUnpaidAtEnd: netUnpaid.toFixed(0),
      daysOverdueAtEnd,
      penaltyActiveAtEnd: penaltyActive,
    })
    // Reset cycle counters.
    cycleStartDay = endDay
    cycleStartBalance = balance
    cycleAccruedBase = new BigNumber(0)
    cycleAccruedEffective = new BigNumber(0)
    cycleDaysAtBase = 0
    cycleDaysAtEffective = 0
  }

  // Walk day-by-day from day 1 to today.
  for (let day = 1; day <= daysSinceStart; day++) {
    const dayDate = addDays(loan.startDate, day)

    // 1) Process any rate changes effective on or before this day.
    while (
      nextRateChangeIdx < sortedRateChanges.length &&
      daysBetween(loan.startDate, sortedRateChanges[nextRateChangeIdx].effectiveDate) <= day
    ) {
      const rc = sortedRateChanges[nextRateChangeIdx]
      const rcDay = daysBetween(loan.startDate, rc.effectiveDate)
      events.push({
        kind: "rate_changed",
        day: rcDay,
        date: rc.effectiveDate,
        from: rc.fromRate,
        to: rc.toRate,
      })
      baseRate = new BigNumber(rc.toRate)
      nextRateChangeIdx += 1
    }

    // 2) Process any payments dated up to and including this day. Payments
    //    reduce the principal balance BEFORE this day's accrual is computed,
    //    so a "pay everything down" same-day stops further accrual.
    while (
      nextPaymentIdx < sortedPayments.length &&
      daysBetween(loan.startDate, sortedPayments[nextPaymentIdx].paymentDate) <= day
    ) {
      const p = sortedPayments[nextPaymentIdx]
      const pDay = daysBetween(loan.startDate, p.paymentDate)
      const balanceBefore = balance
      balance = BigNumber.max(balance.minus(new BigNumber(p.principalPortion)), 0)
      cumulativePaid = cumulativePaid.plus(new BigNumber(p.interestPortion))
      events.push({
        kind: "payment",
        day: pDay,
        date: p.paymentDate,
        amount: p.amount,
        interestPortion: p.interestPortion,
        principalPortion: p.principalPortion,
        balanceBefore: balanceBefore.toFixed(0),
        balanceAfter: balance.toFixed(0),
        recordedBy: p.recorderName,
      })
      nextPaymentIdx += 1
    }

    // 3) Determine if penalty is active for this day, based on days-overdue
    //    derived from cumulative base-rate accrual so far.
    const dailyAtBase = balance.multipliedBy(baseRate).dividedBy(30)
    const netUnpaidBefore = BigNumber.max(cumulativeAccrued.minus(cumulativePaid), 0)
    const daysOverdueBefore = dailyAtBase.isZero()
      ? 0
      : Math.floor(netUnpaidBefore.dividedBy(dailyAtBase).toNumber())
    const shouldPenalize =
      daysOverdueBefore >= PENALTY_THRESHOLD_DAYS && !loan.penaltyWaived

    if (shouldPenalize && !penaltyActive) {
      penaltyActive = true
      penaltyActivatedDay = day
      events.push({
        kind: "penalty_active",
        day,
        date: dayDate,
        reason: `Days overdue reached ${daysOverdueBefore}, crossing the ${PENALTY_THRESHOLD_DAYS}-day threshold`,
      })
    }

    // 4) Accrue today's interest at the active rate.
    const effectiveBN = baseRate.plus(baseRate.multipliedBy(multiplier))
    if (penaltyActive) {
      const accr = balance.multipliedBy(effectiveBN).dividedBy(30)
      cumulativeAccrued = cumulativeAccrued.plus(accr)
      cycleAccruedEffective = cycleAccruedEffective.plus(accr)
      cycleDaysAtEffective += 1
    } else {
      const accr = balance.multipliedBy(baseRate).dividedBy(30)
      cumulativeAccrued = cumulativeAccrued.plus(accr)
      cycleAccruedBase = cycleAccruedBase.plus(accr)
      cycleDaysAtBase += 1
    }

    // 5) Close the cycle at every 30-day boundary.
    if (day % 30 === 0) {
      pushCycle(day, /* isPartial */ false)
    }
  }

  // Emit a partial cycle for today if we're mid-cycle.
  if (daysSinceStart > cycleStartDay) {
    pushCycle(daysSinceStart, /* isPartial */ true)
  }

  // Penalty-waived event, if any (whole-loan-level — historical exact day
  // isn't material since the waiver is currently in effect).
  if (loan.penaltyWaived && loan.penaltyWaivedAt) {
    events.push({
      kind: "penalty_waived",
      day: daysBetween(loan.startDate, loan.penaltyWaivedAt),
      date: loan.penaltyWaivedAt,
      waivedBy: loan.penaltyWaivedBy,
    })
  }

  // Sort events chronologically (rate changes / penalties might have been
  // appended out of order).
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.day - b.day)

  const netUnpaid = BigNumber.max(cumulativeAccrued.minus(cumulativePaid), 0)
  const totalDue = balance.plus(netUnpaid)
  const dailyAtBaseEnd = balance.multipliedBy(baseRate).dividedBy(30)
  const daysOverdue = dailyAtBaseEnd.isZero()
    ? 0
    : Math.floor(netUnpaid.dividedBy(dailyAtBaseEnd).toNumber())

  // penaltyActivatedDay is captured via the events array — the variable just
  // makes future "since penalty activation" math cheap if we want it.
  void penaltyActivatedDay

  return {
    loanId: loan.id,
    generatedAt: today,
    startDate: loan.startDate,
    today,
    daysSinceStart,
    terms: {
      principal: loan.principalAmount,
      baseRate: initialBaseRate,
      penaltyMultiplier: loan.penaltyMultiplier,
      effectiveRate: initialEffective,
      penaltyThresholdDays: PENALTY_THRESHOLD_DAYS,
      minInterestDays: loan.minInterestDays,
      loanType: loan.loanType,
      issuanceFee: loan.issuanceFee,
      backdated: loan.startDate.getTime() < loan.createdAt.getTime(),
    },
    events,
    cycles,
    finalState: {
      principalBalance: balance.toFixed(0),
      cumulativeInterestAccrued: cumulativeAccrued.toFixed(0),
      cumulativeInterestPaid: cumulativePaid.toFixed(0),
      netUnpaidInterest: netUnpaid.toFixed(0),
      totalDue: totalDue.toFixed(0),
      daysOverdue,
      penaltyActive,
    },
  }
}
