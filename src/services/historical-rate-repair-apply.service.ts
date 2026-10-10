import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import BigNumber from "bignumber.js";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { loans } from "@/lib/db/schema/loans";
import { loanBalances } from "@/lib/db/schema/loan-balances";
import { auditLog } from "@/lib/db/schema/audit";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { historicalRateRepairApprovals, historicalRateRepairRuns } from
  "@/lib/db/schema/historical-rate-repair-runs";
import type { HistoricalRatePlan } from "@/lib/interest/historical-rate-repair";
import { verifyHistoricalRateBackup } from "@/lib/interest/historical-rate-backup";
import { loadHistoricalRateRepairPlan, loadHistoricalRateRepairPlanInSnapshot } from
  "./historical-rate-repair.service";

type QueryDb = Pick<typeof db, "select">;

async function assertAdministrator(actorId: string, queryDb: QueryDb): Promise<void> {
  const [actor] = await queryDb.select({ role: user.role }).from(user)
    .where(eq(user.id, actorId));
  if (!actor || !["admin", "superAdmin"].includes(actor.role ?? "")) {
    throw new Error("Historical rate repair requires an identified administrator");
  }
}

/** Bind a named administrator's review to one immutable, current plan. */
export async function approveHistoricalRateRepair(
  reviewedPlan: HistoricalRatePlan,
  approvedBy: string,
  reviewNote: string,
): Promise<string> {
  if (!approvedBy || !reviewNote.trim() || reviewedPlan.classification !== "review") {
    throw new Error("A reviewable plan, administrator, and substantive note are required");
  }
  if (reviewedPlan.asOf > new Date()) {
    throw new Error("A future as-of instant cannot be approved");
  }
  await assertAdministrator(approvedBy, db);
  const current = await loadHistoricalRateRepairPlan(
    reviewedPlan.loanId, reviewedPlan.asOf, reviewedPlan.policyVersion,
  );
  if (current.classification !== "review" ||
      current.planHash !== reviewedPlan.planHash ||
      current.inputFingerprint !== reviewedPlan.inputFingerprint) {
    throw new Error("Historical rate repair plan changed before approval");
  }
  const [approval] = await db.insert(historicalRateRepairApprovals).values({
    loanId: current.loanId,
    planHash: current.planHash,
    inputFingerprint: current.inputFingerprint,
    policyVersion: current.policyVersion,
    approvedBy,
    reviewNote: reviewNote.trim(),
  }).onConflictDoNothing().returning({ id: historicalRateRepairApprovals.id });
  if (approval) return approval.id;
  const [existing] = await db.select({ id: historicalRateRepairApprovals.id })
    .from(historicalRateRepairApprovals)
    .where(eq(historicalRateRepairApprovals.planHash, current.planHash));
  if (!existing) throw new Error("Historical rate repair approval was not recorded");
  return existing.id;
}

type BackupGate = Parameters<typeof verifyHistoricalRateBackup>[0];

/** Apply one exact, approved plan. Every accounting and audit write commits together. */
export async function applyHistoricalRateRepair(
  reviewedPlan: HistoricalRatePlan,
  appliedBy: string,
  backupGate: BackupGate,
): Promise<{ runId: string; alreadyApplied: boolean }> {
  if (!appliedBy || reviewedPlan.classification !== "review" ||
      reviewedPlan.asOf > new Date()) {
    throw new Error("A current review plan and identified administrator are required");
  }
  if (!process.env.DATABASE_URL ||
      backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Backup database identity does not match the configured live connection");
  }
  await assertAdministrator(appliedBy, db);
  const [approval] = await db.select().from(historicalRateRepairApprovals)
    .where(eq(historicalRateRepairApprovals.planHash, reviewedPlan.planHash));
  if (!approval || approval.loanId !== reviewedPlan.loanId ||
      approval.inputFingerprint !== reviewedPlan.inputFingerprint ||
      approval.policyVersion !== reviewedPlan.policyVersion) {
    throw new Error("Exact historical rate repair approval is required");
  }
  const [priorRun] = await db.select({ id: historicalRateRepairRuns.id })
    .from(historicalRateRepairRuns)
    .where(eq(historicalRateRepairRuns.planHash, reviewedPlan.planHash));
  if (priorRun) return { runId: priorRun.id, alreadyApplied: true };
  const backup = await verifyHistoricalRateBackup(backupGate);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`);
    const configured = new URL(backupGate.primaryUrl);
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Backup database identity does not match the live database session");
    }
    await tx.execute(sql`SELECT id FROM loans WHERE id = ${reviewedPlan.loanId} FOR UPDATE`);
    await assertAdministrator(appliedBy, tx);
    const [alreadyApplied] = await tx.select({ id: historicalRateRepairRuns.id })
      .from(historicalRateRepairRuns)
      .where(eq(historicalRateRepairRuns.planHash, reviewedPlan.planHash));
    if (alreadyApplied) return { runId: alreadyApplied.id, alreadyApplied: true };
    const current = await loadHistoricalRateRepairPlanInSnapshot(
      tx, reviewedPlan.loanId, reviewedPlan.asOf, reviewedPlan.policyVersion,
    );
    if (current.classification !== "review" ||
        current.planHash !== reviewedPlan.planHash ||
        current.inputFingerprint !== reviewedPlan.inputFingerprint) {
      throw new Error("Historical rate repair source changed or plan is stale");
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
          transactionDate: change.date, recordedBy: appliedBy,
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
          transactionDate: current.asOf, recordedBy: appliedBy,
          description: `Historical rate repair ${current.planHash}`,
        });
      }
    }
    if (entries.length) await tx.insert(transactions).values(entries);
    await tx.insert(auditLog).values({
      actorId: appliedBy, action: "loan.rate_change.admin_adjusted",
      entityType: "loan", entityId: current.loanId,
      beforeValue: JSON.stringify({ interestRateOverride: current.correctedRate }),
      afterValue: JSON.stringify({
        interestRateOverride: current.correctedRate,
        rateSemantics: "correction", effectiveFrom: loan.startDate.toISOString(),
        repairedPlanHash: current.planHash,
      }),
    });
    const after = await loadHistoricalRateRepairPlanInSnapshot(
      tx, current.loanId, current.asOf, current.policyVersion,
    );
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
    const [run] = await tx.insert(historicalRateRepairRuns).values({
      loanId: current.loanId, planHash: current.planHash,
      inputFingerprint: current.inputFingerprint,
      policyVersion: current.policyVersion,
      reviewedBy: approval.approvedBy, backupSha256: backup.dumpSha256,
      beforeSummary: JSON.stringify(current), afterSummary: JSON.stringify(after),
    }).returning({ id: historicalRateRepairRuns.id });
    return { runId: run.id, alreadyApplied: false };
  });
}
