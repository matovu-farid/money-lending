import BigNumber from "bignumber.js"

const DAY_MS = 24 * 60 * 60 * 1000

function money(value: string): BigNumber | null {
  return /^\d+(?:\.\d{1,2})?$/.test(value) ? new BigNumber(value) : null
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

export type StartDayInterestPayment = {
  id: string
  paymentDate: Date
  amount: string
  interestPortion: string
  principalPortion: string
}

export type StartDayInterestReplaySource = {
  loanStart: Date
  asOf: Date
  paymentId: string
  payments: readonly StartDayInterestPayment[]
  waivers: readonly { waiverDate: Date }[]
  penaltyWaivedAt: Date | null
  rateEvents: readonly { effectiveDate: Date }[]
  /** Produced by the existing snapshot's cash, journal, and audit reconciliation. */
  sourceExceptions: readonly string[]
}

/**
 * Prove only that this payment's delayed day-zero replay cannot change accrual.
 * The caller must first reconcile all Cash, journal, and audit history; supply
 * every effective rate event; and retain all other planner policy guards.
 */
export function proveStartDayInterestOnlyReplay(
  source: StartDayInterestReplaySource,
): boolean {
  if (!source || !Array.isArray(source.payments) || !Array.isArray(source.waivers) ||
      !Array.isArray(source.rateEvents) || !Array.isArray(source.sourceExceptions)) return false
  if (source.sourceExceptions.length > 0) return false
  if (typeof source.paymentId !== "string" || !source.paymentId.trim()) return false
  if (!validDate(source.loanStart) || !validDate(source.asOf) ||
      (source.penaltyWaivedAt !== null && !validDate(source.penaltyWaivedAt)) ||
      source.payments.some((row) => !validDate(row.paymentDate)) ||
      source.waivers.some((row) => !validDate(row.waiverDate)) ||
      source.rateEvents.some((row) => !validDate(row.effectiveDate))) return false
  const matchingPayments = source.payments.filter((row) => row.id === source.paymentId)
  if (matchingPayments.length !== 1) return false
  const payment = matchingPayments[0]
  const start = source.loanStart.getTime()
  const settlement = payment.paymentDate.getTime()
  const asOf = source.asOf.getTime()
  const elapsed = settlement - start
  const amount = money(payment.amount)
  const interest = money(payment.interestPortion)
  const principal = money(payment.principalPortion)
  const inStartInterval = (date: Date) => {
    const time = date.getTime()
    return time >= start && time - start < DAY_MS
  }
  const startDayPayments = source.payments.filter((row) => inStartInterval(row.paymentDate))
  return elapsed >= 0 && elapsed < DAY_MS && settlement <= asOf &&
    !!amount && amount.gt(0) && !!interest && interest.eq(amount) &&
    !!principal && principal.isZero() &&
    startDayPayments.length === 1 && startDayPayments[0].id === payment.id &&
    !source.waivers.some((row) => inStartInterval(row.waiverDate)) &&
    (source.penaltyWaivedAt === null || !inStartInterval(source.penaltyWaivedAt)) &&
    !source.rateEvents.some((row) => inStartInterval(row.effectiveDate))
}
