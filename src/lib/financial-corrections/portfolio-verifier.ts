import BigNumber from "bignumber.js"
import { PENALTY_THRESHOLD_DAYS } from "@/lib/interest/effective-rate"
import { historicalRateCorrectionExceptions, planPortfolioAccrualRepair,
  type PortfolioAccrualEntry,
  type PortfolioAccrualPlan, type PortfolioAccrualSnapshot } from
  "@/lib/interest/portfolio-accrual-repair"

const DAY_MS = 86_400_000
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

export type PortfolioAccrualEvidence = {
  loanId: string
  asOf: string
  checkpoints: Array<Omit<PortfolioAccrualEntry, "date"> & { date: string }>
  checkedSettlementCount: number
  checkedPriorJournalCount: number
  historicalCorrectionRunId?: string
  sourceDigest?: string
}

type PriorJournal = PortfolioAccrualSnapshot["receivableJournals"][number]

export type AttributedPriorJournal = PriorJournal & {
  loanId: string | null
  referenceType: string | null
  referenceId: string | null
  categoryName: string
  categoryType: string
  depositLocation: string | null
  subLocationId: string | null
  groupEntryCount: number
  earnedCounterpart: {
    id: string
    journalGroupId: string | null
    loanId: string | null
    referenceType: string | null
    referenceId: string | null
    categoryName: string
    date: Date
    amount: string
    type: "debit" | "credit"
    categoryType: string
    depositLocation: string | null
    subLocationId: string | null
  } | null
}

export type AttributedPortfolioAccrualSnapshot = Omit<PortfolioAccrualSnapshot,
  "receivableJournals"> & { receivableJournals: AttributedPriorJournal[] }

function whole(value: BigNumber): BigNumber {
  return new Decimal(value.toFixed(0, BigNumber.ROUND_HALF_UP))
}

function money(value: BigNumber): string {
  return value.toFixed(2)
}

function checkpointDates(snapshot: PortfolioAccrualSnapshot, end: Date): Date[] {
  const { startDate } = snapshot.loan
  const times = new Set<number>([end.getTime()])
  let year = startDate.getUTCFullYear()
  let month = startDate.getUTCMonth()
  while (year < end.getUTCFullYear() || year === end.getUTCFullYear() &&
      month <= end.getUTCMonth()) {
    const last = new Date(Date.UTC(year, month + 1, 1) - 1)
    if (last >= startDate && last <= end) times.add(last.getTime())
    if (++month === 12) { month = 0; year++ }
  }
  for (const date of [...snapshot.payments.map((row) => row.paymentDate),
    ...snapshot.waivers.map((row) => row.waiverDate)]) {
    if (date >= startDate && date <= end) times.add(date.getTime())
  }
  return [...times].sort((a, b) => a - b).map((value) => new Date(value))
}

/** A second, day-by-day calculation from source facts; does not read proposal totals. */
function independentlyAccruedAt(snapshot: PortfolioAccrualSnapshot, at: Date): {
  accrued: BigNumber; paid: BigNumber; waived: BigNumber
} {
  const loan = snapshot.loan
  const payments = snapshot.payments.filter((row) => row.paymentDate <= at)
    .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())
  const waivers = snapshot.waivers.filter((row) => row.waiverDate <= at)
    .sort((a, b) => a.waiverDate.getTime() - b.waiverDate.getTime())
  let balance = new Decimal(loan.principalAmount)
  const baseRate = new Decimal(loan.interestRateOverride ?? loan.interestRate)
  const multiplier = new Decimal(loan.penaltyMultiplier ?? "0.1000")
  let accrued = new Decimal(0)
  let paid = new Decimal(0)
  let waived = new Decimal(0)
  let penaltyActive = false
  let nextPayment = 0
  let nextWaiver = 0
  const days = Math.max(0, Math.floor((at.getTime() - loan.startDate.getTime()) / DAY_MS))
  for (let day = 1; day <= days; day++) {
    const dayDate = new Date(loan.startDate.getTime() + day * DAY_MS)
    const dailyBase = balance.multipliedBy(baseRate).dividedBy(30)
    const netUnpaid = Decimal.max(accrued.minus(paid).minus(waived), 0)
    const daysOverdue = dailyBase.isZero() ? 0 :
      Math.floor(netUnpaid.dividedBy(dailyBase).toNumber())
    const waiverEffective = loan.penaltyWaived &&
      (!loan.penaltyWaivedAt || loan.penaltyWaivedAt <= dayDate)
    penaltyActive = !waiverEffective && daysOverdue >= PENALTY_THRESHOLD_DAYS
    const rate = penaltyActive ? baseRate.plus(baseRate.multipliedBy(multiplier)) : baseRate
    accrued = accrued.plus(balance.multipliedBy(rate).dividedBy(30))
    while (nextPayment < payments.length &&
        Math.floor((payments[nextPayment].paymentDate.getTime() -
          loan.startDate.getTime()) / DAY_MS) <= day) {
      balance = Decimal.max(balance.minus(payments[nextPayment].principalPortion), 0)
      paid = paid.plus(payments[nextPayment].interestPortion)
      nextPayment++
    }
    while (nextWaiver < waivers.length &&
        Math.floor((waivers[nextWaiver].waiverDate.getTime() -
          loan.startDate.getTime()) / DAY_MS) <= day) {
      balance = Decimal.max(balance.minus(waivers[nextWaiver].principalPortion), 0)
      waived = waived.plus(waivers[nextWaiver].interestPortion)
      nextWaiver++
    }
  }
  return { accrued, paid, waived }
}

export function verifyPortfolioAccrualEvidence(
  snapshot: PortfolioAccrualSnapshot,
  plan: PortfolioAccrualPlan,
): PortfolioAccrualEvidence {
  const current = planPortfolioAccrualRepair(snapshot)
  if (plan.classification !== "ready" || current.classification !== "ready" ||
      snapshot.sourceExceptions.length || snapshot.loan.loanType !== "perpetual" ||
      snapshot.loan.rolledOverFrom || snapshot.loan.status === "rolled_over") {
    throw new Error("Only a ready, source-reconciled portfolio plan can receive agent review")
  }
  if (plan.loanId !== snapshot.loan.id || plan.asOf.getTime() !== snapshot.asOf.getTime() ||
      plan.planHash !== current.planHash ||
      plan.inputFingerprint !== current.inputFingerprint ||
      plan.policyVersion !== current.policyVersion) {
    throw new Error("Portfolio plan identity or source fingerprint changed before agent review")
  }
  if (snapshot.historicalRateCorrection &&
      (!/^[a-f0-9]{64}$/.test(snapshot.sourceDigest ?? "") ||
        historicalRateCorrectionExceptions(snapshot).length)) {
    throw new Error("Historical correction source digest or run evidence is incomplete")
  }
  for (const row of snapshot.receivableJournals) {
    const attributed = row as Partial<AttributedPriorJournal>
    const earned = attributed.earnedCounterpart
    if (!row.journalGroupId || attributed.groupEntryCount !== 2 ||
        attributed.categoryName !== "Interest Receivable" ||
        attributed.categoryType !== "asset" || attributed.loanId !== snapshot.loan.id ||
        !attributed.referenceType || !attributed.referenceId ||
        attributed.depositLocation !== null || attributed.subLocationId !== null ||
        !earned || !earned.id || earned.id === row.id ||
        earned.journalGroupId !== row.journalGroupId ||
        earned.categoryName !== "Interest Earned" ||
        earned.categoryType !== "revenue" ||
        earned.loanId !== snapshot.loan.id ||
        earned.referenceType !== attributed.referenceType ||
        earned.referenceId !== attributed.referenceId ||
        !(earned.date instanceof Date) || earned.date.getTime() !== row.date.getTime() ||
        earned.amount !== row.amount || earned.type === row.type ||
        earned.depositLocation !== null || earned.subLocationId !== null ||
        row.earnedCounterpartAmount !== earned.amount ||
        row.earnedCounterpartType !== earned.type) {
      throw new Error(`Prior journal ${row.id} is not a fully attributed balanced non-cash pair`)
    }
  }
  const settlements = [...snapshot.payments.map((row) => row.paymentDate),
    ...snapshot.waivers.map((row) => row.waiverDate)]
  const end = snapshot.loan.status === "fully_paid"
    ? new Date(Math.min(snapshot.asOf.getTime(), Math.max(...settlements.map((date) => date.getTime()))))
    : snapshot.asOf
  const expected: PortfolioAccrualEntry[] = []
  let plannedBalance = new Decimal(0)
  for (const date of checkpointDates(snapshot, end)) {
    const state = independentlyAccruedAt(snapshot, date)
    const settled = whole(state.paid).plus(whole(state.waived))
    const desired = whole(Decimal.max(state.accrued.minus(state.paid).minus(state.waived), 0))
    const recorded = snapshot.receivableJournals.filter((row) => row.date <= date)
      .reduce((sum, row) => row.type === "debit"
        ? sum.plus(row.amount) : sum.minus(row.amount), new Decimal(0))
    const before = recorded.plus(plannedBalance)
    const delta = desired.minus(before)
    if (delta.isZero()) continue
    expected.push({ date, period: date.toISOString().slice(0, 7),
      accrued: money(whole(state.accrued)), settled: money(settled),
      existingReceivable: money(before), delta: money(delta),
      resultingReceivable: money(desired) })
    plannedBalance = plannedBalance.plus(delta)
  }
  if (expected.length !== plan.entries.length || expected.some((entry, index) => {
    const proposed = plan.entries[index]
    return !proposed || entry.date.getTime() !== proposed.date.getTime() ||
      entry.period !== proposed.period || entry.accrued !== proposed.accrued ||
      entry.settled !== proposed.settled ||
      entry.existingReceivable !== proposed.existingReceivable ||
      entry.delta !== proposed.delta ||
      entry.resultingReceivable !== proposed.resultingReceivable
  })) {
    throw new Error("Portfolio proposal differs from independently calculated checkpoints")
  }
  return { loanId: snapshot.loan.id, asOf: snapshot.asOf.toISOString(),
    checkpoints: expected.map((entry) => ({ ...entry, date: entry.date.toISOString() })),
    checkedSettlementCount: snapshot.payments.length + snapshot.waivers.length,
    checkedPriorJournalCount: snapshot.receivableJournals.length,
    ...(snapshot.historicalRateCorrection ? {
      historicalCorrectionRunId: snapshot.historicalRateCorrection.run.id,
      sourceDigest: snapshot.sourceDigest,
    } : {}) }
}
