import BigNumber from "bignumber.js"
import type { LoanRateChangeHistoryEntry } from "@/types/rate-change"

type RateChange = { effectiveDate: Date; fromRate: string; toRate: string }

type LoanRateTerms = {
  startDate: Date
  interestRate: string
  interestRateOverride: string | null
}

function rate(value: string): BigNumber | null {
  const parsed = new BigNumber(value)
  return parsed.isFinite() && parsed.gt(0) && parsed.lt(1) ? parsed : null
}

function date(value: Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Refuse to present a dated statement when the recorded rate schedule is ambiguous. */
export function resolveStatementRateHistory(input: {
  loan: LoanRateTerms
  history: LoanRateChangeHistoryEntry[]
}): { rateChanges: RateChange[]; issue: string | null } {
  const issue = (message: string) => ({ rateChanges: [], issue: message })
  const start = date(input.loan.startDate)
  const original = rate(input.loan.interestRate)
  const current = rate(input.loan.interestRateOverride ?? input.loan.interestRate)
  if (!Number.isFinite(start.getTime()) || !original || !current) {
    return issue("The loan rate or start date needs review before interest can be calculated.")
  }

  const ordered = [...input.history].sort((a, b) =>
    date(a.changedAt).getTime() - date(b.changedAt).getTime() || a.id.localeCompare(b.id))
  const latestCorrection = [...ordered].reverse().find((entry) => entry.effectiveFrom)
  if (latestCorrection) {
    const effectiveFrom = date(latestCorrection.effectiveFrom!)
    if (!Number.isFinite(effectiveFrom.getTime()) || effectiveFrom.getTime() !== start.getTime()) {
      return issue("The rate correction's effective date does not match the loan start date.")
    }
    const corrected = rate(latestCorrection.toRate)
    if (!corrected || !corrected.eq(current)) {
      return issue("The current rate does not reconcile to the recorded correction.")
    }
    if (ordered.some((entry) => !entry.effectiveFrom &&
      date(entry.changedAt).getTime() > date(latestCorrection.changedAt).getTime())) {
      return issue("An unmarked rate edit followed the recorded correction and needs review.")
    }
    return { rateChanges: [], issue: null }
  }

  const rateChanges: RateChange[] = []
  let previous = original
  let previousDay: string | null = null
  for (const entry of ordered) {
    const changedAt = date(entry.changedAt)
    const from = rate(entry.fromRate)
    const to = rate(entry.toRate)
    if (!Number.isFinite(changedAt.getTime()) || !from || !to || changedAt < start) {
      return issue("An applied rate change has an invalid date or rate and needs review.")
    }
    const day = changedAt.toISOString().slice(0, 10)
    if (day === previousDay) {
      return issue("Applied rate changes on the same day need review before interest can be calculated.")
    }
    if (!previous.eq(from)) {
      return issue("The applied rate history does not reconcile from the loan's original rate.")
    }
    rateChanges.push({ effectiveDate: changedAt, fromRate: entry.fromRate, toRate: entry.toRate })
    previous = to
    previousDay = day
  }
  if (!previous.eq(current)) {
    return issue("The current rate does not reconcile to the applied rate history.")
  }
  return { rateChanges, issue: null }
}
