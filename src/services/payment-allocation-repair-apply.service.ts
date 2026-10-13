import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
import { loans } from "@/lib/db/schema/loans"
import { paymentAllocationRepairRuns } from "@/lib/db/schema/payment-allocation-repair-runs"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { transactions } from "@/lib/db/schema/transactions"
import { assertMatchingPassingAgentReview, hashReviewEvidence } from
  "@/lib/financial-corrections/agent-review"
import { verifyFullyPaidAllocationEvidence } from
  "@/lib/financial-corrections/payment-allocation-verifier"
import { planFullyPaidAllocationRepair, type FullyPaidAllocationPlan } from
  "@/lib/interest/fully-paid-allocation-repair"
import { verifyPaymentAllocationBackup } from
  "@/lib/interest/payment-allocation-backup"
import { isIsolatedPortfolioRehearsalDatabase } from
  "@/lib/interest/portfolio-accrual-backup"
import { loadFullyPaidAllocationSnapshot } from "./payment-allocation-repair.service"

const REVIEW_KIND = "fully-paid-allocation-repair"
type BackupGate = Parameters<typeof verifyPaymentAllocationBackup>[0]

function reviewedIdentity(plan: FullyPaidAllocationPlan) {
  return { kind: REVIEW_KIND, subjectId: plan.loanId, planHash: plan.planHash,
    inputFingerprint: plan.sourceFingerprint, policyVersion: plan.policyVersion }
}

function requireReadyPlan(plan: FullyPaidAllocationPlan, agentId: string): Date {
  const asOf = new Date(plan.asOf)
  if (plan.status !== "ready" || !plan.loanId ||
      !/^[a-f0-9]{64}$/.test(plan.planHash) ||
      !/^[a-f0-9]{64}$/.test(plan.sourceFingerprint) ||
      !agentId.startsWith("agent:") || agentId.trim() === "agent:" ||
      !Number.isFinite(asOf.getTime()) || asOf.toISOString() !== plan.asOf ||
      asOf.getTime() > Date.now()) {
    throw new Error("A ready plan and identified agent are required")
  }
  return asOf
}

function assertSameReadyPlan(expected: FullyPaidAllocationPlan,
  actual: FullyPaidAllocationPlan): void {
  if (actual.status !== "ready" || actual.planHash !== expected.planHash ||
      actual.sourceFingerprint !== expected.sourceFingerprint ||
      actual.policyVersion !== expected.policyVersion ||
      actual.loanId !== expected.loanId || actual.asOf !== expected.asOf) {
    throw new Error("Fully-paid allocation plan is stale or source changed")
  }
}

async function assertAppliedNoop(
  reviewedPlan: FullyPaidAllocationPlan,
  run: typeof paymentAllocationRepairRuns.$inferSelect,
  queryDb: Parameters<typeof loadFullyPaidAllocationSnapshot>[2] = db,
): Promise<void> {
  if (run.loanId !== reviewedPlan.loanId ||
      run.planHash !== reviewedPlan.planHash ||
      run.inputFingerprint !== reviewedPlan.sourceFingerprint ||
      run.policyVersion !== reviewedPlan.policyVersion) {
    throw new Error("Existing allocation run does not match this plan")
  }
  const observedAt = new Date(Math.max(Date.now(), run.appliedAt.getTime()))
  const snapshot = await loadFullyPaidAllocationSnapshot(run.loanId, observedAt, queryDb)
  const after = planFullyPaidAllocationRepair(snapshot)
  if (after.status !== "noop" || after.effects.length !== 0 ||
      snapshot.correctionProof?.run.id !== run.id) {
    throw new Error(`Already-applied allocation does not reconcile: ${after.blockers.join("; ")}`)
  }
}

/** A separate agent records immutable, source-recomputed accounting evidence. */
export async function reviewFullyPaidAllocationRepair(
  reviewedPlan: FullyPaidAllocationPlan,
  reviewerAgentId: string,
  reviewRunId: string,
): Promise<{ reviewId: string; verdict: "pass" | "fail"; findings: string[] }> {
  const asOf = requireReadyPlan(reviewedPlan, reviewerAgentId)
  if (!reviewRunId.trim()) throw new Error("A reviewing agent run identifier is required")
  const snapshot = await loadFullyPaidAllocationSnapshot(reviewedPlan.loanId, asOf)
  const current = planFullyPaidAllocationRepair(snapshot)
  assertSameReadyPlan(reviewedPlan, current)
  let evidence: unknown
  let verdict: "pass" | "fail" = "pass"
  let findings: string[] = []
  try {
    evidence = verifyFullyPaidAllocationEvidence(snapshot, current)
  } catch (error) {
    verdict = "fail"
    findings = [error instanceof Error ? error.message : "Allocation evidence verification failed"]
    evidence = { kind: REVIEW_KIND, loanId: current.loanId,
      reviewedAsOf: current.asOf, planHash: current.planHash, failedCheck: findings[0] }
  }
  const evidenceJson = JSON.stringify(evidence)
  const evidenceSha256 = hashReviewEvidence(evidence)
  const findingsJson = JSON.stringify({ checks: ["complete original source",
    "interest-first replay", "balanced dated non-cash payment groups"], issues: findings })
  const [inserted] = await db.insert(financialCorrectionAgentReviews).values({
    ...reviewedIdentity(current), reviewerAgentId, reviewRunId,
    evidenceJson, evidenceSha256, verdict, findingsJson,
  }).onConflictDoNothing().returning({ id: financialCorrectionAgentReviews.id })
  if (inserted) return { reviewId: inserted.id, verdict, findings }
  const [existing] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, current.planHash),
      eq(financialCorrectionAgentReviews.reviewRunId, reviewRunId)))
  if (!existing || existing.reviewerAgentId !== reviewerAgentId ||
      existing.evidenceSha256 !== evidenceSha256 ||
      existing.evidenceJson !== evidenceJson || existing.verdict !== verdict ||
      existing.findingsJson !== findingsJson) {
    throw new Error("Conflicting agent review attempt already exists")
  }
  return { reviewId: existing.id, verdict, findings }
}

/** Post only the reviewed non-cash payment effects, then prove a current noop. */
export async function applyFullyPaidAllocationRepair(
  reviewedPlan: FullyPaidAllocationPlan,
  executorAgentId: string,
  backupGate: BackupGate,
  options?: { rehearsal?: true },
): Promise<{ runId: string; alreadyApplied: boolean }> {
  const asOf = requireReadyPlan(reviewedPlan, executorAgentId)
  if (!process.env.DATABASE_URL || backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Backup database identity does not match the configured live connection")
  }
  if (options?.rehearsal && !isIsolatedPortfolioRehearsalDatabase(
    backupGate.primaryUrl, backupGate.directUrl)) {
    throw new Error("Plan-proof bypass requires an isolated restored rehearsal database")
  }
  const [prior] = await db.select().from(paymentAllocationRepairRuns)
    .where(eq(paymentAllocationRepairRuns.planHash, reviewedPlan.planHash))
  if (prior) {
    await assertAppliedNoop(reviewedPlan, prior)
    return { runId: prior.id, alreadyApplied: true }
  }
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, reviewedPlan.planHash)))
    .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
      desc(financialCorrectionAgentReviews.id)).limit(1)
  if (!review) throw new Error("Exact passing agent review is required")
  assertMatchingPassingAgentReview(review, reviewedIdentity(reviewedPlan), executorAgentId)
  const exactPlan = { loanId: reviewedPlan.loanId, planHash: reviewedPlan.planHash,
    inputFingerprint: reviewedPlan.sourceFingerprint, asOf }
  const backup = await verifyPaymentAllocationBackup(backupGate,
    options?.rehearsal ? undefined : exactPlan)

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`)
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`)
    const configured = new URL(backupGate.primaryUrl)
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Backup database identity does not match the live database session")
    }
    const [existingRun] = await tx.select().from(paymentAllocationRepairRuns)
      .where(eq(paymentAllocationRepairRuns.planHash, reviewedPlan.planHash))
    if (existingRun) {
      await assertAppliedNoop(reviewedPlan, existingRun, tx)
      return { runId: existingRun.id, alreadyApplied: true }
    }
    const [lockedReview] = await tx.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, review.id)).for("update")
    if (!lockedReview) throw new Error("Agent review disappeared before posting")
    assertMatchingPassingAgentReview(lockedReview, reviewedIdentity(reviewedPlan),
      executorAgentId)
    const [loan] = await tx.select().from(loans)
      .where(eq(loans.id, reviewedPlan.loanId)).for("update")
    if (!loan || loan.deletedAt) throw new Error("Fully-paid allocation loan changed")
    const snapshot = await loadFullyPaidAllocationSnapshot(loan.id, asOf, tx)
    const current = planFullyPaidAllocationRepair(snapshot)
    assertSameReadyPlan(reviewedPlan, current)
    const evidence = verifyFullyPaidAllocationEvidence(snapshot, current)
    if (hashReviewEvidence(evidence) !== lockedReview.evidenceSha256 ||
        JSON.stringify(evidence) !== lockedReview.evidenceJson) {
      throw new Error("Agent review evidence no longer matches source accounting")
    }
    const categories = await tx.select().from(transactionCategories).where(inArray(
      transactionCategories.name, ["Loans Receivable", "Interest Earned",
        "Overpayment Revenue"],
    ))
    const categoryByName = new Map(categories.map((row) => [row.name, row]))
    if (categories.length !== 3 || categoryByName.size !== 3 ||
        categoryByName.get("Loans Receivable")?.type !== "asset" ||
        categoryByName.get("Interest Earned")?.type !== "revenue" ||
        categoryByName.get("Overpayment Revenue")?.type !== "revenue") {
      throw new Error("Payment allocation categories are missing or ambiguous")
    }
    const appliedAt = new Date()
    if (asOf > appliedAt || lockedReview.reviewedAt > appliedAt ||
        evidence.expectedGroups.length === 0) {
      throw new Error("Application time or reviewed groups are invalid")
    }
    const runId = randomUUID()
    const groups: Array<{ paymentId: string; groupId: string }> = []
    for (const group of evidence.expectedGroups) {
      const groupId = randomUUID()
      groups.push({ paymentId: group.paymentId, groupId })
      for (const entry of group.entries) {
        const category = categoryByName.get(entry.account)
        if (!category || entry.amount === "0.00" ||
            group.effectiveAt > current.asOf) {
          throw new Error("Reviewed payment correction entry is invalid")
        }
        await tx.insert(transactions).values({
          loanId: loan.id, categoryId: category.id, type: entry.side,
          amount: entry.amount, referenceType: "payment", referenceId: group.paymentId,
          description: `Payment allocation repair run ${runId} payment ${group.paymentId}`,
          transactionDate: new Date(group.effectiveAt), recordedBy: executorAgentId,
          journalGroupId: groupId, createdAt: appliedAt,
        })
      }
    }
    const [consumed] = await tx.update(financialCorrectionAgentReviews).set({
      consumedAt: appliedAt, consumedByRunId: runId,
    }).where(and(eq(financialCorrectionAgentReviews.id, lockedReview.id),
      isNull(financialCorrectionAgentReviews.consumedAt)))
      .returning({ id: financialCorrectionAgentReviews.id })
    if (!consumed) throw new Error("Agent review was already consumed")
    await tx.insert(paymentAllocationRepairRuns).values({
      id: runId, loanId: loan.id, planHash: current.planHash,
      inputFingerprint: current.sourceFingerprint, policyVersion: current.policyVersion,
      agentReviewId: lockedReview.id, appliedByAgent: executorAgentId,
      backupSha256: backup.dumpSha256,
      beforeSummary: JSON.stringify({ asOf: current.asOf,
        sourceDigest: snapshot.sourceDigest, allocations: current.allocations,
        effects: current.effects }),
      afterSummary: JSON.stringify({ kind: REVIEW_KIND, loanId: loan.id,
        planHash: current.planHash, groups }), appliedAt,
    })
    // The original plan is pinned to the historical review instant; the proof
    // of an application made today must use an observation at or after appliedAt.
    const observedAt = new Date(Math.max(Date.now(), appliedAt.getTime()))
    const postSnapshot = await loadFullyPaidAllocationSnapshot(loan.id, observedAt, tx)
    const after = planFullyPaidAllocationRepair(postSnapshot)
    if (after.status !== "noop" || after.effects.length !== 0 ||
        postSnapshot.correctionProof?.run.id !== runId) {
      throw new Error(`Payment allocation did not reconcile after posting: ${after.blockers.join("; ")}`)
    }
    return { runId, alreadyApplied: false }
  })
}
