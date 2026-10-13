import { randomUUID } from "node:crypto"
import BigNumber from "bignumber.js"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { auditLog } from "@/lib/db/schema/audit"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { assertMatchingPassingAgentReview, hashReviewEvidence } from
  "@/lib/financial-corrections/agent-review"
import { planDeletedRolloverLedgerRepair, type DeletedRolloverPlan } from
  "@/lib/financial-corrections/deleted-rollover-ledger"
import { verifyDeletedRolloverLedgerEvidence } from
  "@/lib/financial-corrections/deleted-rollover-ledger-verifier"
import { verifyDeletedRolloverBackup, type DeletedRolloverBackupGate } from
  "@/lib/financial-corrections/deleted-rollover-backup"
import { loadDeletedRolloverSource } from "./deleted-rollover-ledger.service"

const REVIEW_KIND = "deleted_rollover_ledger"
const CORRECTION_REFERENCE = "deleted_rollover_ledger_repair"

function identity(plan: DeletedRolloverPlan) {
  return { kind: REVIEW_KIND, subjectId: plan.predecessorId,
    planHash: plan.planHash, inputFingerprint: plan.inputFingerprint,
    policyVersion: plan.policyVersion }
}

function assertReady(plan: DeletedRolloverPlan): asserts plan is Extract<
  DeletedRolloverPlan, { classification: "ready" }> {
  if (plan.classification !== "ready" || plan.exceptions.length ||
      !/^[a-f0-9]{64}$/.test(plan.planHash) ||
      !/^[a-f0-9]{64}$/.test(plan.inputFingerprint)) {
    throw new Error("Only an exact ready deleted-rollover plan can be reviewed or applied")
  }
}

function assertSamePlan(expected: DeletedRolloverPlan,
  current: DeletedRolloverPlan): asserts current is Extract<
    DeletedRolloverPlan, { classification: "ready" }> {
  assertReady(current)
  if (expected.planHash !== current.planHash ||
      expected.inputFingerprint !== current.inputFingerprint ||
      expected.predecessorId !== current.predecessorId ||
      expected.successorId !== current.successorId ||
      expected.policyVersion !== current.policyVersion) {
    throw new Error("Deleted-rollover source changed since review")
  }
}

/** Persist a separately attributed agent's independent, exact-source review. */
export async function reviewDeletedRolloverLedgerRepair(
  reviewedPlan: DeletedRolloverPlan,
  reviewerAgentId: string,
  reviewRunId: string,
): Promise<{ reviewId: string; verdict: "pass" | "fail"; issues: string[] }> {
  if (process.env.CYPRESS === "true") {
    throw new Error("Deleted-rollover maintenance cannot use the Cypress database override")
  }
  assertReady(reviewedPlan)
  if (!reviewerAgentId.startsWith("agent:") || reviewerAgentId === "agent:" ||
      !reviewRunId.trim() ||
      reviewerAgentId !== `agent:${process.env.CODEX_THREAD_ID ?? ""}`) {
    throw new Error("Current agent task identity and review run ID are required")
  }
  const { plan, evidence } = await db.transaction(async (tx) => {
    const source = await loadDeletedRolloverSource(reviewedPlan.predecessorId, tx)
    const plan = planDeletedRolloverLedgerRepair(source)
    assertSamePlan(reviewedPlan, plan)
    return { plan, evidence: verifyDeletedRolloverLedgerEvidence(source, plan) }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  const evidenceJson = JSON.stringify(evidence)
  const evidenceSha256 = hashReviewEvidence(evidence)
  const findingsJson = JSON.stringify({ checks: evidence.checks.map((check) => check.name),
    issues: evidence.issues })
  const [inserted] = await db.insert(financialCorrectionAgentReviews).values({
    ...identity(plan), reviewerAgentId, reviewRunId,
    evidenceJson, evidenceSha256, verdict: evidence.verdict, findingsJson,
  }).onConflictDoNothing().returning({ id: financialCorrectionAgentReviews.id })
  if (inserted) return { reviewId: inserted.id, verdict: evidence.verdict,
    issues: evidence.issues }
  const [existing] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, plan.planHash),
      eq(financialCorrectionAgentReviews.reviewRunId, reviewRunId)))
  if (!existing || existing.reviewerAgentId !== reviewerAgentId ||
      existing.evidenceSha256 !== evidenceSha256 ||
      existing.evidenceJson !== evidenceJson ||
      existing.findingsJson !== findingsJson ||
      existing.verdict !== evidence.verdict) {
    throw new Error("Conflicting deleted-rollover review attempt")
  }
  return { reviewId: existing.id, verdict: evidence.verdict,
    issues: evidence.issues }
}

/** One serializable, non-Cash journal, bound to backup, restore, and independent review. */
export async function applyDeletedRolloverLedgerRepair(
  reviewedPlan: DeletedRolloverPlan,
  executorAgentId: string,
  backupGate: DeletedRolloverBackupGate,
  options?: { rehearsal?: true },
): Promise<{ runId: string; journalGroupId: string; alreadyApplied: boolean }> {
  if (process.env.CYPRESS === "true") {
    throw new Error("Deleted-rollover maintenance cannot use the Cypress database override")
  }
  assertReady(reviewedPlan)
  if (!executorAgentId.startsWith("agent:") || executorAgentId === "agent:" ||
      executorAgentId !== `agent:${process.env.CODEX_THREAD_ID ?? ""}`) {
    throw new Error("Current executor agent task identity is required")
  }
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, reviewedPlan.planHash)))
    .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
      desc(financialCorrectionAgentReviews.id)).limit(1)
  if (!review) throw new Error("Exact independent agent review is required")
  assertMatchingPassingAgentReview(review, identity(reviewedPlan), executorAgentId)
  const backup = await verifyDeletedRolloverBackup(backupGate, {
    predecessorId: reviewedPlan.predecessorId,
    successorId: reviewedPlan.successorId,
    planHash: reviewedPlan.planHash,
    inputFingerprint: reviewedPlan.inputFingerprint,
    reviewEvidenceSha256: review.evidenceSha256,
    amount: reviewedPlan.legs[0].amount,
    effectiveDate: reviewedPlan.effectiveDate.toISOString(),
    sourceGroupId: reviewedPlan.sourceGroupId,
  }, options?.rehearsal === true, process.env.DATABASE_URL_TEST)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`)
    const configured = new URL(options?.rehearsal
      ? process.env.DATABASE_URL ?? "" : backupGate.primaryUrl)
    const [session] = await tx.execute<{ name: string; role: string }>(sql`
      SELECT current_database() AS name, current_user AS role`)
    if (session?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        session?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Maintenance session is not on the verified database")
    }
    const [predecessor, successor] = await tx.select().from(loans)
      .where(inArray(loans.id, [reviewedPlan.predecessorId,
        reviewedPlan.successorId])).orderBy(loans.id).for("update")
    if (!predecessor || !successor) throw new Error("Deleted chain disappeared")
    const [lockedReview] = await tx.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, review.id)).for("update")
    if (!lockedReview) throw new Error("Agent review disappeared")
    assertMatchingPassingAgentReview(lockedReview, identity(reviewedPlan), executorAgentId)
    const existing = await tx.select().from(transactions)
      .where(and(eq(transactions.referenceType, CORRECTION_REFERENCE),
        eq(transactions.referenceId, reviewedPlan.planHash)))
    if (existing.length) throw new Error("This deleted-rollover plan was already posted")
    const source = await loadDeletedRolloverSource(reviewedPlan.predecessorId, tx)
    const current = planDeletedRolloverLedgerRepair(source)
    assertSamePlan(reviewedPlan, current)
    const evidence = verifyDeletedRolloverLedgerEvidence(source, current)
    if (evidence.verdict !== "pass" ||
        JSON.stringify(evidence) !== lockedReview.evidenceJson ||
        hashReviewEvidence(evidence) !== lockedReview.evidenceSha256) {
      throw new Error("Agent evidence changed before journal posting")
    }
    const categories = await tx.select().from(transactionCategories)
      .where(inArray(transactionCategories.name,
        ["Loans Receivable", "Interest Earned"]))
    const categoryByName = new Map(categories.map((row) => [row.name, row]))
    if (categories.length !== 2 || categoryByName.size !== 2 ||
        categoryByName.get("Loans Receivable")?.type !== "asset" ||
        categoryByName.get("Interest Earned")?.type !== "revenue") {
      throw new Error("Correction categories are missing or ambiguous")
    }
    const runId = randomUUID()
    const journalGroupId = randomUUID()
    const appliedAt = new Date()
    await tx.insert(transactions).values(current.legs.map((leg) => ({
      categoryId: categoryByName.get(leg.category)!.id,
      type: leg.type, amount: leg.amount,
      referenceType: CORRECTION_REFERENCE, referenceId: current.planHash,
      loanId: current.successorId,
      description: `Deleted rollover duplicate reversal repair ${runId}`,
      transactionDate: current.effectiveDate,
      recordedBy: executorAgentId, journalGroupId, createdAt: appliedAt,
    })))
    const [consumed] = await tx.update(financialCorrectionAgentReviews)
      .set({ consumedAt: appliedAt, consumedByRunId: runId })
      .where(and(eq(financialCorrectionAgentReviews.id, lockedReview.id),
        isNull(financialCorrectionAgentReviews.consumedAt)))
      .returning({ id: financialCorrectionAgentReviews.id })
    if (!consumed) throw new Error("Agent review was already consumed")
    await tx.insert(auditLog).values({
      action: CORRECTION_REFERENCE, entityType: "loan",
      entityId: current.predecessorId,
      afterValue: JSON.stringify({ runId, successorId: current.successorId,
        planHash: current.planHash, inputFingerprint: current.inputFingerprint,
        sourceGroupId: current.sourceGroupId, journalGroupId,
        amount: current.legs[0].amount, reviewId: lockedReview.id,
        backupSha256: backup.dumpSha256, appliedByAgent: executorAgentId }),
    })
    const after = await loadDeletedRolloverSource(current.predecessorId, tx)
    const accounts = ["Cash", "Loans Receivable", "Interest Earned",
      "Issuance Fees", "Overpayment Revenue", "Loan Losses"]
    const reconciled = accounts.every((category) =>
      [current.predecessorId, current.successorId].every((loanId) =>
        after.journals.filter((row) => row.loanId === loanId &&
          row.categoryName === category).reduce((sum, row) =>
          row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
          new BigNumber(0)).isZero()))
    const postedRows = after.journals.filter((row) => row.journalGroupId === journalGroupId)
    if (!reconciled || postedRows.length !== 2 ||
        postedRows.some((row) => row.categoryName === "Cash" ||
          row.referenceId !== current.planHash ||
          row.referenceType !== CORRECTION_REFERENCE) ||
        !postedRows.reduce((sum, row) => row.type === "debit" ?
          sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0)).isZero()) {
      throw new Error("Deleted-rollover correction did not reconcile before commit")
    }
    return { runId, journalGroupId, alreadyApplied: false }
  }, { isolationLevel: "serializable" })
}
