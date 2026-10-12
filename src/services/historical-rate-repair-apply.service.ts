import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import BigNumber from "bignumber.js";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { loanBalances } from "@/lib/db/schema/loan-balances";
import { auditLog } from "@/lib/db/schema/audit";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { historicalRateRepairRuns } from
  "@/lib/db/schema/historical-rate-repair-runs";
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews";
import type { HistoricalRatePlan } from "@/lib/interest/historical-rate-repair";
import { planHistoricalRateRepair } from "@/lib/interest/historical-rate-repair";
import { assertMatchingPassingAgentReview, hashReviewEvidence } from
  "@/lib/financial-corrections/agent-review";
import { normalizedHistoricalJournalEffects, verifyHistoricalRateEvidence } from
  "@/lib/financial-corrections/historical-rate-verifier";
import { validHistoricalRestoreProof, verifyHistoricalRateBackup } from
  "@/lib/interest/historical-rate-backup";
import { loadHistoricalRateSnapshotInSnapshot } from
  "./historical-rate-repair.service";

const REVIEW_KIND = "historical_rate";

/** Record a distinct agent's independent, exact-source calculation and findings. */
export async function reviewHistoricalRateRepair(
  reviewedPlan: HistoricalRatePlan,
  reviewerAgentId: string,
  reviewRunId: string,
): Promise<{ reviewId: string; verdict: "pass" | "fail"; findings: string[] }> {
  if (!reviewerAgentId.startsWith("agent:") || reviewerAgentId.trim() === "agent:" ||
      !reviewRunId.trim() || reviewedPlan.policyVersion !== "v2" ||
      reviewedPlan.classification !== "review") {
    throw new Error("A reviewable plan and identified reviewing agent run are required");
  }
  if (reviewedPlan.asOf > new Date()) {
    throw new Error("A future as-of instant cannot be reviewed");
  }
  const snapshot = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return loadHistoricalRateSnapshotInSnapshot(tx, reviewedPlan.loanId, reviewedPlan.asOf);
  });
  const current = planHistoricalRateRepair(snapshot, reviewedPlan.policyVersion);
  if (current.classification !== "review" ||
      current.planHash !== reviewedPlan.planHash ||
      current.inputFingerprint !== reviewedPlan.inputFingerprint) {
    throw new Error("Historical rate repair plan changed before agent review");
  }
  let evidence: unknown;
  let verdict: "pass" | "fail" = "pass";
  let findings: string[] = [];
  try {
    evidence = verifyHistoricalRateEvidence(snapshot, current);
  } catch (error) {
    verdict = "fail";
    findings = [error instanceof Error ? error.message : "Independent historical check failed"];
    evidence = { loanId: current.loanId, asOf: current.asOf.toISOString(),
      planHash: current.planHash, failedCheck: findings[0] };
  }
  const evidenceJson = JSON.stringify(evidence);
  const evidenceSha256 = hashReviewEvidence(evidence);
  const findingsJson = JSON.stringify({ checks: ["source", "dated settlements",
    "interest-first allocations", "accrual and balanced deltas"], issues: findings });
  const [inserted] = await db.insert(financialCorrectionAgentReviews).values({
    kind: REVIEW_KIND, subjectId: current.loanId, planHash: current.planHash,
    inputFingerprint: current.inputFingerprint, policyVersion: current.policyVersion,
    reviewerAgentId, reviewRunId, evidenceSha256, evidenceJson, verdict, findingsJson,
  }).onConflictDoNothing().returning({ id: financialCorrectionAgentReviews.id });
  if (inserted) return { reviewId: inserted.id, verdict, findings };
  const [existing] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, current.planHash),
      eq(financialCorrectionAgentReviews.reviewRunId, reviewRunId)));
  if (!existing || existing.reviewerAgentId !== reviewerAgentId ||
      existing.evidenceSha256 !== evidenceSha256 || existing.verdict !== verdict ||
      existing.findingsJson !== findingsJson) {
    throw new Error("Conflicting historical agent review attempt already exists");
  }
  return { reviewId: existing.id, verdict, findings };
}

type BackupGate = Parameters<typeof verifyHistoricalRateBackup>[0];

type HistoricalProofPlan = Pick<HistoricalRatePlan, "loanId" | "planHash" |
  "inputFingerprint" | "policyVersion" | "asOf">;

export function assertHistoricalRestoreProofMatchesPlan(
  proof: unknown, plan: HistoricalProofPlan,
): void {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new Error("Historical restore proof does not match the reviewed plan");
  }
  const record = proof as Record<string, unknown>;
  if (record.targetLoanId !== plan.loanId ||
      record.planHash !== plan.planHash ||
      record.inputFingerprint !== plan.inputFingerprint ||
      record.policyVersion !== plan.policyVersion ||
      record.asOf !== plan.asOf.toISOString()) {
    throw new Error("Historical restore proof does not match the reviewed plan");
  }
}

async function assertHistoricalBackupMatchesPlan(
  gate: BackupGate, backup: Awaited<ReturnType<typeof verifyHistoricalRateBackup>>,
  plan: HistoricalProofPlan,
): Promise<void> {
  const primary = new URL(gate.primaryUrl);
  const database = decodeURIComponent(primary.pathname.slice(1));
  const localRehearsal = ["localhost", "127.0.0.1", "[::1]"].includes(primary.hostname) &&
    /^money_lending_rehearsal_historical_[a-z0-9_]+$/.test(database) &&
    gate.primaryUrl === gate.directUrl;
  let proof: unknown;
  try {
    proof = JSON.parse(await readFile(`${backup.dumpPath}.historical-restore.json`, "utf8"));
  } catch (error) {
    // The backup verifier permits proof-free posting only inside its isolated
    // rehearsal context; production must always present the exact proof.
    if (localRehearsal && error && typeof error === "object" &&
        "code" in error && error.code === "ENOENT") return;
    throw new Error("Historical restore proof cannot be read for the reviewed plan");
  }
  const source = new URL(gate.directUrl);
  if (!validHistoricalRestoreProof(proof, {
    dumpSha256: backup.dumpSha256, sourceHost: source.hostname,
    sourceDatabase: decodeURIComponent(source.pathname.slice(1)),
  })) {
    throw new Error("Historical restore proof is invalid for the selected archive");
  }
  assertHistoricalRestoreProofMatchesPlan(proof, plan);
}

/** Apply one exact, independently reviewed plan atomically with audit and journals. */
export async function applyHistoricalRateRepair(
  reviewedPlan: HistoricalRatePlan,
  executorAgentId: string,
  backupGate: BackupGate,
): Promise<{ runId: string; alreadyApplied: boolean }> {
  if (!executorAgentId.startsWith("agent:") || executorAgentId.trim() === "agent:" ||
      reviewedPlan.policyVersion !== "v2" || reviewedPlan.classification !== "review" ||
      reviewedPlan.asOf > new Date()) {
    throw new Error("A current review plan and identified executor agent are required");
  }
  if (!process.env.DATABASE_URL ||
      backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Backup database identity does not match the configured live connection");
  }
  const [priorRun] = await db.select({ id: historicalRateRepairRuns.id })
    .from(historicalRateRepairRuns)
    .where(eq(historicalRateRepairRuns.planHash, reviewedPlan.planHash));
  if (priorRun) return { runId: priorRun.id, alreadyApplied: true };
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, reviewedPlan.planHash)))
    .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
      desc(financialCorrectionAgentReviews.id)).limit(1);
  if (!review) throw new Error("Exact passing historical agent review is required");
  assertMatchingPassingAgentReview(review, {
    kind: REVIEW_KIND, subjectId: reviewedPlan.loanId, planHash: reviewedPlan.planHash,
    inputFingerprint: reviewedPlan.inputFingerprint,
    policyVersion: reviewedPlan.policyVersion,
  }, executorAgentId);
  const backup = await verifyHistoricalRateBackup(backupGate);
  await assertHistoricalBackupMatchesPlan(backupGate, backup, reviewedPlan);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`);
    const configured = new URL(backupGate.primaryUrl);
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Backup database identity does not match the live database session");
    }
    const [alreadyApplied] = await tx.select({ id: historicalRateRepairRuns.id })
      .from(historicalRateRepairRuns)
      .where(eq(historicalRateRepairRuns.planHash, reviewedPlan.planHash));
    if (alreadyApplied) return { runId: alreadyApplied.id, alreadyApplied: true };
    const [lockedReview] = await tx.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, review.id)).for("update");
    if (!lockedReview) throw new Error("Historical agent review disappeared before posting");
    assertMatchingPassingAgentReview(lockedReview, {
      kind: REVIEW_KIND, subjectId: reviewedPlan.loanId,
      planHash: reviewedPlan.planHash,
      inputFingerprint: reviewedPlan.inputFingerprint,
      policyVersion: reviewedPlan.policyVersion,
    }, executorAgentId);
    await tx.execute(sql`SELECT id FROM loans WHERE id = ${reviewedPlan.loanId} FOR UPDATE`);
    const snapshot = await loadHistoricalRateSnapshotInSnapshot(
      tx, reviewedPlan.loanId, reviewedPlan.asOf,
    );
    const current = planHistoricalRateRepair(snapshot, reviewedPlan.policyVersion);
    if (current.classification !== "review" ||
        current.planHash !== reviewedPlan.planHash ||
        current.inputFingerprint !== reviewedPlan.inputFingerprint) {
      throw new Error("Historical rate repair source changed or plan is stale");
    }
    const evidence = verifyHistoricalRateEvidence(snapshot, current);
    if (hashReviewEvidence(evidence) !== lockedReview.evidenceSha256) {
      throw new Error("Historical agent review evidence no longer matches source accounting");
    }
    const [loan] = await tx.select().from(loans).where(eq(loans.id, current.loanId));
    if (!loan || loan.status !== "active") {
      throw new Error("Historical rate repair requires an active, unchanged loan");
    }
    const names = ["Interest Earned", "Loans Receivable", "Overpayment Revenue",
      "Interest Receivable"];
    const categories = await tx.select().from(transactionCategories)
      .where(inArray(transactionCategories.name, names));
    const categoryId = new Map(categories.map((category) => [category.name, category.id]));
    if (categoryId.size !== names.length || categories.length !== names.length) {
      throw new Error("Historical rate repair accounting categories are ambiguous");
    }
    const categoryTypes = new Map<string, string>([
      ["Interest Earned", "revenue"], ["Loans Receivable", "asset"],
      ["Overpayment Revenue", "revenue"], ["Interest Receivable", "asset"],
    ]);
    if (categories.some((category) => category.type !== categoryTypes.get(category.name))) {
      throw new Error("Historical rate repair accounting category type is incorrect");
    }
    const entries: typeof transactions.$inferInsert[] = [];
    const runId = randomUUID();
    for (const change of current.changes) {
      const deltas = [
        ["Interest Earned", new BigNumber(change.newInterest).minus(change.oldInterest)],
        ["Loans Receivable", new BigNumber(change.newPrincipal).minus(change.oldPrincipal)],
        ["Overpayment Revenue", new BigNumber(change.newOverpayment).minus(change.oldOverpayment)],
      ] as const;
      if (!deltas.reduce((total, [, amount]) => total.plus(amount),
        new BigNumber(0)).isZero()) {
        throw new Error(`Settlement ${change.id} correction does not balance`);
      }
      const groupId = randomUUID();
      for (const [name, delta] of deltas) {
        if (delta.isZero()) continue;
        entries.push({
          loanId: current.loanId, categoryId: categoryId.get(name)!,
          type: delta.gt(0) ? "credit" : "debit",
          amount: delta.abs().toFixed(2),
          referenceType: change.kind === "payment" ? "payment" : "loan_waiver",
          referenceId: change.id, journalGroupId: groupId,
          transactionDate: change.date, recordedBy: executorAgentId,
          description: `Historical rate repair ${current.planHash}`,
        });
      }
    }
    const accrualDelta = new BigNumber(current.accrualJournalDelta ?? "NaN");
    if (!accrualDelta.isFinite()) {
      throw new Error("Historical rate repair accrual journal delta is unavailable");
    }
    if (!accrualDelta.isZero()) {
      const groupId = randomUUID();
      const positive = accrualDelta.gt(0);
      for (const [name, type] of [
        ["Interest Receivable", positive ? "debit" : "credit"],
        ["Interest Earned", positive ? "credit" : "debit"],
      ] as const) {
        entries.push({
          loanId: current.loanId, categoryId: categoryId.get(name)!, type,
          amount: accrualDelta.abs().toFixed(2), referenceType: "interest_accrual",
          referenceId: current.loanId, journalGroupId: groupId,
          transactionDate: current.asOf, recordedBy: executorAgentId,
          description: `Historical rate repair ${current.planHash}`,
        });
      }
    }
    const categoryName = new Map(categories.map((category) => [category.id, category.name]));
    const actualEffects = normalizedHistoricalJournalEffects(entries.map((entry) => ({
      categoryName: categoryName.get(entry.categoryId ?? "") ?? "",
      type: entry.type, amount: String(entry.amount),
      referenceType: entry.referenceType ?? "", referenceId: entry.referenceId ?? "",
      date: entry.transactionDate instanceof Date
        ? entry.transactionDate.toISOString() : "",
    })));
    if (entries.some((entry) => entry.loanId !== current.loanId ||
        entry.recordedBy !== executorAgentId) ||
        JSON.stringify(actualEffects) !== JSON.stringify(evidence.expectedEntries)) {
      throw new Error("Historical correction journals differ from independently checked effects");
    }
    if (entries.length) await tx.insert(transactions).values(entries);
    await tx.insert(auditLog).values({
      actorId: null, action: "historical_rate_corrected_by_agent",
      entityType: "loan", entityId: current.loanId,
      beforeValue: JSON.stringify({ interestRateOverride: current.correctedRate }),
      afterValue: JSON.stringify({
        interestRateOverride: current.correctedRate,
        rateSemantics: "correction", effectiveFrom: loan.startDate.toISOString(),
        repairedPlanHash: current.planHash, agentReviewId: lockedReview.id,
        reviewerAgentId: lockedReview.reviewerAgentId, executorAgentId,
        reviewRunId: lockedReview.reviewRunId, repairRunId: runId,
      }),
    });
    const after = planHistoricalRateRepair(await loadHistoricalRateSnapshotInSnapshot(
      tx, current.loanId, current.asOf,
    ), current.policyVersion);
    if (after.classification !== "noop" ||
        after.endingPrincipal !== current.endingPrincipal ||
        after.accrualJournalDelta !== "0.00" ||
        after.changes.some((change) =>
          !new BigNumber(change.oldInterest).eq(change.newInterest) ||
          !new BigNumber(change.oldPrincipal).eq(change.newPrincipal) ||
          !new BigNumber(change.oldOverpayment).eq(change.newOverpayment))) {
      throw new Error(`Historical rate repair failed post-write reconciliation: ${JSON.stringify({
        classification: after.classification, exceptions: after.exceptions,
        endingPrincipal: after.endingPrincipal, expectedPrincipal: current.endingPrincipal,
        accrualDelta: after.accrualJournalDelta,
        allocations: after.changes.map((change) => ({
          id: change.id, oldInterest: change.oldInterest,
          newInterest: change.newInterest, oldPrincipal: change.oldPrincipal,
          newPrincipal: change.newPrincipal,
        })),
      })}`);
    }
    const [projection] = await tx.select({ principal: loanBalances.outstandingBalance })
      .from(loanBalances).where(eq(loanBalances.loanId, current.loanId));
    if (!projection || !new BigNumber(projection.principal)
      .eq(current.endingPrincipal ?? "NaN")) {
      throw new Error("Historical rate repair did not refresh the loan balance projection");
    }
    const [consumed] = await tx.update(financialCorrectionAgentReviews).set({
      consumedAt: new Date(), consumedByRunId: runId,
    }).where(and(eq(financialCorrectionAgentReviews.id, lockedReview.id),
      isNull(financialCorrectionAgentReviews.consumedAt)))
      .returning({ id: financialCorrectionAgentReviews.id });
    if (!consumed) throw new Error("Historical agent review was already consumed");
    await tx.insert(historicalRateRepairRuns).values({
      id: runId,
      loanId: current.loanId, planHash: current.planHash,
      inputFingerprint: current.inputFingerprint,
      policyVersion: current.policyVersion,
      reviewedBy: null, agentReviewId: lockedReview.id,
      appliedByAgent: executorAgentId, backupSha256: backup.dumpSha256,
      beforeSummary: JSON.stringify(current), afterSummary: JSON.stringify(after),
    });
    return { runId, alreadyApplied: false };
  });
}
