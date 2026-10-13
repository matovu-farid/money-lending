import BigNumber from "bignumber.js"
import { createHash } from "node:crypto"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { auditLog } from "@/lib/db/schema/audit"
import { historicalRateRepairRuns } from "@/lib/db/schema/historical-rate-repair-runs"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { rolloverCorrectionRuns } from "@/lib/db/schema/rollover-correction-runs"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { buildLoanStatement } from "@/lib/loan-statement"
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"
import { normalizedHistoricalJournalEffects, type HistoricalRateEvidence } from
  "@/lib/financial-corrections/historical-rate-verifier"
import { planPortfolioAccrualRepair, type PortfolioAccrualPlan } from
  "@/lib/interest/portfolio-accrual-repair"
import { historicalRateCorrectionExceptions } from
  "@/lib/interest/portfolio-accrual-repair"
import { provePortfolioRolloverSource, type PortfolioRolloverSource } from
  "@/lib/interest/portfolio-rollover-proof"
import type { AttributedPortfolioAccrualSnapshot } from
  "@/lib/financial-corrections/portfolio-verifier"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger } from "./ledger-queries.service"
import { loadRolloverCorrectionPlansInSnapshot } from "./rollover-correction.service"

type QueryDb = Pick<typeof db, "select">

function net(rows: Array<{ type: "debit" | "credit"; amount: string }>): BigNumber {
  return rows.reduce((sum, row) => row.type === "debit"
    ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0))
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function rateTermsEdited(value: string | null): boolean {
  if (!value) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      ["interestRate", "interestRateOverride", "startDate", "principalAmount",
        "penaltyMultiplier", "penaltyWaived", "minInterestDays"].some((key) =>
        Object.hasOwn(parsed, key))
  } catch { return true }
}

type HistoryPayment = {
  id: string; loanId: string; amount: string; paymentDate: Date
  deletedAt: Date | null; markedWrong: boolean
  depositLocation: string; subLocationId: string | null
}

type HistoryJournal = {
  id: string; loanId: string | null; referenceType: string | null
  referenceId: string | null; journalGroupId: string | null
  date: Date; createdAt: Date; type: "debit" | "credit"; amount: string
  categoryId: string; categoryName: string; categoryType: string
  depositLocation: string | null; subLocationId: string | null
  description?: string | null; recordedBy?: string
}

type HistoryAudit = {
  action: string; entityType: string; entityId: string
  beforeValue: string | null; afterValue: string | null; occurredAt: Date
}

type PaymentHistoryInput = {
  payment: HistoryPayment; journalRows: HistoryJournal[]
  groupRows: HistoryJournal[]; auditRows: HistoryAudit[]
  rateProof?: RateReclassificationProof
  rolloverGroupIds?: Set<string>
}

type RateReclassificationProof = {
  run: { id: string; loanId: string; planHash: string; inputFingerprint: string
    policyVersion: string; agentReviewId: string | null; appliedByAgent: string | null
    appliedAt: Date; beforeSummary: string }
  review: { id: string; kind: string; subjectId: string; planHash: string
    inputFingerprint: string; policyVersion: string; verdict: string
    reviewerAgentId: string; consumedAt: Date | null; consumedByRunId: string | null
    evidenceJson: string; evidenceSha256: string }
}

type RateEffect = HistoricalRateEvidence["expectedEntries"][number]

type AuditedPayment = {
  id: string; loanId: string; amount: string; paymentDate: string
  deletedAt: string | null; depositLocation: string; subLocationId: string | null
}

function auditedPayment(value: string | null): AuditedPayment | null {
  if (!value) return null
  try {
    const row: unknown = JSON.parse(value)
    if (!row || typeof row !== "object" || Array.isArray(row)) return null
    const data = row as Record<string, unknown>
    if (typeof data.id !== "string" || typeof data.loanId !== "string" ||
        typeof data.amount !== "string" || typeof data.paymentDate !== "string" ||
        typeof data.depositLocation !== "string" ||
        !(data.deletedAt === null || typeof data.deletedAt === "string") ||
        !(data.subLocationId === null || typeof data.subLocationId === "string")) {
      return null
    }
    return data as AuditedPayment
  } catch { return null }
}

function sameAuditedPayment(a: AuditedPayment, b: AuditedPayment): boolean {
  return a.id === b.id && a.loanId === b.loanId &&
    new BigNumber(a.amount).eq(b.amount) && a.paymentDate === b.paymentDate &&
    a.depositLocation === b.depositLocation && a.subLocationId === b.subLocationId
}

function paymentAuditMatches(row: AuditedPayment, payment: HistoryPayment): boolean {
  return row.id === payment.id && row.loanId === payment.loanId &&
    new BigNumber(row.amount).eq(payment.amount) &&
    row.paymentDate === payment.paymentDate.toISOString() &&
    row.depositLocation === payment.depositLocation &&
    row.subLocationId === payment.subLocationId
}

function opposite(a: HistoryJournal, b: HistoryJournal): boolean {
  return a.loanId === b.loanId && a.referenceId === b.referenceId &&
    a.categoryId === b.categoryId && a.date.getTime() === b.date.getTime() &&
    a.depositLocation === b.depositLocation && a.subLocationId === b.subLocationId &&
    new BigNumber(a.amount).eq(b.amount) && a.type !== b.type
}

/** Prove a payment's superseded journals cancel exactly before accepting its current facts. */
export function provePaymentJournalHistory(input: PaymentHistoryInput): string[] {
  const { payment, groupRows } = input
  const rows = input.journalRows.filter((row) => row.referenceId === payment.id)
  const issues: string[] = []
  if (payment.markedWrong) return ["Marked-wrong payment requires historical review"]
  if (!rows.length || rows.some((row) => row.loanId !== payment.loanId ||
      !["payment", "payment_reversal"].includes(row.referenceType ?? ""))) {
    return ["Payment journal history is missing or misattributed"]
  }
  for (const row of rows) {
    const group = groupRows.filter((item) => item.journalGroupId === row.journalGroupId)
    const cash = group.find((item) => item.categoryName === "Cash")
    if (!row.journalGroupId || group.length !== 2 || !cash ||
        group.some((item) => item.loanId !== payment.loanId ||
          item.referenceId !== payment.id || item.referenceType !== row.referenceType ||
          item.date.getTime() !== row.date.getTime() ||
          !new BigNumber(item.amount).eq(row.amount)) ||
        group[0].type === group[1].type ||
        group[0].categoryId === group[1].categoryId ||
        group.some((item) => item.categoryName === "Cash"
          ? item.categoryType !== "asset"
          : item.categoryName === "Loans Receivable"
            ? item.categoryType !== "asset" : item.categoryType !== "revenue") ||
        group.some((item) => item.categoryName !== "Cash" &&
          !["Interest Earned", "Loans Receivable", "Overpayment Revenue"]
            .includes(item.categoryName)) ||
        cash.type !== (row.referenceType === "payment" ? "debit" : "credit") ||
        cash.depositLocation !== payment.depositLocation ||
        cash.subLocationId !== payment.subLocationId ||
        group.some((item) => item.categoryName !== "Cash" &&
          (item.depositLocation !== null || item.subLocationId !== null))) {
      issues.push(`Payment journal group ${row.journalGroupId ?? row.id} is not an attributed pair`)
    }
  }
  const original = rows.filter((row) => row.referenceType === "payment")
  const reversals = rows.filter((row) => row.referenceType === "payment_reversal")
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const remaining = [...original]
  for (const reversal of reversals) {
    const index = remaining.findIndex((row) =>
      row.createdAt <= reversal.createdAt && opposite(row, reversal))
    if (index < 0) issues.push(`Payment reversal ${reversal.id} has no exact original`)
    else remaining.splice(index, 1)
  }
  const audits = input.auditRows.filter((row) => row.entityType === "payment" &&
    row.entityId === payment.id)
  if (payment.deletedAt) {
    const deletions = audits.filter((row) => row.action === "payment.delete")
    const deletion = deletions.length === 1 ? deletions[0] : null
    const before = auditedPayment(deletion?.beforeValue ?? null)
    const after = auditedPayment(deletion?.afterValue ?? null)
    if (!deletion || !before || !after || before.deletedAt !== null ||
        after.deletedAt !== payment.deletedAt.toISOString() ||
        !sameAuditedPayment(before, after) ||
        !paymentAuditMatches(after, payment)) {
      issues.push("Deleted payment has no matching payment.delete audit")
    }
    if (!original.length || !reversals.length || remaining.length) {
      issues.push("Deleted payment journal is not exactly reversed")
    }
    // Edit-then-delete remains blocked until the entire audit/journal chain can be proved.
    if (audits.some((row) => row.action === "payment.update") ||
        rows.some((row) => row.date.getTime() !== payment.paymentDate.getTime())) {
      issues.push("Deleted payment has edited or off-date history requiring separate review")
    }
    if (!net(original.filter((row) => row.categoryName === "Cash"))
      .eq(payment.amount)) {
      issues.push("Deleted payment original Cash does not match its amount")
    }
  } else {
    const offDates = [...new Set(rows.filter((row) =>
      row.date.getTime() !== payment.paymentDate.getTime())
      .map((row) => row.date.toISOString()))]
    if (offDates.length) {
      const updates = audits.filter((row) => row.action === "payment.update")
        .toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      const parsed = updates.map((row) => ({
        before: auditedPayment(row.beforeValue), after: auditedPayment(row.afterValue),
      }))
      if (!parsed.length || parsed.some((row) => !row.before || !row.after ||
          row.before.deletedAt !== null || row.after.deletedAt !== null ||
          row.before.id !== payment.id || row.after.id !== payment.id ||
          row.before.loanId !== payment.loanId || row.after.loanId !== payment.loanId ||
          row.before.depositLocation !== payment.depositLocation ||
          row.after.depositLocation !== payment.depositLocation ||
          row.before.subLocationId !== payment.subLocationId ||
          row.after.subLocationId !== payment.subLocationId) ||
          parsed.some((row, index) => index > 0 &&
            !sameAuditedPayment(parsed[index - 1].after!, row.before!)) ||
          !paymentAuditMatches(parsed.at(-1)!.after!, payment) ||
          offDates.some((date) => !parsed.some((row) =>
            row.before?.paymentDate === date || row.after?.paymentDate === date))) {
        issues.push("Payment date history has no coherent payment.update audit")
      }
      for (const date of offDates) {
        const originalCash = original.filter((row) =>
          row.categoryName === "Cash" && row.date.toISOString() === date)
        if (!parsed.some((row) => row.before?.paymentDate === date &&
            net(originalCash).eq(row.before.amount))) {
          issues.push(`Payment historical Cash at ${date} does not match its audit`)
        }
      }
    }
    if (!remaining.length || remaining.some((row) =>
      row.date.getTime() !== payment.paymentDate.getTime()) ||
        remaining.filter((row) => row.categoryName === "Cash")
          .some((row) => row.type !== "debit") ||
        !net(remaining.filter((row) => row.categoryName === "Cash"))
          .eq(payment.amount)) {
      issues.push("Payment Cash journal does not match amount and effective date")
    }
  }
  return issues
}

/** Every payment journal on this loan must resolve to a loaded payment record. */
export function unresolvedPaymentJournalExceptions(
  loanId: string,
  paymentIds: string[],
  journalRows: Array<{ id: string; loanId: string | null;
    referenceType: string | null; referenceId: string | null }>,
): string[] {
  const known = new Set(paymentIds)
  return journalRows.filter((row) => row.loanId === loanId &&
    (row.referenceType === "payment" || row.referenceType === "payment_reversal") &&
    (!row.referenceId || !known.has(row.referenceId)))
    .map((row) => `Payment journal ${row.id} has no loaded payment row`)
}

function reviewedRatePaymentEffects(
  payment: HistoryPayment, proof: RateReclassificationProof,
): RateEffect[] | null {
  const { run, review } = proof
  if (run.loanId !== payment.loanId || run.policyVersion !== "v2" ||
      !run.planHash || !run.inputFingerprint || !run.appliedByAgent?.startsWith("agent:") ||
      !(run.appliedAt instanceof Date) || !Number.isFinite(run.appliedAt.getTime()) ||
      review.id !== run.agentReviewId || review.kind !== "historical_rate" ||
      review.subjectId !== run.loanId || review.planHash !== run.planHash ||
      review.inputFingerprint !== run.inputFingerprint ||
      review.policyVersion !== run.policyVersion || review.verdict !== "pass" ||
      !review.reviewerAgentId.startsWith("agent:") ||
      review.reviewerAgentId === run.appliedByAgent ||
      review.consumedByRunId !== run.id ||
      !(review.consumedAt instanceof Date) ||
      !Number.isFinite(review.consumedAt.getTime())) return null
  try {
    const evidence: unknown = JSON.parse(review.evidenceJson)
    const before: unknown = JSON.parse(run.beforeSummary)
    if (hashReviewEvidence(evidence) !== review.evidenceSha256 ||
        !evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
        !before || typeof before !== "object" || Array.isArray(before)) return null
    const reviewed = evidence as Record<string, unknown>
    const plan = before as Record<string, unknown>
    if (reviewed.loanId !== payment.loanId ||
        !Array.isArray(reviewed.expectedEntries) ||
        plan.loanId !== run.loanId || plan.planHash !== run.planHash ||
        plan.inputFingerprint !== run.inputFingerprint ||
        plan.policyVersion !== run.policyVersion || plan.classification !== "review" ||
        !Array.isArray(plan.changes)) return null
    const expected: RateEffect[] = []
    for (const value of reviewed.expectedEntries) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null
      const entry = value as Record<string, unknown>
      if (typeof entry.categoryName !== "string" ||
          (entry.type !== "debit" && entry.type !== "credit") ||
          typeof entry.amount !== "string" || typeof entry.referenceType !== "string" ||
          typeof entry.referenceId !== "string" || typeof entry.date !== "string") return null
      if (entry.referenceType === "payment") expected.push(entry as RateEffect)
    }
    const derived: RateEffect[] = []
    const seen = new Set<string>()
    for (const value of plan.changes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null
      const change = value as Record<string, unknown>
      if (change.kind !== "payment" && change.kind !== "waiver") return null
      if (change.kind !== "payment") continue
      if (typeof change.id !== "string" || seen.has(change.id) ||
          typeof change.date !== "string" || !Number.isFinite(Date.parse(change.date)) ||
          new Date(change.date).toISOString() !== change.date ||
          typeof change.amount !== "string") return null
      seen.add(change.id)
      const oldValues = [change.oldInterest, change.oldPrincipal, change.oldOverpayment]
      const newValues = [change.newInterest, change.newPrincipal, change.newOverpayment]
      if ([...oldValues, ...newValues].some((part) => typeof part !== "string" ||
          !new BigNumber(part).isFinite() || new BigNumber(part).lt(0) ||
          (new BigNumber(part).decimalPlaces() ?? Infinity) > 2)) return null
      const oldTotal = oldValues.reduce<BigNumber>((sum, part) =>
        sum.plus(part as string), new BigNumber(0))
      const newTotal = newValues.reduce<BigNumber>((sum, part) =>
        sum.plus(part as string), new BigNumber(0))
      if (!oldTotal.eq(change.amount) || !newTotal.eq(change.amount)) return null
      if (change.id === payment.id &&
          (!newTotal.eq(payment.amount) || change.date !== payment.paymentDate.toISOString())) {
        return null
      }
      for (const [index, categoryName] of ["Interest Earned", "Loans Receivable",
        "Overpayment Revenue"].entries()) {
        const delta = new BigNumber(newValues[index] as string)
          .minus(oldValues[index] as string)
        if (delta.isZero()) continue
        derived.push({ categoryName, type: delta.gt(0) ? "credit" : "debit",
          amount: delta.abs().toFixed(2), referenceType: "payment",
          referenceId: change.id, date: change.date })
      }
    }
    if (JSON.stringify(normalizedHistoricalJournalEffects(expected)) !==
        JSON.stringify(normalizedHistoricalJournalEffects(derived))) return null
    return expected.filter((row) => row.referenceId === payment.id)
  } catch { return null }
}

function rateReclassificationExceptions(
  input: PaymentHistoryInput, rows: HistoryJournal[],
): string[] {
  const { payment, rateProof } = input
  if (!rows.length) return []
  const expected = rateProof && reviewedRatePaymentEffects(payment, rateProof)
  if (!expected) return ["Non-Cash payment journals lack linked reviewed rate effects"]
  const groups = new Set(rows.map((row) => row.journalGroupId))
  for (const groupId of groups) {
    const group = input.groupRows.filter((row) => row.journalGroupId === groupId)
    const matching = rows.filter((row) => row.journalGroupId === groupId)
    if (!groupId || group.length !== matching.length ||
        group.length < 2 || group.length > 3 ||
        !net(group).isZero() ||
        new Set(group.map((row) => row.categoryId)).size !== group.length ||
        group.some((row) => row.loanId !== payment.loanId ||
          row.referenceType !== "payment" || row.referenceId !== payment.id ||
          row.date.getTime() !== payment.paymentDate.getTime() ||
          row.depositLocation !== null || row.subLocationId !== null ||
          row.recordedBy !== rateProof!.run.appliedByAgent ||
          row.description !== `Historical rate repair ${rateProof!.run.planHash}` ||
          row.createdAt.getTime() !== rateProof!.run.appliedAt.getTime() ||
          !(["Loans Receivable", "Interest Earned", "Overpayment Revenue"]
            .includes(row.categoryName)) ||
          row.categoryType !== (row.categoryName === "Loans Receivable"
            ? "asset" : "revenue"))) {
      return [`Non-Cash payment group ${groupId ?? "missing"} is not the reviewed rate posting`]
    }
  }
  const actual: RateEffect[] = rows.map((row) => ({ categoryName: row.categoryName,
    type: row.type, amount: row.amount, referenceType: "payment",
    referenceId: payment.id, date: row.date.toISOString() }))
  return JSON.stringify(normalizedHistoricalJournalEffects(actual)) ===
    JSON.stringify(normalizedHistoricalJournalEffects(expected))
    ? [] : ["Non-Cash payment effects differ from the reviewed rate run"]
}

/** Keep strict reversal/date proof; exclude only ordinary non-Cash rate reclassifications. */
export function validatePaymentSettlementHistory(input: PaymentHistoryInput): string[] {
  const { payment, journalRows } = input
  const rows = journalRows.filter((row) => row.referenceId === payment.id)
  const cashRows = rows.filter((row) => row.categoryName === "Cash")
  if (payment.deletedAt || payment.markedWrong ||
      rows.some((row) => row.referenceType === "payment_reversal") ||
      cashRows.some((row) => row.date.getTime() !== payment.paymentDate.getTime())) {
    return provePaymentJournalHistory(input)
  }
  const cashGroupIds = new Set(cashRows.map((row) => row.journalGroupId))
  const provenRolloverGroups = input.rolloverGroupIds ?? new Set<string>()
  return [...provePaymentJournalHistory({ ...input,
    journalRows: rows.filter((row) => cashGroupIds.has(row.journalGroupId)),
    groupRows: input.groupRows.filter((row) => cashGroupIds.has(row.journalGroupId)),
  }), ...rateReclassificationExceptions(input,
    rows.filter((row) => !cashGroupIds.has(row.journalGroupId) &&
      !provenRolloverGroups.has(row.journalGroupId ?? "")))]
}

async function loadPortfolioRolloverSource(loanId: string, queryDb: QueryDb):
  Promise<PortfolioRolloverSource> {
  const portfolio = await loadRolloverCorrectionPlansInSnapshot(queryDb)
  const chain = portfolio.chains.find((value) =>
    value.loans.some((loan) => loan.id === loanId))
  if (!chain) throw new Error("Complete rollover chain is missing")
  const chainIds = chain.loans.map((loan) => loan.id)
  const referenceIds = [...new Set([...chainIds, ...chain.loans.flatMap((loan) => [
    ...loan.payments.map((payment) => payment.id),
    ...loan.waivers.map((waiver) => waiver.id).filter((id): id is string => !!id),
  ])])]
  const root = chain.loans.find((loan) => !loan.rolledOverFrom)
  if (!root) throw new Error("Rollover chain root is missing")
  const runs = await queryDb.select().from(rolloverCorrectionRuns)
    .where(eq(rolloverCorrectionRuns.chainRootId, root.id))
  const reviewIds = runs.map((run) => run.agentReviewId)
    .filter((id): id is string => !!id)
  const reviews = reviewIds.length ? await queryDb.select()
    .from(financialCorrectionAgentReviews)
    .where(inArray(financialCorrectionAgentReviews.id, reviewIds)) : []
  const portfolioRuns = await queryDb.select().from(portfolioAccrualRepairRuns)
    .where(inArray(portfolioAccrualRepairRuns.loanId, chainIds))
  const portfolioReviewIds = portfolioRuns.map((run) => run.agentReviewId)
    .filter((id): id is string => !!id)
  const portfolioReviews = portfolioReviewIds.length ? await queryDb.select()
    .from(financialCorrectionAgentReviews)
    .where(inArray(financialCorrectionAgentReviews.id, portfolioReviewIds)) : []
  const selection = {
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    categoryName: transactionCategories.name, categoryType: transactionCategories.type,
    type: transactions.type, amount: transactions.amount,
    transactionDate: transactions.transactionDate, createdAt: transactions.createdAt,
    description: transactions.description, recordedBy: transactions.recordedBy,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }
  const direct = await queryDb.select(selection).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(or(inArray(transactions.loanId, chainIds),
      inArray(transactions.referenceId, [...referenceIds,
        ...portfolioRuns.map((run) => run.id)])))
  const groupIds = [...new Set(direct.map((row) => row.journalGroupId)
    .filter((id): id is string => !!id))]
  const journals = groupIds.length ? await queryDb.select(selection).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(inArray(transactions.journalGroupId, groupIds)) : []
  return { chain: { loans: chain.loans.map((loan) => ({ ...loan,
    payments: [...loan.payments].sort((a, b) => a.id.localeCompare(b.id)),
    waivers: [...loan.waivers].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
    rateChanges: [...loan.rateChanges].sort((a, b) =>
      a.effectiveDate.getTime() - b.effectiveDate.getTime()),
  })).sort((a, b) => a.id.localeCompare(b.id)) },
  journals: journals.sort((a, b) => a.id.localeCompare(b.id)),
  runs: runs.sort((a, b) => a.id.localeCompare(b.id)),
  reviews: reviews.sort((a, b) => a.id.localeCompare(b.id)),
  portfolioRuns: portfolioRuns.sort((a, b) => a.id.localeCompare(b.id)),
  portfolioReviews: portfolioReviews.sort((a, b) => a.id.localeCompare(b.id)) }
}

/** Load one loan's reconciled accounting facts without changing the database. */
export async function loadPortfolioAccrualSnapshot(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<AttributedPortfolioAccrualSnapshot> {
  const [loan] = await queryDb.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new Error("Portfolio accrual loan not found")
  const [paymentRows, waiverRows, auditRows, successors, categoryRows, runs,
    rateRequestRows,
    portfolioRuns] = await Promise.all([
    queryDb.select().from(payments).where(eq(payments.loanId, loanId)),
    queryDb.select().from(loanWaivers).where(eq(loanWaivers.loanId, loanId)),
    queryDb.select().from(auditLog).where(and(eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loanId))),
    queryDb.select({ id: loans.id }).from(loans).where(eq(loans.rolledOverFrom, loanId)),
    queryDb.select().from(transactionCategories).where(inArray(transactionCategories.name,
      ["Interest Receivable", "Interest Earned", "Cash", "Loans Receivable"])),
    queryDb.select().from(historicalRateRepairRuns)
      .where(eq(historicalRateRepairRuns.loanId, loanId)),
    queryDb.select().from(rateChangeRequests)
      .where(eq(rateChangeRequests.loanId, loanId)),
    queryDb.select().from(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.loanId, loanId)),
  ])
  const exceptions: string[] = []
  if (loan.deletedAt) exceptions.push("Loan is deleted")
  const needsRolloverProof = !!(loan.rolledOverFrom || successors.length ||
    loan.status === "rolled_over")
  let rolloverSource: PortfolioRolloverSource | undefined
  let rolloverGroupIds: Set<string> | undefined
  if (needsRolloverProof) {
    try {
      rolloverSource = await loadPortfolioRolloverSource(loanId, queryDb)
      const proof = provePortfolioRolloverSource(rolloverSource, loanId, asOf)
      rolloverGroupIds = new Set(proof.settlementCorrectionGroupIds)
    } catch (error) {
      exceptions.push(error instanceof Error ? error.message :
        "Rollover source proof could not be completed")
    }
  }
  const rateHistory = !!loan.interestRateOverride || runs.length > 0 ||
    rateRequestRows.some((row) => row.status === "approved") ||
    auditRows.some((row) => row.action.includes("rate_change") ||
      row.action === "historical_rate_corrected_by_agent" ||
      row.action === "loan.update" &&
      rateTermsEdited(`${row.beforeValue ?? ""}`) ||
      row.action === "loan.update" && rateTermsEdited(row.afterValue))
  if (rateHistory && runs.length !== 1) {
    exceptions.push("Rate history requires exactly one completed historical correction run")
  }
  const correctionAudits = auditRows.filter((row) =>
    row.action === "historical_rate_corrected_by_agent")
  if (rateHistory && correctionAudits.length !== 1) {
    exceptions.push("Historical rate correction audit is missing or ambiguous")
  }
  const correctionAudit = correctionAudits[0]
  if (correctionAudit && auditRows.some((row) =>
    row.id !== correctionAudit.id && row.occurredAt >= correctionAudit.occurredAt &&
    (row.action.includes("rate_change") ||
      row.action === "historical_rate_corrected_by_agent" ||
      row.action === "loan.update" &&
      (rateTermsEdited(row.beforeValue) || rateTermsEdited(row.afterValue))))) {
    exceptions.push("Loan rate or accrual terms changed after historical correction")
  }
  const run = runs.length === 1 ? runs[0] : null
  const [review] = run?.agentReviewId
    ? await queryDb.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, run.agentReviewId)) : []
  const historicalRateCorrection = run && review && correctionAudit
    ? { run, review, audit: correctionAudit } : undefined
  for (const name of ["Interest Earned", "Cash", "Loans Receivable"]) {
    const rows = categoryRows.filter((row) => row.name === name)
    const expected = name === "Interest Earned" ? "revenue" : "asset"
    if (rows.length !== 1 || rows[0].type !== expected) {
      exceptions.push(`${name} account is missing or ambiguous`)
    }
  }
  const receivableRows = categoryRows.filter((row) => row.name === "Interest Receivable")
  if (receivableRows.length > 1 || receivableRows.some((row) => row.type !== "asset")) {
    exceptions.push("Interest Receivable account is ambiguous or wrong-type")
  }

  const activePayments = paymentRows.filter((row) => !row.deletedAt && !row.markedWrong)
  const activeWaivers = waiverRows.filter((row) => !row.deletedAt)
  if (paymentRows.some((row) => row.markedWrong) ||
      waiverRows.length !== activeWaivers.length) {
    exceptions.push("Marked-wrong payment or deleted waiver needs separate historical review")
  }
  const paymentAuditRows = paymentRows.length ? await queryDb.select().from(auditLog)
    .where(and(eq(auditLog.entityType, "payment"),
      inArray(auditLog.entityId, paymentRows.map((row) => row.id)))) : []
  const startDayAuditedPaymentIds = activePayments.filter((payment) => {
    const elapsed = payment.paymentDate.getTime() - loan.startDate.getTime()
    if (elapsed < 0 || elapsed >= 86_400_000) return false
    const audits = paymentAuditRows.filter((row) => row.entityId === payment.id)
    if (audits.length !== 1 || audits[0].action !== "payment.create" ||
        audits[0].beforeValue !== null) return false
    const created = auditedPayment(audits[0].afterValue)
    return !!created && paymentAuditMatches(created, payment)
  }).map((payment) => payment.id).sort()
  const settlementIds = [...paymentRows.map((row) => row.id),
    ...waiverRows.map((row) => row.id)]
  const journalRows = await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    categoryId: transactions.categoryId, createdAt: transactions.createdAt,
    date: transactions.transactionDate, type: transactions.type,
    amount: transactions.amount, categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
    description: transactions.description, recordedBy: transactions.recordedBy,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(settlementIds.length
      ? or(eq(transactions.loanId, loanId), inArray(transactions.referenceId, settlementIds))
      : eq(transactions.loanId, loanId))
  const [paymentPortions, waiverPortions] = await Promise.all([
    getPaymentPortionsFromLedger(activePayments.map((row) => row.id), queryDb),
    getWaiverPortionsFromLedger(activeWaivers.map((row) => row.id), queryDb),
  ])
  const mappedPayments = activePayments.map((row) => {
    const portions = paymentPortions.get(row.id)
    if (!portions) exceptions.push(`Payment ${row.id} has no reconciled allocation`)
    return { id: row.id, paymentDate: row.paymentDate, amount: row.amount,
      interestPortion: portions?.interestPortion ?? "0.00",
      principalPortion: portions?.principalPortion ?? "0.00" }
  })
  const mappedWaivers = activeWaivers.map((row) => {
    const portions = waiverPortions.get(row.id)
    if (!portions) exceptions.push(`Waiver ${row.id} has no reconciled allocation`)
    return { id: row.id, waiverDate: row.waiverDate, amount: row.amount,
      interestPortion: portions?.interestPortion ?? "0.00",
      principalPortion: portions?.principalPortion ?? "0.00", reason: row.reason }
  })
  const groupIds = [...new Set(journalRows.map((row) => row.journalGroupId)
    .filter((id): id is string => id !== null))]
  const groupRows = groupIds.length ? await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    categoryId: transactions.categoryId, createdAt: transactions.createdAt,
    date: transactions.transactionDate, type: transactions.type,
    amount: transactions.amount, categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
    description: transactions.description, recordedBy: transactions.recordedBy,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(inArray(transactions.journalGroupId, groupIds)) : []
  const groups = new Map<string, typeof journalRows>()
  for (const row of groupRows) {
    if (!row.journalGroupId) continue
    const group = groups.get(row.journalGroupId) ?? []
    group.push(row)
    groups.set(row.journalGroupId, group)
  }
  if (rolloverSource && rolloverGroupIds) {
    const identity = (row: Pick<HistoryJournal,
      "id" | "loanId" | "referenceType" | "referenceId" | "categoryName" |
      "categoryType" | "type" | "amount" | "date" | "createdAt" |
      "description" | "recordedBy" | "depositLocation" | "subLocationId">) => [row.id, row.loanId,
      row.referenceType, row.referenceId, row.categoryName, row.categoryType,
      row.type, row.amount, row.date.toISOString(), row.createdAt.toISOString(),
      row.description, row.recordedBy, row.depositLocation, row.subLocationId]
    for (const groupId of rolloverGroupIds) {
      const proven = rolloverSource.journals.filter((row) =>
        row.journalGroupId === groupId && row.loanId === loanId)
      if (!proven.length) continue
      const current = groups.get(groupId) ?? []
      if (JSON.stringify(proven.map((row) => identity({ ...row,
        date: row.transactionDate })).sort()) !==
          JSON.stringify(current.map(identity).sort())) {
        exceptions.push(`Rollover settlement journal group ${groupId} changed during source load`)
      }
    }
  }
  const settlementTypes = new Set(["payment", "payment_reversal", "loan_waiver",
    "loan_waiver_reversal", "loan_waiver_accrual_reversal"])
  exceptions.push(...unresolvedPaymentJournalExceptions(loanId,
    paymentRows.map((row) => row.id), journalRows))
  for (const row of journalRows.filter((item) => settlementTypes.has(item.referenceType ?? ""))) {
    const group = row.journalGroupId ? groups.get(row.journalGroupId) ?? [] : []
    if (!row.journalGroupId || group.length < 2 ||
        !net(group).isZero() || group.some((item) =>
          item.loanId !== loanId || item.referenceId !== row.referenceId ||
          item.referenceType !== row.referenceType ||
          item.date.getTime() !== row.date.getTime())) {
      exceptions.push(`Transaction ${row.id} has an unbalanced payment or waiver journal`)
    }
  }
  for (const payment of paymentRows) {
    exceptions.push(...validatePaymentSettlementHistory({ payment, journalRows, groupRows,
      auditRows: paymentAuditRows, rateProof: historicalRateCorrection,
      rolloverGroupIds })
      .map((issue) => `Payment ${payment.id}: ${issue}`))
  }
  const receivableJournals: AttributedPortfolioAccrualSnapshot["receivableJournals"] = []
  for (const row of journalRows.filter((journal) => journal.categoryName === "Interest Receivable")) {
    const group = row.journalGroupId ? groups.get(row.journalGroupId) ?? [] : []
    const earned = group.find((item) => item.categoryName === "Interest Earned")
    if (row.categoryType !== "asset" || group.length !== 2 || !earned ||
        earned.categoryType !== "revenue" || earned.amount !== row.amount ||
        earned.type === row.type || earned.date.getTime() !== row.date.getTime() ||
        row.loanId !== loanId || earned.loanId !== loanId ||
        !row.referenceType || !row.referenceId ||
        earned.referenceType !== row.referenceType ||
        earned.referenceId !== row.referenceId ||
        row.depositLocation !== null || row.subLocationId !== null ||
        earned.depositLocation !== null || earned.subLocationId !== null) {
      exceptions.push(`Receivable journal ${row.id} has no balanced earned-interest counterpart`)
    }
    receivableJournals.push({ id: row.id, date: row.date, amount: row.amount,
      type: row.type, journalGroupId: row.journalGroupId,
      loanId: row.loanId, referenceType: row.referenceType,
      referenceId: row.referenceId, categoryName: row.categoryName,
      categoryType: row.categoryType,
      depositLocation: row.depositLocation, subLocationId: row.subLocationId,
      groupEntryCount: group.length,
      earnedCounterpart: earned ? {
        id: earned.id, journalGroupId: earned.journalGroupId,
        loanId: earned.loanId,
        referenceType: earned.referenceType, referenceId: earned.referenceId,
        categoryName: earned.categoryName,
        date: earned.date, amount: earned.amount, type: earned.type,
        categoryType: earned.categoryType,
        depositLocation: earned.depositLocation, subLocationId: earned.subLocationId,
      } : null,
      earnedCounterpartAmount: earned?.amount ?? null,
      earnedCounterpartType: earned?.type ?? null })
  }
  if (run) {
    let after: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(run.afterSummary)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        after = parsed as Record<string, unknown>
      }
    } catch { /* A malformed summary must block below. */ }
    const runAsOf = typeof after?.asOf === "string" ? new Date(after.asOf) : null
    const target = typeof after?.accrualJournalTarget === "string"
      ? new BigNumber(after.accrualJournalTarget) : null
    const endingPrincipal = typeof after?.endingPrincipal === "string"
      ? new BigNumber(after.endingPrincipal) : null
    if (!runAsOf || !Number.isFinite(runAsOf.getTime()) || runAsOf > asOf ||
        !target?.isFinite() || !endingPrincipal?.isFinite()) {
      exceptions.push("Historical correction completion summary is missing or stale")
    } else {
      const laterPortfolioRuns = new Map(portfolioRuns
        .filter((portfolioRun) => portfolioRun.appliedAt > run.appliedAt)
        .map((portfolioRun) => [portfolioRun.id, portfolioRun]))
      const posted = net(receivableJournals.filter((row) => {
        if (row.date > runAsOf) return false
        if (row.referenceType !== "portfolio_accrual_repair") return true
        const portfolioRun = row.referenceId && laterPortfolioRuns.get(row.referenceId)
        if (!portfolioRun) return true
        const counterpart = row.earnedCounterpart
        if (!counterpart || row.groupEntryCount !== 2 ||
            counterpart.referenceType !== "portfolio_accrual_repair" ||
            counterpart.referenceId !== portfolioRun.id ||
            counterpart.journalGroupId !== row.journalGroupId ||
            counterpart.date.getTime() !== row.date.getTime() ||
            counterpart.amount !== row.amount || counterpart.type === row.type) {
          exceptions.push(`Later portfolio journal ${row.id} is not an attributed pair`)
          return true
        }
        return false
      }))
      const runPrincipal = await getLoanBalanceFromLedger(loanId, runAsOf, queryDb)
      if (!posted.eq(target) || !runPrincipal.eq(endingPrincipal)) {
        exceptions.push("Historical correction summary does not reconcile to current ledger")
      }
    }
  }
  let principal: BigNumber | null = null
  if (loan.status === "active" || loan.status === "fully_paid") {
    const statement = buildLoanStatement({ loan: { ...loan, createdAt: loan.startDate }, today: asOf,
      payments: mappedPayments.filter((row) => row.paymentDate <= asOf)
        .map((row) => ({ ...row, recorderName: "" })),
      waivers: mappedWaivers.filter((row) => row.waiverDate <= asOf) })
    principal = await getLoanBalanceFromLedger(loanId, asOf, queryDb)
    if (principal.minus(statement.finalState.principalBalance).abs().gt(1)) {
      exceptions.push("Loan principal balance does not reconcile to the ledger")
    }
  }
  const snapshot: AttributedPortfolioAccrualSnapshot = {
    loan: {
      id: loan.id, principalAmount: loan.principalAmount,
      interestRate: loan.interestRate, interestRateOverride: loan.interestRateOverride,
      penaltyMultiplier: loan.penaltyMultiplier, penaltyWaived: loan.penaltyWaived,
      penaltyWaivedAt: loan.penaltyWaivedAt, penaltyWaivedBy: loan.penaltyWaivedBy,
      minInterestDays: loan.minInterestDays, minPeriodOverride: loan.minPeriodOverride,
      rolledOverFrom: loan.rolledOverFrom, issuanceFee: loan.issuanceFee,
      loanType: loan.loanType, status: loan.status, startDate: loan.startDate,
    },
    payments: mappedPayments, waivers: mappedWaivers,
    receivableJournals,
    receivableCategory: receivableRows.length === 1
      ? { id: receivableRows[0].id, type: receivableRows[0].type } : null,
    historicalRateCorrection,
    rolloverSource,
    rateHistoryProvenAbsent: !rateHistory,
    startDayAuditedPaymentIds,
    sourceDigest: digest({ loan,
      paymentRows: paymentRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      paymentAuditRows: paymentAuditRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      waiverRows: waiverRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      auditRows: auditRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      successors: successors.toSorted((a, b) => a.id.localeCompare(b.id)),
      categoryRows: categoryRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      runs: runs.toSorted((a, b) => a.id.localeCompare(b.id)),
      rateRequestRows: rateRequestRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      portfolioRuns: portfolioRuns.toSorted((a, b) => a.id.localeCompare(b.id)), review,
      journalRows: journalRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      groupRows: groupRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      mappedPayments, mappedWaivers, principal: principal?.toFixed(2) ?? null,
      ...(rolloverSource ? { rolloverSource } : {}) }),
    sourceExceptions: exceptions, asOf,
  }
  if (historicalRateCorrection) {
    snapshot.sourceExceptions.push(...historicalRateCorrectionExceptions(snapshot))
  }
  return snapshot
}

export async function loadPortfolioAccrualPlan(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<PortfolioAccrualPlan> {
  return planPortfolioAccrualRepair(await loadPortfolioAccrualSnapshot(loanId, asOf, queryDb))
}
