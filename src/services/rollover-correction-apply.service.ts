import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { rolloverCorrectionRuns } from "@/lib/db/schema/rollover-correction-runs";
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews";
import { auditLog } from "@/lib/db/schema/audit";
import type { CorrectionPlan, SettlementChange } from "@/lib/interest/rollover-correction";
import { ROLLOVER_CORRECTION_POLICY_VERSION } from "@/lib/interest/rollover-correction";
import { assertMatchingPassingAgentReview, hashReviewEvidence } from
  "@/lib/financial-corrections/agent-review";
import { verifyRolloverCorrectionEvidence } from
  "@/lib/financial-corrections/rollover-verifier";
import { verifyRolloverCorrectionBackup } from "@/lib/interest/rollover-backup";
import { getLoanBalancesFromLedger, getRolloverInterestSettledFromLedger } from "./ledger-queries.service";
import { loadRolloverCorrectionPlans, loadRolloverCorrectionPlansInSnapshot } from "./rollover-correction.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const REVIEW_KIND = "rollover_correction";
type BackupGate = Parameters<typeof verifyRolloverCorrectionBackup>[0];

type LedgerRow = {
  loanId: string | null;
  referenceId: string | null;
  categoryName: string;
  type: "debit" | "credit";
  amount: string;
};

function net(rows: LedgerRow[], loanId: string, referenceId: string,
  categoryName: string, positive: "debit" | "credit"): BigNumber {
  return rows.reduce((total, row) => {
    if (row.loanId !== loanId || row.referenceId !== referenceId ||
        row.categoryName !== categoryName) return total;
    return row.type === positive ? total.plus(row.amount) : total.minus(row.amount);
  }, new BigNumber(0));
}

async function postInterestDelta(tx: Tx, params: {
  predecessorId: string; successorId: string; amount: BigNumber;
  at: Date; actorId: string; receivableId: string; interestId: string; runId: string;
}) {
  if (params.amount.isZero()) return;
  const positive = params.amount.gt(0);
  const journalGroupId = randomUUID();
  const common = {
    amount: params.amount.abs().toFixed(2),
    referenceType: "rollover",
    referenceId: params.predecessorId,
    loanId: params.successorId,
    transactionDate: params.at,
    recordedBy: params.actorId,
    journalGroupId,
    description: `Non-cash rollover correction ${params.runId}`,
  };
  await tx.insert(transactions).values([
    { ...common, categoryId: params.receivableId, type: positive ? "debit" : "credit" },
    { ...common, categoryId: params.interestId, type: positive ? "credit" : "debit" },
  ]);
}

async function postPrincipalDelta(tx: Tx, params: {
  predecessorId: string; successorId: string; amount: BigNumber;
  at: Date; actorId: string; receivableId: string; runId: string;
}) {
  if (params.amount.isZero()) return;
  const positive = params.amount.gt(0);
  const journalGroupId = randomUUID();
  const common = {
    amount: params.amount.abs().toFixed(2),
    referenceType: "rollover",
    categoryId: params.receivableId,
    transactionDate: params.at,
    recordedBy: params.actorId,
    journalGroupId,
    description: `Non-cash rollover correction ${params.runId}`,
  };
  await tx.insert(transactions).values([
    { ...common, loanId: params.successorId, referenceId: params.predecessorId,
      type: positive ? "debit" : "credit" },
    { ...common, loanId: params.predecessorId, referenceId: params.successorId,
      type: positive ? "credit" : "debit" },
  ]);
}

function hasAllocationDelta(change: SettlementChange): boolean {
  return !new BigNumber(change.newInterest).eq(change.oldInterest) ||
    !new BigNumber(change.newPrincipal).eq(change.oldPrincipal) ||
    !new BigNumber(change.newOverpayment).eq(change.oldOverpayment);
}

async function postSettlementReclassification(tx: Tx, change: SettlementChange,
  params: { at: Date; actorId: string; receivableId: string; interestId: string;
    overpaymentId?: string; runId: string }) {
  const interestDelta = new BigNumber(change.newInterest).minus(change.oldInterest);
  const principalDelta = new BigNumber(change.newPrincipal).minus(change.oldPrincipal);
  const overpaymentDelta = new BigNumber(change.newOverpayment).minus(change.oldOverpayment);
  if (!interestDelta.plus(principalDelta).plus(overpaymentDelta).isZero()) {
    throw new Error(`Settlement ${change.id} does not preserve its recorded amount`);
  }
  if (!overpaymentDelta.isZero() && !params.overpaymentId) {
    throw new Error("Overpayment Revenue category is missing");
  }
  const legs = [
    { categoryId: params.receivableId, delta: principalDelta },
    { categoryId: params.interestId, delta: interestDelta },
    { categoryId: params.overpaymentId, delta: overpaymentDelta },
  ].filter((leg) => !leg.delta.isZero());
  if (!legs.length) return;
  const journalGroupId = randomUUID();
  const common = {
    loanId: change.loanId,
    referenceType: change.kind === "payment" ? "payment" : "loan_waiver",
    referenceId: change.id,
    transactionDate: params.at,
    recordedBy: params.actorId,
    journalGroupId,
    description: `Non-cash settlement reclassification ${params.runId}`,
  };
  await tx.insert(transactions).values(legs.map((leg) => ({
    ...common,
    categoryId: leg.categoryId!,
    amount: leg.delta.abs().toFixed(2),
    type: leg.delta.gt(0) ? "credit" as const : "debit" as const,
  })));
}

/** Record one independent agent check of the current, source-reconciled chain. */
export async function reviewRolloverCorrection(
  reviewedPlan: CorrectionPlan, reviewerAgentId: string, reviewRunId: string,
): Promise<{ reviewId: string; verdict: "pass" | "fail"; findings: string[] }> {
  if (reviewedPlan.policyVersion !== ROLLOVER_CORRECTION_POLICY_VERSION) {
    throw new Error(`Rollover correction requires policy ${ROLLOVER_CORRECTION_POLICY_VERSION}`);
  }
  if (!reviewerAgentId.startsWith("agent:") || reviewerAgentId.trim() === "agent:" ||
      !reviewRunId.trim() || reviewedPlan.classification === "blocked" ||
      !reviewedPlan.edges.length) {
    throw new Error("A non-blocked plan and identified reviewing agent run are required");
  }
  const portfolio = await loadRolloverCorrectionPlans(reviewedPlan.policyVersion);
  const index = portfolio.plans.findIndex((plan) =>
    plan.edges[0]?.predecessorId === reviewedPlan.edges[0]?.predecessorId);
  const current = portfolio.plans[index];
  if (!current || current.classification === "blocked" ||
      JSON.stringify(current) !== JSON.stringify(reviewedPlan)) {
    throw new Error("Rollover correction plan changed before agent review");
  }
  let evidence: unknown;
  let verdict: "pass" | "fail" = "pass";
  let findings: string[] = [];
  try {
    evidence = verifyRolloverCorrectionEvidence(portfolio.chains[index], current,
      portfolio.sourceJournals);
  } catch (error) {
    verdict = "fail";
    findings = [error instanceof Error ? error.message : "Independent rollover check failed"];
    evidence = { chainRootId: current.edges[0].predecessorId,
      planHash: current.planHash, failedCheck: findings[0] };
  }
  const evidenceJson = JSON.stringify(evidence);
  const evidenceSha256 = hashReviewEvidence(evidence);
  const findingsJson = JSON.stringify({ checks: ["source chain", "dated carry",
    "settlement allocations", "balanced non-cash journal effects"], issues: findings });
  const [inserted] = await db.insert(financialCorrectionAgentReviews).values({
    kind: REVIEW_KIND, subjectId: current.edges[0].predecessorId,
    planHash: current.planHash, inputFingerprint: current.inputFingerprint,
    policyVersion: current.policyVersion, reviewerAgentId, reviewRunId,
    evidenceJson, evidenceSha256, verdict, findingsJson,
  }).onConflictDoNothing().returning({ id: financialCorrectionAgentReviews.id });
  if (inserted) return { reviewId: inserted.id, verdict, findings };
  const [existing] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.planHash, current.planHash),
      eq(financialCorrectionAgentReviews.reviewRunId, reviewRunId)));
  if (!existing || existing.reviewerAgentId !== reviewerAgentId ||
      existing.evidenceSha256 !== evidenceSha256 || existing.verdict !== verdict ||
      existing.findingsJson !== findingsJson) {
    throw new Error("Conflicting rollover agent review attempt already exists");
  }
  return { reviewId: existing.id, verdict, findings };
}

/**
 * Applies a separately agent-reviewed plan only after a verified full backup.
 */
export async function applyRolloverCorrection(
  reviewedPlan: CorrectionPlan,
  executorAgentId: string,
  backupGate: BackupGate,
): Promise<{ applied: boolean; runId: string | null }> {
  if (reviewedPlan.policyVersion !== ROLLOVER_CORRECTION_POLICY_VERSION) {
    throw new Error(`Rollover correction requires policy ${ROLLOVER_CORRECTION_POLICY_VERSION}`);
  }
  if (!executorAgentId.startsWith("agent:") || executorAgentId.trim() === "agent:" ||
      reviewedPlan.classification === "blocked" ||
      !reviewedPlan.edges.length ||
      reviewedPlan.edges.some((edge) => edge.classification === "blocked")) {
    throw new Error("Only an identified executor agent may apply a non-blocked rollover plan");
  }
  if (!process.env.DATABASE_URL || backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Rollover backup database identity does not match the live connection");
  }
  const [prior] = await db.select({ id: rolloverCorrectionRuns.id })
    .from(rolloverCorrectionRuns)
    .where(eq(rolloverCorrectionRuns.planHash, reviewedPlan.planHash));
  if (prior) return { applied: false, runId: prior.id };
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
      eq(financialCorrectionAgentReviews.subjectId, reviewedPlan.edges[0].predecessorId)))
    .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
      desc(financialCorrectionAgentReviews.id)).limit(1);
  if (!review) throw new Error("Exact passing rollover agent review is required");
  const expectedReview = { kind: REVIEW_KIND,
    subjectId: reviewedPlan.edges[0].predecessorId,
    planHash: reviewedPlan.planHash,
    inputFingerprint: reviewedPlan.inputFingerprint,
    policyVersion: reviewedPlan.policyVersion };
  assertMatchingPassingAgentReview(review, expectedReview, executorAgentId);
  const backup = await verifyRolloverCorrectionBackup(backupGate);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    // Block every source writer, including null-loan journal counterpart legs,
    // and review inserts while the latest review and chain are rechecked.
    await tx.execute(sql`LOCK TABLE loans, payments, loan_waivers,
      rate_change_requests, transactions, transaction_categories, audit_log,
      financial_correction_agent_reviews IN SHARE ROW EXCLUSIVE MODE`);
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`);
    const configured = new URL(backupGate.primaryUrl);
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Rollover backup identity does not match the live database session");
    }
    const [alreadyApplied] = await tx.select().from(rolloverCorrectionRuns)
      .where(eq(rolloverCorrectionRuns.planHash, reviewedPlan.planHash));
    if (alreadyApplied) return { applied: false, runId: alreadyApplied.id };
    const [latestReview] = await tx.select({ id: financialCorrectionAgentReviews.id })
      .from(financialCorrectionAgentReviews)
      .where(and(eq(financialCorrectionAgentReviews.kind, REVIEW_KIND),
        eq(financialCorrectionAgentReviews.subjectId, expectedReview.subjectId)))
      .orderBy(desc(financialCorrectionAgentReviews.reviewedAt),
        desc(financialCorrectionAgentReviews.id)).limit(1);
    if (latestReview?.id !== review.id) {
      throw new Error("Rollover agent review was superseded before posting");
    }
    const [lockedReview] = await tx.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, review.id)).for("update");
    if (!lockedReview) throw new Error("Rollover agent review disappeared before posting");
    assertMatchingPassingAgentReview(lockedReview, expectedReview, executorAgentId);
    const chainIds = [...new Set(reviewedPlan.edges.flatMap((edge) =>
      [edge.predecessorId, edge.successorId]))].sort();
    const locked = await tx.select().from(loans)
      .where(inArray(loans.id, chainIds)).orderBy(loans.id).for("update");
    if (locked.length !== chainIds.length) throw new Error("Rollover chain changed since review");
    await tx.select({ id: transactions.id }).from(transactions)
      .where(inArray(transactions.loanId, chainIds))
      .orderBy(transactions.id).for("update");
    const byId = new Map(locked.map((loan) => [loan.id, loan]));
    const currentPortfolio = await loadRolloverCorrectionPlansInSnapshot(tx, reviewedPlan.policyVersion);
    const currentIndex = currentPortfolio.plans.findIndex((plan) =>
      plan.edges[0]?.predecessorId === reviewedPlan.edges[0]?.predecessorId);
    const current = currentPortfolio.plans[currentIndex];
    if (!current || current.classification === "blocked" ||
        JSON.stringify(current) !== JSON.stringify(reviewedPlan)) {
      throw new Error("Rollover correction plan is stale or now blocked");
    }
    const evidence = verifyRolloverCorrectionEvidence(
      currentPortfolio.chains[currentIndex], current, currentPortfolio.sourceJournals);
    if (hashReviewEvidence(evidence) !== lockedReview.evidenceSha256) {
      throw new Error("Rollover agent review evidence no longer matches source accounting");
    }
    if (current.edges.every((edge) => new BigNumber(edge.deltaPrincipal).isZero()) &&
        current.settlementChanges.every((change) => !hasAllocationDelta(change))) {
      return { applied: false, runId: null };
    }

    const categories = await tx.select().from(transactionCategories)
      .where(inArray(transactionCategories.name,
        ["Loans Receivable", "Interest Earned", "Overpayment Revenue"]));
    const receivableId = categories.find((row) => row.name === "Loans Receivable")?.id;
    const interestId = categories.find((row) => row.name === "Interest Earned")?.id;
    const overpaymentId = categories.find((row) => row.name === "Overpayment Revenue")?.id;
    if (!receivableId || !interestId) throw new Error("Accounting categories missing");
    const ledgerRows = await tx.select({
      loanId: transactions.loanId,
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
      type: transactions.type,
      amount: transactions.amount,
    }).from(transactions)
      .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(and(eq(transactions.referenceType, "rollover"), inArray(transactions.loanId, chainIds)));

    const runId = randomUUID();
    for (const change of current.settlementChanges.filter(hasAllocationDelta)) {
      await postSettlementReclassification(tx, change, {
        at: change.date, actorId: executorAgentId, receivableId, interestId,
        overpaymentId, runId,
      });
    }
    for (const edge of current.edges) {
      const successor = byId.get(edge.successorId)!;
      const oldInterest = net(ledgerRows, edge.successorId, edge.predecessorId,
        "Interest Earned", "credit");
      const oldPrincipal = net(ledgerRows, edge.predecessorId, edge.successorId,
        "Loans Receivable", "credit");
      const interestDelta = new BigNumber(edge.carriedInterest!).minus(oldInterest);
      const principalDelta = new BigNumber(edge.carriedPrincipal!).minus(oldPrincipal);
      await postInterestDelta(tx, {
        predecessorId: edge.predecessorId,
        successorId: edge.successorId,
        amount: interestDelta,
        at: successor.startDate,
        actorId: executorAgentId,
        receivableId,
        interestId,
        runId,
      });
      await postPrincipalDelta(tx, {
        predecessorId: edge.predecessorId,
        successorId: edge.successorId,
        amount: principalDelta,
        at: successor.startDate,
        actorId: executorAgentId,
        receivableId,
        runId,
      });
      await tx.update(loans).set({
        principalAmount: edge.proposedPrincipal,
        rolloverAmount: edge.proposedRolloverAmount,
        updatedAt: new Date(),
      }).where(eq(loans.id, edge.successorId));
      await tx.insert(auditLog).values({
        actorId: null,
        action: "loan.rollover.correction",
        entityType: "loan",
        entityId: edge.successorId,
        beforeValue: JSON.stringify({
          principalAmount: edge.originalPrincipal,
          rolloverAmount: edge.originalRolloverAmount,
        }),
        afterValue: JSON.stringify({
          principalAmount: edge.proposedPrincipal,
          rolloverAmount: edge.proposedRolloverAmount,
          settlementChanges: current.settlementChanges.filter((change) =>
            change.loanId === edge.predecessorId || change.loanId === edge.successorId),
          runId, agentReviewId: lockedReview.id,
          reviewerAgentId: lockedReview.reviewerAgentId,
          executorAgentId,
        }),
      });
    }

    const balances = await getLoanBalancesFromLedger(chainIds, undefined, tx);
    for (const edge of current.edges) {
      const balance = balances.get(edge.predecessorId) ?? new BigNumber(0);
      if (balance.abs().gte(1)) {
        throw new Error(`Predecessor receivable did not close: ${edge.predecessorId}`);
      }
    }
    const finalEdge = current.edges[current.edges.length - 1];
    const finalBalance = balances.get(finalEdge.successorId) ?? new BigNumber(0);
    const finalPrincipalSettled = current.settlementChanges
      .filter((change) => change.loanId === finalEdge.successorId)
      .reduce((total, change) => total.plus(change.newPrincipal), new BigNumber(0));
    const expectedFinalBalance = new BigNumber(finalEdge.proposedPrincipal)
      .minus(finalPrincipalSettled);
    if (finalBalance.minus(expectedFinalBalance).abs().gte(1)) {
      throw new Error("Successor receivable does not reconcile to corrected principal");
    }
    if (["fully_paid", "settled_with_collateral"].includes(byId.get(finalEdge.successorId)!.status) &&
        expectedFinalBalance.abs().gte(1)) {
      throw new Error("Closed successor would have an unsettled corrected receivable");
    }
    const settled = await getRolloverInterestSettledFromLedger(
      current.edges.map((edge) => edge.successorId), undefined, tx);
    for (const edge of current.edges) {
      if ((settled.get(edge.successorId) ?? new BigNumber(0))
        .minus(edge.carriedInterest!).abs().gte(1)) {
        throw new Error(`Rollover interest did not reconcile: ${edge.successorId}`);
      }
    }
    const afterPortfolio = await loadRolloverCorrectionPlansInSnapshot(tx, reviewedPlan.policyVersion);
    const afterPlan = afterPortfolio.plans.find((plan) =>
      plan.edges[0]?.predecessorId === current.edges[0]?.predecessorId);
    if (!afterPlan || afterPlan.classification === "blocked" ||
        afterPlan.edges.some((edge) => !new BigNumber(edge.deltaPrincipal).isZero()) ||
        afterPlan.settlementChanges.some(hasAllocationDelta)) {
      throw new Error("Corrected chain failed post-apply planning invariants");
    }
    const statusesAfter = await tx.select({ id: loans.id, status: loans.status })
      .from(loans).where(inArray(loans.id, chainIds));
    if (statusesAfter.some((loan) => loan.status !== byId.get(loan.id)?.status)) {
      throw new Error("Loan status changed during rollover correction");
    }
    const [consumed] = await tx.update(financialCorrectionAgentReviews).set({
      consumedAt: new Date(), consumedByRunId: runId,
    }).where(and(eq(financialCorrectionAgentReviews.id, lockedReview.id),
      isNull(financialCorrectionAgentReviews.consumedAt)))
      .returning({ id: financialCorrectionAgentReviews.id });
    if (!consumed) throw new Error("Rollover agent review was already consumed");
    await tx.insert(rolloverCorrectionRuns).values({
      id: runId,
      chainRootId: current.edges[0].predecessorId,
      planHash: current.planHash,
      inputFingerprint: current.inputFingerprint,
      policyVersion: current.policyVersion,
      reviewedBy: null,
      agentReviewId: lockedReview.id,
      appliedByAgent: executorAgentId,
      beforeSummary: JSON.stringify({
        backupSha256: backup.dumpSha256,
        loans: current.edges.map((edge) => ({
          loanId: edge.successorId,
          principalAmount: edge.originalPrincipal,
          rolloverAmount: edge.originalRolloverAmount,
        })),
        settlements: current.settlementChanges.map((change) => ({
          id: change.id, loanId: change.loanId, kind: change.kind,
          interestPortion: change.oldInterest, principalPortion: change.oldPrincipal,
          overpaymentPortion: change.oldOverpayment,
        })),
      }),
      afterSummary: JSON.stringify({
        loans: afterPlan.edges.map((edge) => ({
          loanId: edge.successorId,
          principalAmount: edge.originalPrincipal,
          rolloverAmount: edge.originalRolloverAmount,
        })),
        settlements: afterPlan.settlementChanges.map((change) => ({
          id: change.id, loanId: change.loanId, kind: change.kind,
          interestPortion: change.oldInterest, principalPortion: change.oldPrincipal,
          overpaymentPortion: change.oldOverpayment,
        })),
      }),
    });
    return { applied: true, runId };
  });
}
