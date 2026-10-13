import BigNumber from "bignumber.js"
import { buildLoanStatement } from "@/lib/loan-statement"
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"
import { verifyRolloverCorrectionEvidence } from
  "@/lib/financial-corrections/rollover-verifier"
import { planRolloverCorrection, type ChainSnapshot } from "./rollover-correction"

export const ROLLOVER_PORTFOLIO_POLICY_VERSION = "portfolio-accrual-rollover-v1"

export type PortfolioRolloverJournal = {
  id: string; journalGroupId: string | null; loanId: string | null
  referenceType: string | null; referenceId: string | null
  categoryName: string; categoryType: string; type: "debit" | "credit"
  amount: string; transactionDate: Date; createdAt: Date
  description: string | null; recordedBy: string
  depositLocation: string | null; subLocationId: string | null
}

export type ArchivedRolloverRun = {
  id: string; chainRootId: string; planHash: string; inputFingerprint: string
  policyVersion: string; reviewedBy: string | null; agentReviewId: string | null
  appliedByAgent: string | null; appliedAt: Date
  beforeSummary: string; afterSummary: string
}

export type ArchivedRolloverReview = {
  id: string; kind: string; subjectId: string; planHash: string
  inputFingerprint: string; policyVersion: string; verdict: string
  reviewerAgentId: string; reviewedAt: Date
  consumedByRunId: string | null; consumedAt: Date | null
  evidenceJson: string; evidenceSha256: string
}

export type ArchivedPortfolioAccrualRun = {
  id: string; loanId: string; planHash: string; inputFingerprint: string
  policyVersion: string; agentReviewId: string | null; appliedByAgent: string | null
  backupSha256: string; beforeSummary: string; afterSummary: string; appliedAt: Date
}

export type PortfolioRolloverSource = {
  chain: ChainSnapshot
  journals: PortfolioRolloverJournal[]
  runs: ArchivedRolloverRun[]
  reviews: ArchivedRolloverReview[]
  portfolioRuns: ArchivedPortfolioAccrualRun[]
  portfolioReviews: ArchivedRolloverReview[]
}

export type PortfolioRolloverProof = {
  chainRootId: string; chainLoanIds: string[]
  openingPrincipal: string; closureDate: Date | null
  carriedInterest: string | null; accruedBeforeRollover: string | null
  minimumUplift: string | null; correctionRunIds: string[]
  settlementCorrectionGroupIds: string[]
  backupSha256s: string[]
}

type Term = { loanId: string; principalAmount: string; rolloverAmount: string }
type Allocation = { id: string; loanId: string; kind: "payment" | "waiver"
  interestPortion: string; principalPortion: string; overpaymentPortion: string }
type Summary = { loans: Term[]; settlements: Allocation[] }
type Leg = { loanId: string | null; referenceType: string; referenceId: string
  categoryName: string; type: "debit" | "credit"; amount: string; date: string }

const money = (value: BigNumber.Value) => new BigNumber(value).toFixed(2)
const key = (row: { loanId: string; id: string; kind: string }) =>
  `${row.loanId}:${row.kind}:${row.id}`

function amount(value: unknown): BigNumber {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) {
    throw new Error("Rollover archive contains an invalid money amount")
  }
  return new BigNumber(value)
}

/** A carried rollover may uplift earned interest, but may never erase it. */
export function assertRolloverCarryCoversAccrued(
  carriedInterest: string, accruedUnpaid: string,
): string {
  const uplift = amount(carriedInterest).minus(amount(accruedUnpaid))
  if (uplift.lt(0)) {
    throw new Error("Rollover carry is below accrued unpaid interest")
  }
  return money(uplift)
}

function summary(raw: string, successorIds: Set<string>, settlementIds: Set<string>): Summary {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error("Rollover correction summary is malformed") }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rollover correction summary is malformed")
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.loans) || !Array.isArray(record.settlements) ||
      record.loans.length !== successorIds.size ||
      record.settlements.length !== settlementIds.size) {
    throw new Error("Rollover correction summary has incomplete loan or settlement scope")
  }
  const loans = record.loans as Term[]
  const settlements = record.settlements as Allocation[]
  if (new Set(loans.map((row) => row.loanId)).size !== successorIds.size ||
      loans.some((row) => !successorIds.has(row.loanId) ||
        amount(row.principalAmount).lt(0) || amount(row.rolloverAmount).lt(0) ||
        amount(row.principalAmount).lt(row.rolloverAmount)) ||
      new Set(settlements.map(key)).size !== settlementIds.size ||
      settlements.some((row) => !settlementIds.has(key(row)) ||
        amount(row.interestPortion).lt(0) || amount(row.principalPortion).lt(0) ||
        amount(row.overpaymentPortion).lt(0))) {
    throw new Error("Rollover correction summary identities or amounts are invalid")
  }
  return { loans, settlements }
}

function signed(rows: PortfolioRolloverJournal[], category: string,
  positive: "debit" | "credit", loanId: string, referenceType: string,
  referenceId: string): BigNumber {
  return rows.filter((row) => row.categoryName === category && row.loanId === loanId &&
    row.referenceType === referenceType && row.referenceId === referenceId)
    .reduce((total, row) => row.type === positive
      ? total.plus(row.amount) : total.minus(row.amount), new BigNumber(0))
}

function leg(loanId: string | null, referenceType: string, referenceId: string,
  categoryName: string, delta: BigNumber, date: Date): Leg | null {
  if (delta.isZero()) return null
  return { loanId, referenceType, referenceId, categoryName,
    type: delta.gt(0) ? "credit" : "debit", amount: money(delta.abs()),
    date: date.toISOString() }
}

function groupKey(legs: Leg[]): string {
  return JSON.stringify(legs.map((row) => ({ ...row })).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))))
}

function sameTerms(a: Term[], b: Term[]): boolean {
  const byId = new Map(b.map((row) => [row.loanId, row]))
  return a.length === b.length && a.every((row) => {
    const other = byId.get(row.loanId)
    return other && amount(row.principalAmount).eq(other.principalAmount) &&
      amount(row.rolloverAmount).eq(other.rolloverAmount)
  })
}

function sameAllocations(a: Allocation[], b: Allocation[]): boolean {
  const byId = new Map(b.map((row) => [key(row), row]))
  return a.length === b.length && a.every((row) => {
    const other = byId.get(key(row))
    return other && amount(row.interestPortion).eq(other.interestPortion) &&
      amount(row.principalPortion).eq(other.principalPortion) &&
      amount(row.overpaymentPortion).eq(other.overpaymentPortion)
  })
}

function reviewedCheckpointsMatchEntries(
  evidence: unknown, entries: unknown[], loanId: string, asOf: string,
): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false
  const reviewed = evidence as Record<string, unknown>
  const checkpoints = reviewed.checkpoints
  if (reviewed.loanId !== loanId || reviewed.asOf !== asOf ||
      !Array.isArray(checkpoints) || checkpoints.length !== entries.length) return false
  const fields = ["date", "period", "accrued", "settled", "existingReceivable",
    "delta", "resultingReceivable", "capitalized"] as const
  return entries.every((entry, index) => {
    const checkpoint = checkpoints[index]
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !checkpoint || typeof checkpoint !== "object" ||
        Array.isArray(checkpoint)) return false
    const posted = entry as Record<string, unknown>
    const approved = checkpoint as Record<string, unknown>
    return fields.every((field) => posted[field] === approved[field])
  })
}

function provePriorPortfolioAccruals(source: PortfolioRolloverSource,
  journals: PortfolioRolloverJournal[], chainIds: Set<string>, asOf: Date): string[] {
  const runs = source.portfolioRuns
  const reviews = source.portfolioReviews
  const byRun = new Map(runs.map((run) => [run.id, run]))
  const byReview = new Map(reviews.map((review) => [review.id, review]))
  if (byRun.size !== runs.length || byReview.size !== reviews.length ||
      reviews.length !== runs.length || runs.some((run) => !chainIds.has(run.loanId))) {
    throw new Error("Prior portfolio run or review archive is incomplete")
  }
  const accrualRows = journals.filter((row) =>
    row.referenceType === "portfolio_accrual_repair")
  const groupIds = new Set(accrualRows.map((row) => row.journalGroupId))
  const usedGroups = new Set<string>()
  for (const run of runs) {
    const review = run.agentReviewId ? byReview.get(run.agentReviewId) : undefined
    let reviewEvidence: unknown
    try { reviewEvidence = JSON.parse(review?.evidenceJson ?? "") } catch { /* invalid */ }
    if (!run.appliedByAgent?.startsWith("agent:") ||
        !/^[a-f0-9]{64}$/.test(run.planHash) ||
        !/^[a-f0-9]{64}$/.test(run.inputFingerprint) ||
        !/^[a-f0-9]{64}$/.test(run.backupSha256) ||
        !Number.isFinite(run.appliedAt.getTime()) ||
        !review || review.kind !== "portfolio_accrual" ||
        review.subjectId !== run.loanId || review.planHash !== run.planHash ||
        review.inputFingerprint !== run.inputFingerprint ||
        review.policyVersion !== run.policyVersion || review.verdict !== "pass" ||
        !review.reviewerAgentId.startsWith("agent:") ||
        review.reviewerAgentId === run.appliedByAgent ||
        review.consumedByRunId !== run.id || !review.consumedAt ||
        !Number.isFinite(review.reviewedAt.getTime()) ||
        !Number.isFinite(review.consumedAt.getTime()) ||
        review.reviewedAt > run.appliedAt ||
        review.consumedAt < run.appliedAt ||
        reviewEvidence === undefined ||
        hashReviewEvidence(reviewEvidence) !== review.evidenceSha256) {
      throw new Error("Prior portfolio run or review is not independently attributed")
    }
    let before: unknown
    try { before = JSON.parse(run.beforeSummary) } catch { /* invalid */ }
    if (!before || typeof before !== "object" || Array.isArray(before)) {
      throw new Error("Prior portfolio run has no exact proposal entries")
    }
    const proposed = before as Record<string, unknown>
    const asOfText = proposed.asOf
    const entries = proposed.entries
    const runAsOf = typeof asOfText === "string" ? new Date(asOfText) : null
    if (!runAsOf || !Number.isFinite(runAsOf.getTime()) ||
        runAsOf.toISOString() !== asOfText || runAsOf > run.appliedAt ||
        !Array.isArray(entries) || !entries.length) {
      throw new Error("Prior portfolio run has no exact proposal entries")
    }
    if (!reviewedCheckpointsMatchEntries(reviewEvidence, entries,
      run.loanId, runAsOf.toISOString())) {
      throw new Error("Prior portfolio review checkpoints differ from posted proposal")
    }
    const expected: string[] = []
    for (const value of entries) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Prior portfolio run entry is malformed")
      }
      const entry = value as Record<string, unknown>
      const at = typeof entry.date === "string" ? new Date(entry.date) : null
      if (typeof entry.delta !== "string" ||
          !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(entry.delta)) {
        throw new Error("Prior portfolio run entry has an invalid delta")
      }
      const delta = new BigNumber(entry.delta)
      if (!at || !Number.isFinite(at.getTime()) ||
          at.toISOString() !== entry.date || at > runAsOf || at > asOf ||
          delta.isZero()) {
        throw new Error("Prior portfolio run entry is not dated or valued exactly")
      }
      expected.push(JSON.stringify({ date: at.toISOString(), amount: money(delta.abs()),
        receivableType: delta.gt(0) ? "debit" : "credit" }))
    }
    const actual: string[] = []
    for (const groupId of groupIds) {
      const rows = journals.filter((row) => row.journalGroupId === groupId)
      if (rows[0]?.referenceId !== run.id) continue
      const receivable = rows.find((row) => row.categoryName === "Interest Receivable")
      const earned = rows.find((row) => row.categoryName === "Interest Earned")
      if (!groupId || usedGroups.has(groupId) || rows.length !== 2 ||
          !receivable || !earned ||
          rows.some((row) => row.referenceType !== "portfolio_accrual_repair" ||
            row.referenceId !== run.id || row.loanId !== run.loanId ||
            row.createdAt.getTime() !== run.appliedAt.getTime() ||
            row.recordedBy !== run.appliedByAgent ||
            row.description !== `Portfolio interest repair ${run.id}` ||
            row.depositLocation !== null || row.subLocationId !== null) ||
          receivable.categoryType !== "asset" || earned.categoryType !== "revenue" ||
          receivable.transactionDate.getTime() !== earned.transactionDate.getTime() ||
          !amount(receivable.amount).eq(earned.amount) ||
          receivable.type === earned.type) {
        throw new Error("Prior portfolio journal is not exactly run-attributed")
      }
      usedGroups.add(groupId)
      actual.push(JSON.stringify({ date: receivable.transactionDate.toISOString(),
        amount: money(receivable.amount), receivableType: receivable.type }))
    }
    if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) {
      throw new Error("Prior portfolio journals differ from reviewed run entries")
    }
  }
  if (usedGroups.size !== groupIds.size) {
    throw new Error("Prior portfolio journal has no applied reviewed run")
  }
  return runs.map((run) => run.backupSha256).sort()
}

/** Archived v1-v3 rows are inputs to prove, never endorsements. */
export function provePortfolioRolloverSource(
  source: PortfolioRolloverSource, loanId: string, asOf: Date,
): PortfolioRolloverProof {
  const { chain, journals } = source
  const byId = new Map(chain.loans.map((loan) => [loan.id, loan]))
  if (!Number.isFinite(asOf.getTime()) || byId.size !== chain.loans.length ||
      !byId.has(loanId) || chain.loans.length < 2 || chain.loans.length > 4 ||
      chain.loans.some((loan) => loan.deletedAt || loan.loanType !== "perpetual" ||
        loan.rateChanges.length || loan.penaltyWaived || loan.sourceExceptions?.length ||
        !/^[a-f0-9]{64}$/.test(loan.sourceDigest ?? ""))) {
    throw new Error("Rollover accrual requires a complete, unchanged perpetual chain")
  }
  const ordered = [...chain.loans].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  if (ordered[0].rolledOverFrom || ordered.at(-1)?.status !== "active" ||
      ordered.slice(0, -1).some((loan, index) => loan.status !== "rolled_over" ||
        ordered[index + 1].rolledOverFrom !== loan.id ||
        ordered[index + 1].startDate <= loan.startDate) ||
      asOf < ordered.at(-1)!.startDate) {
    throw new Error("Rollover accrual chain path, statuses, or dates are ambiguous")
  }
  const rootId = ordered[0].id
  const successorIds = new Set(ordered.slice(1).map((loan) => loan.id))
  const settlementRows = ordered.flatMap((loan) => [
    ...loan.payments.map((row) => ({ loanId: loan.id, kind: "payment" as const,
      id: row.id, amount: row.amount, date: row.paymentDate,
      interestPortion: row.interestPortion, principalPortion: row.principalPortion,
      overpaymentPortion: row.overpaymentPortion ?? "0" })),
    ...loan.waivers.map((row) => ({ loanId: loan.id, kind: "waiver" as const,
      id: row.id!, amount: row.amount, date: row.waiverDate,
      interestPortion: row.interestPortion, principalPortion: row.principalPortion,
      overpaymentPortion: "0" })),
  ])
  const settlementById = new Map(settlementRows.map((row) => [key(row), row]))
  if (settlementById.size !== settlementRows.length ||
      settlementRows.some((row) => !row.id || row.date > asOf ||
        !amount(row.interestPortion).plus(row.principalPortion)
          .plus(row.overpaymentPortion).eq(row.amount)) ||
      journals.some((row) => !row.journalGroupId ||
        row.loanId !== null && !byId.has(row.loanId) ||
        row.loanId === null && row.categoryName !== "Cash" &&
          row.categoryName !== "Loan Losses")) {
    throw new Error("Rollover accrual settlement or journal source is incomplete")
  }
  const allGroups = new Set(journals.map((row) => row.journalGroupId))
  if ([...allGroups].some((groupId) => !journals.some((row) =>
    row.journalGroupId === groupId && row.loanId !== null && byId.has(row.loanId)))) {
    throw new Error("Rollover source has an orphan reference journal group")
  }
  const categoryTypes: Record<string, string> = {
    Cash: "asset", "Loans Receivable": "asset", "Interest Receivable": "asset",
    "Interest Earned": "revenue", "Issuance Fees": "revenue",
    "Overpayment Revenue": "revenue", "Loan Losses": "expense",
  }
  if (journals.some((row) => categoryTypes[row.categoryName] !== row.categoryType) ||
      journals.some((row) => row.referenceType === "payment_reversal" ||
        row.referenceType === "loan_waiver_reversal")) {
    throw new Error("Rollover accrual source has unsupported category or reversal history")
  }
  // Later receivable repairs are distinct from rollover carry, but still need
  // their own exact applied-run/review/entry/ledger chain before exclusion.
  const portfolioBackups = provePriorPortfolioAccruals(source, journals,
    new Set(byId.keys()), asOf)
  const carryJournals = journals.filter((row) =>
    row.referenceType !== "portfolio_accrual_repair")
  const plan = planRolloverCorrection(chain, "v4")
  const evidence = verifyRolloverCorrectionEvidence(chain, plan, carryJournals)
  for (const [edgeIndex, edge] of evidence.edges.entries()) {
    const predecessor = ordered[edgeIndex]
    const rolloverDate = ordered[edgeIndex + 1].startDate
    const statement = buildLoanStatement({ loan: { ...predecessor,
      createdAt: predecessor.createdAt }, payments: predecessor.payments.map((row) =>
      ({ ...row, recorderName: "" })), waivers: predecessor.waivers,
    today: rolloverDate })
    if (!edge.carriedInterest) throw new Error("Rollover interest carry is missing")
    assertRolloverCarryCoversAccrued(edge.carriedInterest,
      statement.finalState.netAccruedUnpaidInterest)
  }
  if (plan.classification === "blocked" || plan.edges.length !== ordered.length - 1 ||
      plan.edges.some((edge) => !amount(edge.deltaPrincipal).isZero() ||
        !amount(edge.proposedRolloverAmount).eq(edge.originalRolloverAmount)) ||
      plan.settlementChanges.some((row) => !amount(row.oldInterest).eq(row.newInterest) ||
        !amount(row.oldPrincipal).eq(row.newPrincipal) ||
        !amount(row.oldOverpayment).eq(row.newOverpayment)) ||
      evidence.edges.length !== ordered.length - 1 ||
      evidence.projectedJournalGroups.some((group) => group.legs.some((row) =>
        amount(row.amount).gte(1)))) {
    throw new Error("Rollover carry, closure, or settlement is not a corrected no-op")
  }
  const runs = [...source.runs].sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime())
  if (!runs.length || new Set(runs.map((run) => run.id)).size !== runs.length ||
      runs.some((run, index) => index > 0 &&
        run.appliedAt <= runs[index - 1].appliedAt) ||
      runs.some((run) => run.chainRootId !== rootId ||
        !["v1", "v2", "v3", "v4"].includes(run.policyVersion) ||
        (run.policyVersion === "v4") !== !!run.agentReviewId ||
        !/^[a-f0-9]{64}$/.test(run.planHash) ||
        !/^[a-f0-9]{64}$/.test(run.inputFingerprint) ||
        !Number.isFinite(run.appliedAt.getTime()) || run.appliedAt > asOf ||
        run.appliedAt < ordered.at(-1)!.startDate)) {
    throw new Error("Rollover correction run archive is missing or misattributed")
  }
  const reviewById = new Map(source.reviews.map((review) => [review.id, review]))
  if (reviewById.size !== source.reviews.length ||
      source.reviews.length !== runs.filter((run) => run.agentReviewId).length) {
    throw new Error("Rollover correction agent-review archive is incomplete")
  }
  const groups = new Map<string, PortfolioRolloverJournal[]>()
  for (const row of carryJournals) {
    const group = groups.get(row.journalGroupId!) ?? []
    group.push(row)
    groups.set(row.journalGroupId!, group)
  }
  const original = carryJournals.filter((row) =>
    !row.description?.startsWith("Non-cash rollover correction ") &&
    !row.description?.startsWith("Non-cash settlement reclassification "))
  if (carryJournals.some((row) => row.description?.startsWith("Non-cash ") &&
      original.includes(row))) {
    throw new Error("Unattributed non-cash rollover journal")
  }
  const initialTerms: Term[] = ordered.slice(1).map((loan) => {
    const prior = loan.rolledOverFrom!
    const carried = signed(original, "Loans Receivable", "debit", loan.id,
      "rollover", prior)
    // Archived v1-v3 plans stored whole-UGX terms while original transfer
    // journals could retain sub-UGX cents. Reconstruct that same rounding;
    // subsequent correction legs are still compared at exact cents.
    return { loanId: loan.id,
      rolloverAmount: money(carried.toFixed(0, BigNumber.ROUND_HALF_UP)),
      principalAmount: money(carried.plus(amount(loan.principalAmount)
        .minus(amount(loan.rolloverAmount ?? "0")))
        .toFixed(0, BigNumber.ROUND_HALF_UP)) }
  })
  for (const successor of ordered.slice(1)) {
    const predecessor = successor.rolledOverFrom!
    const originalGroups = [...groups.entries()].filter(([, rows]) =>
      rows.some((row) => original.includes(row) && row.referenceType === "rollover" &&
        ((row.loanId === successor.id && row.referenceId === predecessor) ||
          (row.loanId === predecessor && row.referenceId === successor.id))))
    const interest = signed(original, "Interest Earned", "credit", successor.id,
      "rollover", predecessor)
    const principal = signed(original, "Loans Receivable", "credit", predecessor,
      "rollover", successor.id)
    const expected = [
      groupKey([
        { loanId: successor.id, referenceType: "rollover", referenceId: predecessor,
          categoryName: "Loans Receivable", type: "debit", amount: money(principal),
          date: successor.startDate.toISOString() },
        { loanId: predecessor, referenceType: "rollover", referenceId: successor.id,
          categoryName: "Loans Receivable", type: "credit", amount: money(principal),
          date: successor.startDate.toISOString() },
      ]),
      groupKey([
        { loanId: successor.id, referenceType: "rollover", referenceId: predecessor,
          categoryName: "Loans Receivable", type: "debit", amount: money(interest),
          date: successor.startDate.toISOString() },
        { loanId: successor.id, referenceType: "rollover", referenceId: predecessor,
          categoryName: "Interest Earned", type: "credit", amount: money(interest),
          date: successor.startDate.toISOString() },
      ]),
    ].sort()
    const actual = originalGroups.map(([, rows]) => groupKey(rows.map((row) => ({
      loanId: row.loanId, referenceType: row.referenceType!, referenceId: row.referenceId!,
      categoryName: row.categoryName, type: row.type, amount: money(row.amount),
      date: row.transactionDate.toISOString(),
    })))).sort()
    if (principal.lte(0) || interest.lte(0) ||
        JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Original rollover transfer journal groups are incomplete or ambiguous")
    }
  }
  const initialAllocations: Allocation[] = settlementRows.map((row) => {
    const referenceType = row.kind === "payment" ? "payment" : "loan_waiver"
    const values = ["Interest Earned", "Loans Receivable", "Overpayment Revenue"]
      .map((category) => signed(original, category, "credit", row.loanId,
        referenceType, row.id))
    return { id: row.id, loanId: row.loanId, kind: row.kind,
      interestPortion: money(values[0]), principalPortion: money(values[1]),
      overpaymentPortion: money(values[2]) }
  })
  let previousTerms = initialTerms
  let previousAllocations = initialAllocations
  const running = [...original]
  const usedGroups = new Set<string>()
  for (const run of runs) {
    const actor = run.agentReviewId ? run.appliedByAgent : run.reviewedBy
    if (!actor || run.agentReviewId && (run.reviewedBy ||
        !run.appliedByAgent?.startsWith("agent:")) ||
        !run.agentReviewId && (run.appliedByAgent || !run.reviewedBy)) {
      throw new Error("Rollover correction run actor is ambiguous")
    }
    if (run.agentReviewId) {
      const review = reviewById.get(run.agentReviewId)
      let reviewedEvidence: unknown
      try { reviewedEvidence = JSON.parse(review?.evidenceJson ?? "") } catch { /* invalid */ }
      if (!review || review.kind !== "rollover_correction" ||
          review.subjectId !== rootId || review.planHash !== run.planHash ||
          review.inputFingerprint !== run.inputFingerprint ||
          review.policyVersion !== run.policyVersion || review.verdict !== "pass" ||
          !review.reviewerAgentId.startsWith("agent:") ||
          review.reviewerAgentId === actor || review.consumedByRunId !== run.id ||
          !review.consumedAt || !Number.isFinite(review.consumedAt.getTime()) ||
          !Number.isFinite(review.reviewedAt.getTime()) ||
          review.reviewedAt > run.appliedAt ||
          review.consumedAt < run.appliedAt || review.consumedAt > asOf ||
          reviewedEvidence === undefined ||
          hashReviewEvidence(reviewedEvidence) !== review.evidenceSha256) {
        throw new Error("Rollover agent review archive is misattributed")
      }
    }
    const before = summary(run.beforeSummary, successorIds, new Set(settlementById.keys()))
    const after = summary(run.afterSummary, successorIds, new Set(settlementById.keys()))
    if (run.policyVersion === "v4" &&
        !/^[a-f0-9]{64}$/.test((JSON.parse(run.beforeSummary) as {
          backupSha256?: string }).backupSha256 ?? "")) {
      throw new Error("Agent rollover run has no verified backup attribution")
    }
    if (!sameTerms(before.loans, previousTerms) ||
        !sameAllocations(before.settlements, previousAllocations) ||
        after.loans.some((term) => {
          const prior = before.loans.find((row) => row.loanId === term.loanId)!
          return !amount(term.principalAmount).minus(term.rolloverAmount)
            .eq(amount(prior.principalAmount).minus(prior.rolloverAmount))
        }) ||
        after.settlements.some((row) => {
          const settlement = settlementById.get(key(row))!
          return !amount(row.interestPortion).plus(row.principalPortion)
            .plus(row.overpaymentPortion).eq(settlement.amount)
        })) {
      throw new Error("Rollover correction summaries do not form a continuous ledger history")
    }
    const expected: Leg[][] = []
    for (const row of after.settlements) {
      const prior = before.settlements.find((item) => key(item) === key(row))!
      const settlement = settlementById.get(key(row))!
      const referenceType = row.kind === "payment" ? "payment" : "loan_waiver"
      const legs = ([
        ["Interest Earned", "interestPortion"],
        ["Loans Receivable", "principalPortion"],
        ["Overpayment Revenue", "overpaymentPortion"],
      ] as const).map(([category, field]) => leg(row.loanId, referenceType, row.id,
        category, amount(row[field]).minus(prior[field]), settlement.date))
        .filter((value): value is Leg => value !== null)
      if (legs.length) expected.push(legs)
    }
    for (const successor of ordered.slice(1)) {
      const term = after.loans.find((row) => row.loanId === successor.id)!
      const predecessor = byId.get(successor.rolledOverFrom!)!
      const predecessorTerm = after.loans.find((row) => row.loanId === predecessor.id)
      const predecessorPrincipal = amount(predecessorTerm?.principalAmount ??
        predecessor.principalAmount)
      const principalSettled = after.settlements.filter((row) => row.loanId === predecessor.id)
        .reduce((sum, row) => sum.plus(row.principalPortion), new BigNumber(0))
      const targetPrincipal = predecessorPrincipal.minus(principalSettled)
      const targetInterest = amount(term.rolloverAmount).minus(targetPrincipal)
      if (targetPrincipal.lt(0) || targetInterest.lt(0)) {
        throw new Error("Rollover correction summary creates a negative carry")
      }
      const oldPrincipal = signed(running, "Loans Receivable", "credit",
        predecessor.id, "rollover", successor.id)
      const oldInterest = signed(running, "Interest Earned", "credit",
        successor.id, "rollover", predecessor.id)
      const principalDelta = targetPrincipal.minus(oldPrincipal)
      const interestDelta = targetInterest.minus(oldInterest)
      const at = successor.startDate
      if (!interestDelta.isZero()) expected.push([
        leg(successor.id, "rollover", predecessor.id, "Loans Receivable",
          interestDelta, at)!,
        leg(successor.id, "rollover", predecessor.id, "Interest Earned",
          interestDelta, at)!,
      ].map((row, index) => index === 0 ? { ...row,
        type: row.type === "credit" ? "debit" as const : "credit" as const } : row))
      if (!principalDelta.isZero()) expected.push([
        leg(successor.id, "rollover", predecessor.id, "Loans Receivable",
          principalDelta, at)!,
        leg(predecessor.id, "rollover", successor.id, "Loans Receivable",
          principalDelta, at)!,
      ].map((row, index) => index === 0 ? { ...row,
        type: row.type === "credit" ? "debit" as const : "credit" as const } : row))
    }
    const actual = [...groups.entries()].filter(([, rows]) => rows.some((row) =>
      row.description?.endsWith(` ${run.id}`) && row.description.startsWith("Non-cash ")))
    for (const [groupId, rows] of actual) {
      if (usedGroups.has(groupId) || rows.length < 2 || rows.length > 3 ||
          rows.some((row) => row.description !==
              (row.referenceType === "rollover"
                ? `Non-cash rollover correction ${run.id}`
                : `Non-cash settlement reclassification ${run.id}`) ||
            row.recordedBy !== actor ||
            row.createdAt.getTime() !== run.appliedAt.getTime() ||
            row.depositLocation !== null || row.subLocationId !== null ||
            !["Loans Receivable", "Interest Earned", "Overpayment Revenue"]
              .includes(row.categoryName) ||
            row.categoryType !== (row.categoryName === "Loans Receivable"
              ? "asset" : "revenue"))) {
        throw new Error("Rollover correction journal is not exactly run-attributed")
      }
      usedGroups.add(groupId)
    }
    const actualKeys = actual.map(([, rows]) => groupKey(rows.map((row) => ({
      loanId: row.loanId, referenceType: row.referenceType!, referenceId: row.referenceId!,
      categoryName: row.categoryName, type: row.type, amount: money(row.amount),
      date: row.transactionDate.toISOString(),
    })))).sort()
    if (JSON.stringify(actualKeys) !== JSON.stringify(expected.map(groupKey).sort())) {
      throw new Error("Rollover correction journal deltas differ from archived summaries")
    }
    running.push(...actual.flatMap(([, rows]) => rows))
    previousTerms = after.loans
    previousAllocations = after.settlements
  }
  const correctionGroups = [...groups.entries()].filter(([, rows]) => rows.some((row) =>
    row.description?.startsWith("Non-cash rollover correction ") ||
    row.description?.startsWith("Non-cash settlement reclassification ")))
  if (correctionGroups.length !== usedGroups.size ||
      !sameTerms(previousTerms, ordered.slice(1).map((loan) => ({ loanId: loan.id,
        principalAmount: loan.principalAmount, rolloverAmount: loan.rolloverAmount ?? "0" }))) ||
      !sameAllocations(previousAllocations, settlementRows.map((row) => ({
        id: row.id, loanId: row.loanId, kind: row.kind,
        interestPortion: row.interestPortion, principalPortion: row.principalPortion,
        overpaymentPortion: row.overpaymentPortion,
      })))) {
    throw new Error("Rollover correction archive does not reach the current source ledger")
  }
  const index = ordered.findIndex((loan) => loan.id === loanId)
  const loan = ordered[index]
  const closureDate = index < ordered.length - 1 ? ordered[index + 1].startDate : null
  const carriedInterest = closureDate ? evidence.edges[index].carriedInterest : null
  let accruedBeforeRollover: string | null = null
  let minimumUplift: string | null = null
  if (closureDate && carriedInterest) {
    const statement = buildLoanStatement({ loan: { ...loan, createdAt: loan.createdAt },
      payments: loan.payments.map((row) => ({ ...row, recorderName: "" })),
      waivers: loan.waivers, today: closureDate })
    accruedBeforeRollover = money(statement.finalState.netAccruedUnpaidInterest)
    minimumUplift = assertRolloverCarryCoversAccrued(carriedInterest,
      accruedBeforeRollover)
  }
  return { chainRootId: rootId, chainLoanIds: ordered.map((row) => row.id),
    openingPrincipal: money(loan.principalAmount), closureDate, carriedInterest,
    accruedBeforeRollover, minimumUplift, correctionRunIds: runs.map((run) => run.id),
    settlementCorrectionGroupIds: correctionGroups.filter(([, rows]) =>
      rows[0].referenceType === "payment" || rows[0].referenceType === "loan_waiver")
      .map(([groupId]) => groupId).sort(),
    backupSha256s: [...portfolioBackups, ...runs.filter((run) =>
      run.policyVersion === "v4").map((run) =>
      (JSON.parse(run.beforeSummary) as { backupSha256: string }).backupSha256)].sort() }
}
