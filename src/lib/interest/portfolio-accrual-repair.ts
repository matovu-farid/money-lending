import { createHash } from "node:crypto"
import BigNumber from "bignumber.js"
import { buildLoanStatement, type BuildStatementInput } from "@/lib/loan-statement"

const POLICY_VERSION = "portfolio-accrual-v3"

type Payment = Omit<BuildStatementInput["payments"][number], "recorderName"> & { id: string }
type Waiver = NonNullable<BuildStatementInput["waivers"]>[number] & { id: string }

export type HistoricalRateCorrectionEvidence = {
  run: {
    id: string; loanId: string; planHash: string; inputFingerprint: string
    policyVersion: string; agentReviewId: string | null; appliedByAgent: string | null
    backupSha256: string; appliedAt: Date; beforeSummary: string; afterSummary: string
  }
  review: {
    id: string; kind: string; subjectId: string; planHash: string
    inputFingerprint: string; policyVersion: string; verdict: string
    reviewerAgentId: string; consumedByRunId: string | null; consumedAt: Date | null
  }
  audit: {
    id: string; action: string; entityType: string; entityId: string
    occurredAt: Date; beforeValue: string | null; afterValue: string | null
  }
}

export type PortfolioAccrualSnapshot = {
  loan: Omit<BuildStatementInput["loan"], "createdAt"> & { status: string }
  payments: Payment[]
  waivers: Waiver[]
  receivableJournals: Array<{
    id: string
    date: Date
    amount: string
    type: "debit" | "credit"
    journalGroupId: string | null
    earnedCounterpartAmount: string | null
    earnedCounterpartType: "debit" | "credit" | null
  }>
  receivableCategory: { id: string; type: string } | null
  historicalRateCorrection?: HistoricalRateCorrectionEvidence
  sourceDigest?: string
  sourceExceptions: string[]
  asOf: Date
}

export type PortfolioAccrualEntry = {
  date: Date
  period: string
  accrued: string
  settled: string
  existingReceivable: string
  delta: string
  resultingReceivable: string
}

export type PortfolioAccrualPlan = {
  loanId: string
  asOf: Date
  policyVersion: string
  inputFingerprint: string
  planHash: string
  classification: "ready" | "noop" | "blocked"
  exceptions: string[]
  entries: PortfolioAccrualEntry[]
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function sortDateId<T extends { id: string }>(rows: T[], date: (row: T) => Date): T[] {
  return [...rows].sort((a, b) => date(a).getTime() - date(b).getTime() || a.id.localeCompare(b.id))
}

function money(value: BigNumber): string {
  return value.toFixed(2)
}

function validAmount(value: string): boolean {
  const amount = new BigNumber(value)
  return amount.isFinite() && amount.gte(0) && (amount.decimalPlaces() ?? Infinity) <= 2
}

function record(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function sameRate(value: unknown, expected: string): boolean {
  return (typeof value === "string" || typeof value === "number") &&
    new BigNumber(value).isFinite() && new BigNumber(value).eq(expected)
}

function sameAmount(value: unknown, expected: string): boolean {
  return (typeof value === "string" || typeof value === "number") &&
    new BigNumber(value).isFinite() && new BigNumber(value).eq(expected)
}

/** Check the stored run against current terms and reconciled settlement allocations. */
export function historicalRateCorrectionExceptions(
  snapshot: PortfolioAccrualSnapshot,
): string[] {
  const proof = snapshot.historicalRateCorrection
  if (!proof) return snapshot.loan.interestRateOverride
    ? ["Paid-rate loan requires a completed historical-rate correction run"] : []
  const { run, review, audit } = proof
  const before = record(run.beforeSummary)
  const after = record(run.afterSummary)
  const auditAfter = record(audit.afterValue)
  const rate = snapshot.loan.interestRateOverride
  const runAsOf = after?.asOf
  const beforeChanges = Array.isArray(before?.changes) ? before.changes : null
  const afterChanges = Array.isArray(after?.changes) ? after.changes : null
  const settlements = [...snapshot.payments, ...snapshot.waivers]
  const corrected = !!rate &&
    run.loanId === snapshot.loan.id && !!run.id && !!run.planHash &&
    !!run.inputFingerprint && run.policyVersion === "v2" &&
    !!run.agentReviewId && !!run.appliedByAgent?.startsWith("agent:") &&
    /^[a-f0-9]{64}$/.test(run.backupSha256) &&
    run.appliedAt instanceof Date && Number.isFinite(run.appliedAt.getTime()) &&
    review.id === run.agentReviewId && review.kind === "historical_rate" &&
    review.subjectId === run.loanId && review.planHash === run.planHash &&
    review.inputFingerprint === run.inputFingerprint &&
    review.policyVersion === run.policyVersion && review.verdict === "pass" &&
    review.reviewerAgentId.startsWith("agent:") &&
    review.reviewerAgentId !== run.appliedByAgent &&
    review.consumedByRunId === run.id && review.consumedAt instanceof Date &&
    Number.isFinite(review.consumedAt.getTime()) &&
    audit.action === "historical_rate_corrected_by_agent" &&
    audit.entityType === "loan" && audit.entityId === run.loanId &&
    audit.occurredAt instanceof Date && Number.isFinite(audit.occurredAt.getTime()) &&
    auditAfter?.rateSemantics === "correction" &&
    auditAfter.effectiveFrom === snapshot.loan.startDate.toISOString() &&
    auditAfter.repairRunId === run.id && auditAfter.repairedPlanHash === run.planHash &&
    auditAfter.agentReviewId === review.id &&
    auditAfter.reviewerAgentId === review.reviewerAgentId &&
    auditAfter.executorAgentId === run.appliedByAgent &&
    sameRate(auditAfter.interestRateOverride, rate) &&
    before?.loanId === run.loanId && before.classification === "review" &&
    before.planHash === run.planHash &&
    before.inputFingerprint === run.inputFingerprint &&
    before.policyVersion === run.policyVersion &&
    sameRate(before.correctedRate, rate) &&
    after?.loanId === run.loanId && after.classification === "noop" &&
    after.policyVersion === run.policyVersion &&
    sameRate(after.correctedRate, rate) &&
    after.accrualJournalDelta === "0.00" &&
    typeof after.accrualJournalTarget === "string" &&
    validAmount(after.accrualJournalTarget) &&
    typeof after.endingPrincipal === "string" &&
    validAmount(after.endingPrincipal) &&
    Array.isArray(after.exceptions) && after.exceptions.length === 0 &&
    typeof runAsOf === "string" && Number.isFinite(Date.parse(runAsOf)) &&
    runAsOf <= snapshot.asOf.toISOString() &&
    runAsOf === before.asOf && !!beforeChanges && !!afterChanges &&
    beforeChanges.length === afterChanges.length &&
    new Set(afterChanges.map((value) => value && typeof value === "object"
      ? (value as Record<string, unknown>).id : null)).size === afterChanges.length &&
    afterChanges.every((value) => {
      if (!value || typeof value !== "object") return false
      const change = value as Record<string, unknown>
      const prior = beforeChanges.find((candidate) => candidate &&
        typeof candidate === "object" && (candidate as Record<string, unknown>).id === change.id)
      if (!prior || typeof prior !== "object") return false
      const old = prior as Record<string, unknown>
      const settlement = settlements.find((row) => row.id === change.id)
      return !!settlement &&
        sameAmount(change.oldInterest, settlement.interestPortion) &&
        sameAmount(change.oldPrincipal, settlement.principalPortion) &&
        sameAmount(change.newInterest, settlement.interestPortion) &&
        sameAmount(change.newPrincipal, settlement.principalPortion) &&
        sameAmount(old.newInterest, settlement.interestPortion) &&
        sameAmount(old.newPrincipal, settlement.principalPortion)
    }) &&
    settlements.filter((row) => row instanceof Object &&
      ("paymentDate" in row ? row.paymentDate : row.waiverDate) <= new Date(runAsOf))
      .length === afterChanges.length
  return corrected ? [] : ["Historical-rate correction run is missing, stale, or contradictory"]
}

function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 1) - 1)
}

function checkpoints(start: Date, end: Date, settlements: Date[]): Date[] {
  const times = new Set<number>([end.getTime()])
  for (let year = start.getUTCFullYear(), month = start.getUTCMonth();
    year < end.getUTCFullYear() || year === end.getUTCFullYear() && month <= end.getUTCMonth();) {
    const boundary = monthEnd(year, month)
    if (boundary >= start && boundary <= end) times.add(boundary.getTime())
    month += 1
    if (month === 12) { month = 0; year += 1 }
  }
  for (const date of settlements) {
    if (date >= start && date <= end) times.add(date.getTime())
  }
  return [...times].sort((a, b) => a - b).map((time) => new Date(time))
}

/** Pure, read-only proposal. A caller must reconcile all source journals before passing facts here. */
export function planPortfolioAccrualRepair(
  snapshot: PortfolioAccrualSnapshot,
): PortfolioAccrualPlan {
  const payments = sortDateId(snapshot.payments, (row) => row.paymentDate)
  const waivers = sortDateId(snapshot.waivers, (row) => row.waiverDate)
  const journals = sortDateId(snapshot.receivableJournals, (row) => row.date)
  const normalized = { ...snapshot, payments, waivers, receivableJournals: journals,
    sourceExceptions: [...snapshot.sourceExceptions].sort() }
  const inputFingerprint = digest({ policyVersion: POLICY_VERSION, normalized })
  const exceptions = [...normalized.sourceExceptions]
  exceptions.push(...historicalRateCorrectionExceptions(snapshot))
  const { loan, asOf } = snapshot
  if (snapshot.receivableCategory && snapshot.receivableCategory.type !== "asset") {
    exceptions.push("Interest Receivable account is not an asset")
  }
  if (!Number.isFinite(asOf.getTime()) || !Number.isFinite(loan.startDate.getTime()) ||
      asOf < loan.startDate) exceptions.push("Loan start or as-of date is invalid")
  if (loan.loanType !== "perpetual") {
    exceptions.push(`Loan type ${loan.loanType} needs its own accrual policy`)
  }
  if (loan.penaltyWaived && !loan.penaltyWaivedAt) {
    exceptions.push("Penalty waiver has no effective date")
  }
  if (loan.rolledOverFrom || loan.status === "rolled_over") {
    exceptions.push("Rollover chain requires a reconciled transfer and closure date")
  }
  if (loan.status !== "active" && loan.status !== "fully_paid" &&
      loan.status !== "rolled_over") {
    exceptions.push(`Loan status ${loan.status} needs a reconciled closure date`)
  }
  const settlements = [
    ...payments.map((row) => ({ id: row.id, date: row.paymentDate, amount: row.amount,
      interest: row.interestPortion, principal: row.principalPortion })),
    ...waivers.map((row) => ({ id: row.id, date: row.waiverDate, amount: row.amount,
      interest: row.interestPortion, principal: row.principalPortion })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id))
  for (let index = 0; index < settlements.length; index++) {
    const row = settlements[index]
    if (!Number.isFinite(row.date.getTime()) || row.date < loan.startDate || row.date > asOf ||
        !validAmount(row.amount) || !validAmount(row.interest) ||
        !validAmount(row.principal) ||
        new BigNumber(row.interest).plus(row.principal).gt(row.amount)) {
      exceptions.push(`Settlement ${row.id} does not reconcile to loan dates and amount`)
    }
    if (row.date >= loan.startDate &&
        row.date.getTime() - loan.startDate.getTime() < 24 * 60 * 60 * 1000) {
      exceptions.push(`Settlement ${row.id} falls in the loan start-day interval`)
    }
    if (index > 0 && row.date.getTime() === settlements[index - 1].date.getTime()) {
      exceptions.push(`Settlements ${settlements[index - 1].id} and ${row.id} share an effective instant`)
    }
  }
  for (const row of journals) {
    if (!Number.isFinite(row.date.getTime()) || row.date > asOf ||
        !validAmount(row.amount) || !row.journalGroupId ||
        row.earnedCounterpartAmount !== row.amount ||
        row.earnedCounterpartType === row.type) {
      exceptions.push(`Receivable journal ${row.id} is incomplete or unbalanced`)
    }
  }
  if (loan.status === "fully_paid" && settlements.length === 0) {
    exceptions.push("Fully paid loan has no dated settlement")
  }
  if (exceptions.length) {
    const plan = { loanId: loan.id, asOf, policyVersion: POLICY_VERSION,
      inputFingerprint, classification: "blocked" as const,
      exceptions: [...new Set(exceptions)].sort(), entries: [] }
    return { ...plan, planHash: digest(plan) }
  }

  const closure = loan.status === "fully_paid" ? settlements.at(-1)!.date : asOf
  const end = closure < asOf ? closure : asOf
  if (journals.some((row) => row.date > end)) {
    const plan = { loanId: loan.id, asOf, policyVersion: POLICY_VERSION,
      inputFingerprint, classification: "blocked" as const,
      exceptions: ["Receivable journal occurs after loan closure"], entries: [] }
    return { ...plan, planHash: digest(plan) }
  }
  const entries: PortfolioAccrualEntry[] = []
  let plannedBalance = new BigNumber(0)
  for (const date of checkpoints(loan.startDate, end, settlements.map((row) => row.date))) {
    const statement = buildLoanStatement({
      // The statement API requires createdAt only for display; it must not
      // determine any accounting date, especially for backdated loans.
      loan: { ...loan, createdAt: loan.startDate }, today: date,
      payments: payments.filter((row) => row.paymentDate <= date)
        .map((row) => ({ ...row, recorderName: "" })),
      waivers: waivers.filter((row) => row.waiverDate <= date) })
    const accrued = new BigNumber(statement.finalState.cumulativeInterestAccrued)
    const settled = new BigNumber(statement.finalState.cumulativeInterestPaid)
      .plus(statement.finalState.cumulativeInterestWaived)
    const desiredBalance = new BigNumber(statement.finalState.netAccruedUnpaidInterest)
    const recordedBalance = journals.filter((row) => row.date <= date)
      .reduce((sum, row) => row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
        new BigNumber(0))
    const existingReceivable = recordedBalance.plus(plannedBalance)
    const delta = desiredBalance.minus(existingReceivable)
    if (delta.isZero()) continue
    entries.push({ date, period: date.toISOString().slice(0, 7),
      accrued: money(accrued), settled: money(settled),
      existingReceivable: money(existingReceivable), delta: money(delta),
      resultingReceivable: money(desiredBalance) })
    plannedBalance = plannedBalance.plus(delta)
  }
  if (loan.status === "fully_paid") {
    const closing = buildLoanStatement({ loan: { ...loan, createdAt: loan.startDate }, today: end,
      payments: payments.filter((row) => row.paymentDate <= end)
        .map((row) => ({ ...row, recorderName: "" })),
      waivers: waivers.filter((row) => row.waiverDate <= end) })
    if (new BigNumber(closing.finalState.totalDue).gt(0)) {
      const blocked = { loanId: loan.id, asOf, policyVersion: POLICY_VERSION,
        inputFingerprint, classification: "blocked" as const,
        exceptions: ["Fully paid status does not reconcile to the closing statement"],
        entries: [] }
      return { ...blocked, planHash: digest(blocked) }
    }
  }
  const plan = { loanId: loan.id, asOf, policyVersion: POLICY_VERSION,
    inputFingerprint, classification: entries.length ? "ready" as const : "noop" as const,
    exceptions: [], entries }
  return { ...plan, planHash: digest(plan) }
}
