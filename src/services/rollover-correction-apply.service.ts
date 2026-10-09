import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { rolloverCorrectionRuns } from "@/lib/db/schema/rollover-correction-runs";
import { rolloverCorrectionApprovals } from "@/lib/db/schema/rollover-correction-runs";
import { user } from "@/lib/db/schema/auth";
import type { CorrectionPlan, SettlementChange } from "@/lib/interest/rollover-correction";
import { getLoanBalancesFromLedger, getRolloverInterestSettledFromLedger } from "./ledger-queries.service";
import { loadRolloverCorrectionPlans, loadRolloverCorrectionPlansInSnapshot } from "./rollover-correction.service";
import { writeAuditLog } from "./audit.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertCorrectionActor(actorId: string, queryDb: Pick<typeof db, "select">) {
  const [actor] = await queryDb.select({ role: user.role }).from(user)
    .where(eq(user.id, actorId));
  if (!actor || !["admin", "superAdmin"].includes(actor.role ?? "")) {
    throw new Error("Rollover correction requires an identified administrator");
  }
}

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

/** Persist explicit review of one immutable, currently valid plan. */
export async function approveRolloverCorrection(
  reviewedPlan: CorrectionPlan, approvedBy: string, reviewNote: string,
): Promise<string> {
  if (!approvedBy || !reviewNote.trim() || reviewedPlan.classification === "blocked") {
    throw new Error("A non-blocked plan needs an identified reviewer and review note");
  }
  await assertCorrectionActor(approvedBy, db);
  const currentPortfolio = await loadRolloverCorrectionPlans(reviewedPlan.policyVersion);
  const current = currentPortfolio.plans.find((plan) => plan.planHash === reviewedPlan.planHash);
  if (!current || current.inputFingerprint !== reviewedPlan.inputFingerprint) {
    throw new Error("Rollover correction plan changed before approval");
  }
  const [existing] = await db.select().from(rolloverCorrectionApprovals)
    .where(eq(rolloverCorrectionApprovals.planHash, current.planHash));
  if (existing) return existing.id;
  const [approval] = await db.insert(rolloverCorrectionApprovals).values({
    chainRootId: current.edges[0].predecessorId,
    planHash: current.planHash,
    inputFingerprint: current.inputFingerprint,
    policyVersion: current.policyVersion,
    approvedBy,
    reviewNote: reviewNote.trim(),
  }).returning({ id: rolloverCorrectionApprovals.id });
  return approval.id;
}

/**
 * Applies a previously approved and revalidated plan. A blocked chain never
 * reaches this path; a review chain requires its exact fingerprint's approval.
 */
export async function applyRolloverCorrection(
  reviewedPlan: CorrectionPlan,
  reviewedBy: string,
): Promise<{ applied: boolean; runId: string | null }> {
  if (!reviewedBy || reviewedPlan.classification === "blocked" ||
      !reviewedPlan.edges.length ||
      reviewedPlan.edges.some((edge) => edge.classification === "blocked")) {
    throw new Error("Only an identified actor may apply a reviewed, non-blocked correction plan");
  }
  return db.transaction(async (tx) => {
    await assertCorrectionActor(reviewedBy, tx);
    const [approval] = await tx.select().from(rolloverCorrectionApprovals)
      .where(eq(rolloverCorrectionApprovals.planHash, reviewedPlan.planHash));
    if (!approval || approval.inputFingerprint !== reviewedPlan.inputFingerprint ||
        approval.policyVersion !== reviewedPlan.policyVersion) {
      throw new Error("Exact rollover correction plan has not been approved");
    }
    const [alreadyApplied] = await tx.select().from(rolloverCorrectionRuns)
      .where(eq(rolloverCorrectionRuns.planHash, reviewedPlan.planHash));
    if (alreadyApplied) return { applied: false, runId: alreadyApplied.id };

    // This is a rare, reviewed maintenance write. Quiesce every fingerprinted
    // source table for its duration, including null-loan counterpart journal
    // legs and new rows that a row-level lock would miss. Ordinary reads remain
    // available; concurrent source writes wait or this attempt times out safely.
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    await tx.execute(sql`LOCK TABLE loans, payments, loan_waivers,
      rate_change_requests, transactions, transaction_categories
      IN SHARE ROW EXCLUSIVE MODE`);
    const [appliedWhileWaiting] = await tx.select().from(rolloverCorrectionRuns)
      .where(eq(rolloverCorrectionRuns.planHash, reviewedPlan.planHash));
    if (appliedWhileWaiting) return { applied: false, runId: appliedWhileWaiting.id };
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
    const current = currentPortfolio.plans.find((plan) =>
      plan.edges[0]?.predecessorId === reviewedPlan.edges[0]?.predecessorId);
    if (!current || current.inputFingerprint !== reviewedPlan.inputFingerprint ||
        current.planHash !== reviewedPlan.planHash ||
        current.classification === "blocked") {
      throw new Error("Rollover correction plan is stale or now blocked");
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
        at: change.date, actorId: reviewedBy, receivableId, interestId,
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
        actorId: reviewedBy,
        receivableId,
        interestId,
        runId,
      });
      await postPrincipalDelta(tx, {
        predecessorId: edge.predecessorId,
        successorId: edge.successorId,
        amount: principalDelta,
        at: successor.startDate,
        actorId: reviewedBy,
        receivableId,
        runId,
      });
      await tx.update(loans).set({
        principalAmount: edge.proposedPrincipal,
        rolloverAmount: edge.proposedRolloverAmount,
        updatedAt: new Date(),
      }).where(eq(loans.id, edge.successorId));
      await writeAuditLog(tx, {
        actorId: reviewedBy,
        action: "loan.rollover.correction",
        entityType: "loan",
        entityId: edge.successorId,
        beforeValue: {
          principalAmount: edge.originalPrincipal,
          rolloverAmount: edge.originalRolloverAmount,
        },
        afterValue: {
          principalAmount: edge.proposedPrincipal,
          rolloverAmount: edge.proposedRolloverAmount,
          settlementChanges: current.settlementChanges.filter((change) =>
            change.loanId === edge.predecessorId || change.loanId === edge.successorId),
          runId,
        },
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
    await tx.insert(rolloverCorrectionRuns).values({
      id: runId,
      chainRootId: current.edges[0].predecessorId,
      planHash: current.planHash,
      inputFingerprint: current.inputFingerprint,
      policyVersion: current.policyVersion,
      reviewedBy,
      beforeSummary: JSON.stringify({
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
