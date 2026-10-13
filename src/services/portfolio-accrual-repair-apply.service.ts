import { randomUUID } from "node:crypto"
import BigNumber from "bignumber.js"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { portfolioAccrualRepairRuns } from
  "@/lib/db/schema/portfolio-accrual-repair-runs"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
import { planPortfolioAccrualRepair, type PortfolioAccrualPlan } from
  "@/lib/interest/portfolio-accrual-repair"
import { assertMatchingPassingAgentReview, hashReviewEvidence } from
  "@/lib/financial-corrections/agent-review"
import { verifyPortfolioAccrualEvidence } from
  "@/lib/financial-corrections/portfolio-verifier"
import { isIsolatedPortfolioRehearsalDatabase, verifyPortfolioAccrualBackup } from
  "@/lib/interest/portfolio-accrual-backup"
import { loadPortfolioAccrualPlan, loadPortfolioAccrualSnapshot } from
  "./portfolio-accrual-repair.service"

const REVIEW_KIND = "portfolio_accrual"

type BackupGate = Parameters<typeof verifyPortfolioAccrualBackup>[0]

/** Record a separate agent's checked evidence; a failed check remains auditable. */
export async function reviewPortfolioAccrualRepair(
  reviewedPlan: PortfolioAccrualPlan,
  reviewerAgentId: string,
  reviewRunId: string,
): Promise<{ reviewId: string; verdict: "pass" | "fail"; findings: string[] }> {
  if (!reviewerAgentId.startsWith("agent:") || reviewerAgentId.trim() === "agent:" ||
      !reviewRunId.trim() || reviewedPlan.asOf > new Date() ||
      reviewedPlan.classification !== "ready") {
    throw new Error("A ready plan and identified reviewing agent run are required")
  }
  const snapshot = await loadPortfolioAccrualSnapshot(reviewedPlan.loanId, reviewedPlan.asOf)
  const current = planPortfolioAccrualRepair(snapshot)
  if (current.classification !== "ready" || current.planHash !== reviewedPlan.planHash ||
      current.inputFingerprint !== reviewedPlan.inputFingerprint ||
      current.policyVersion !== reviewedPlan.policyVersion) {
    throw new Error("Portfolio plan changed before agent review")
  }
  let evidence: unknown
  let verdict: "pass" | "fail" = "pass"
  let findings: string[] = []
  try {
    evidence = verifyPortfolioAccrualEvidence(snapshot, current)
  } catch (error) {
    verdict = "fail"
    findings = [error instanceof Error ? error.message : "Independent portfolio check failed"]
    evidence = { loanId: current.loanId, asOf: current.asOf.toISOString(),
      planHash: current.planHash, failedCheck: findings[0] }
  }
  const evidenceJson = JSON.stringify(evidence)
  const evidenceSha256 = hashReviewEvidence(evidence)
  const findingsJson = JSON.stringify({ checks: ["source", "dated checkpoints",
    "balanced non-cash journals"], issues: findings })
  const [inserted] = await db.insert(financialCorrectionAgentReviews).values({
    kind: REVIEW_KIND, subjectId: current.loanId, planHash: current.planHash,
    inputFingerprint: current.inputFingerprint, policyVersion: current.policyVersion,
    reviewerAgentId, reviewRunId, evidenceSha256, evidenceJson, verdict, findingsJson,
  }).onConflictDoNothing().returning({ id: financialCorrectionAgentReviews.id })
  if (inserted) return { reviewId: inserted.id, verdict, findings }
  const [existing] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, current.planHash),
      eq(financialCorrectionAgentReviews.reviewRunId, reviewRunId)))
  if (!existing || existing.reviewerAgentId !== reviewerAgentId ||
      existing.evidenceSha256 !== evidenceSha256 || existing.verdict !== verdict ||
      existing.findingsJson !== findingsJson) {
    throw new Error("Conflicting agent review attempt already exists")
  }
  return { reviewId: existing.id, verdict, findings }
}

/** Apply one immutable, approved loan plan after verifying a recent full-data backup. */
export async function applyPortfolioAccrualRepair(
  reviewedPlan: PortfolioAccrualPlan,
  executorAgentId: string,
  backupGate: BackupGate,
): Promise<{ runId: string; alreadyApplied: boolean }> {
  if (!executorAgentId.startsWith("agent:") || executorAgentId.trim() === "agent:" ||
      reviewedPlan.classification !== "ready" ||
      reviewedPlan.asOf > new Date()) {
    throw new Error("A ready plan and identified executor agent are required")
  }
  if (!process.env.DATABASE_URL ||
      backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Backup database identity does not match the configured live connection")
  }
  const [prior] = await db.select({ id: portfolioAccrualRepairRuns.id })
    .from(portfolioAccrualRepairRuns)
    .where(eq(portfolioAccrualRepairRuns.planHash, reviewedPlan.planHash))
  if (prior) return { runId: prior.id, alreadyApplied: true }
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, reviewedPlan.planHash)))
    .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
      desc(financialCorrectionAgentReviews.id)).limit(1)
  if (!review) throw new Error("Exact passing agent review is required")
  assertMatchingPassingAgentReview(review, {
    kind: REVIEW_KIND, subjectId: reviewedPlan.loanId,
    planHash: reviewedPlan.planHash,
    inputFingerprint: reviewedPlan.inputFingerprint,
    policyVersion: reviewedPlan.policyVersion,
  }, executorAgentId)
  const rehearsal = isIsolatedPortfolioRehearsalDatabase(
    backupGate.primaryUrl, backupGate.directUrl)
  const backup = await verifyPortfolioAccrualBackup(backupGate, rehearsal ? undefined : {
    planHash: reviewedPlan.planHash, asOf: reviewedPlan.asOf,
  })

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`)
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`)
    const configured = new URL(backupGate.primaryUrl)
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Backup database identity does not match the live database session")
    }
    const [existingRun] = await tx.select({ id: portfolioAccrualRepairRuns.id })
      .from(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.planHash, reviewedPlan.planHash))
    if (existingRun) return { runId: existingRun.id, alreadyApplied: true }
    const [lockedReview] = await tx.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, review.id)).for("update")
    if (!lockedReview) throw new Error("Agent review disappeared before posting")
    assertMatchingPassingAgentReview(lockedReview, {
      kind: REVIEW_KIND, subjectId: reviewedPlan.loanId,
      planHash: reviewedPlan.planHash,
      inputFingerprint: reviewedPlan.inputFingerprint,
      policyVersion: reviewedPlan.policyVersion,
    }, executorAgentId)
    const [loan] = await tx.select().from(loans)
      .where(eq(loans.id, reviewedPlan.loanId)).for("update")
    if (!loan || loan.deletedAt) throw new Error("Portfolio accrual loan changed")
    const snapshot = await loadPortfolioAccrualSnapshot(loan.id, reviewedPlan.asOf, tx)
    const current = planPortfolioAccrualRepair(snapshot)
    if (current.classification !== "ready" ||
        current.planHash !== reviewedPlan.planHash ||
        current.inputFingerprint !== reviewedPlan.inputFingerprint ||
        current.policyVersion !== reviewedPlan.policyVersion) {
      throw new Error("Portfolio accrual plan is stale or source changed")
    }
    const evidence = verifyPortfolioAccrualEvidence(snapshot, current)
    if (hashReviewEvidence(evidence) !== lockedReview.evidenceSha256) {
      throw new Error("Agent review evidence no longer matches source accounting")
    }
    const categories = await tx.select().from(transactionCategories)
      .where(inArray(transactionCategories.name, ["Interest Receivable", "Interest Earned"]))
    const receivable = categories.filter((row) => row.name === "Interest Receivable" &&
      row.type === "asset")
    const earned = categories.filter((row) => row.name === "Interest Earned" &&
      row.type === "revenue")
    if (categories.length !== 2 || receivable.length !== 1 || earned.length !== 1) {
      throw new Error("Portfolio accrual accounting categories are missing or ambiguous")
    }
    // One application-clock instant binds the run, its review consumption, and
    // every journal leg. A database clock may differ from the operator clock;
    // its default now() must not make a reviewed as-of appear to be in the future.
    const appliedAt = new Date()
    if (current.asOf > appliedAt || lockedReview.reviewedAt > appliedAt) {
      throw new Error("Portfolio application time precedes the reviewed source")
    }
    const runId = randomUUID()
    for (const entry of current.entries) {
      const delta = new BigNumber(entry.delta)
      if (!delta.isFinite() || delta.isZero() || entry.date > current.asOf) {
        throw new Error("Portfolio accrual entry is invalid")
      }
      const increasing = delta.gt(0)
      const journalGroupId = randomUUID()
      await tx.insert(transactions).values([
        { type: "debit", amount: delta.abs().toFixed(2),
          categoryId: increasing ? receivable[0].id : earned[0].id,
          referenceType: "portfolio_accrual_repair", referenceId: runId,
          loanId: loan.id, description: `Portfolio interest repair ${runId}`,
          transactionDate: entry.date, createdAt: appliedAt,
          recordedBy: executorAgentId, journalGroupId },
        { type: "credit", amount: delta.abs().toFixed(2),
          categoryId: increasing ? earned[0].id : receivable[0].id,
          referenceType: "portfolio_accrual_repair", referenceId: runId,
          loanId: loan.id, description: `Portfolio interest repair ${runId}`,
          transactionDate: entry.date, createdAt: appliedAt,
          recordedBy: executorAgentId, journalGroupId },
      ])
    }
    const [consumed] = await tx.update(financialCorrectionAgentReviews).set({
      consumedAt: appliedAt, consumedByRunId: runId,
    }).where(and(eq(financialCorrectionAgentReviews.id, lockedReview.id),
      isNull(financialCorrectionAgentReviews.consumedAt)))
      .returning({ id: financialCorrectionAgentReviews.id })
    if (!consumed) throw new Error("Agent review was already consumed")
    await tx.insert(portfolioAccrualRepairRuns).values({
      id: runId, loanId: loan.id, planHash: current.planHash,
      inputFingerprint: current.inputFingerprint, policyVersion: current.policyVersion,
      approvedBy: null, appliedBy: null, agentReviewId: lockedReview.id,
      appliedByAgent: executorAgentId, backupSha256: backup.dumpSha256,
      beforeSummary: JSON.stringify({ asOf: current.asOf, entries: current.entries }),
      afterSummary: JSON.stringify({ classification: "pending" }),
      appliedAt,
    })
    const after = await loadPortfolioAccrualPlan(loan.id, current.asOf, tx)
    if (after.classification !== "noop" || after.entries.length !== 0) {
      throw new Error("Portfolio accrual did not reconcile after posting")
    }
    await tx.update(portfolioAccrualRepairRuns).set({ afterSummary: JSON.stringify({
      classification: after.classification, inputFingerprint: after.inputFingerprint,
      planHash: after.planHash,
    }) }).where(eq(portfolioAccrualRepairRuns.id, runId))
    return { runId, alreadyApplied: false }
  })
}
