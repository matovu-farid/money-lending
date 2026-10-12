import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedCategories, testDb } from "./setup";
import { user } from "@/lib/db/schema/auth";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { loanBalances } from "@/lib/db/schema/loan-balances";
import { payments } from "@/lib/db/schema/payments";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { auditLog } from "@/lib/db/schema/audit";
import { historicalRateRepairRuns } from
  "@/lib/db/schema/historical-rate-repair-runs";
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews";
import type { HistoricalRatePlan } from "@/lib/interest/historical-rate-repair";
import { loadHistoricalRateRepairPlan } from "../historical-rate-repair.service";
import { reviewHistoricalRateRepair, applyHistoricalRateRepair } from
  "../historical-rate-repair-apply.service";

const { proofState } = vi.hoisted(() => ({ proofState: {
  plan: null as HistoricalRatePlan | null,
  override: {} as Record<string, unknown>,
} }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: vi.fn(async (path: string, options?: BufferEncoding) => {
    if (!path.endsWith("integration.dump.historical-restore.json")) {
      return original.readFile(path, options);
    }
    const plan = proofState.plan;
    if (!plan) throw new Error("No reviewed historical plan for test proof");
    const url = new URL(process.env.DATABASE_URL!);
    return JSON.stringify({
      dumpSha256: "b".repeat(64), sourceHost: url.hostname,
      sourceDatabase: decodeURIComponent(url.pathname.slice(1)),
      restoredDatabase: "money_lending_rehearsal_historical_test",
      restoredAt: new Date().toISOString(), auditTablesPresent: true,
      loanRows: 1, transactionRows: 5, categoryRows: 7,
      paymentRows: 1, waiverRows: 0, rateRequestRows: 0, auditRows: 1,
      targetLoanId: plan.loanId, planHash: plan.planHash,
      inputFingerprint: plan.inputFingerprint, policyVersion: plan.policyVersion,
      asOf: plan.asOf.toISOString(),
      rehearsalRunId: "22222222-2222-4222-8222-222222222222",
      postPlanHash: "c".repeat(64), postClassification: "noop",
      endingPrincipal: Number(plan.endingPrincipal).toFixed(2),
      postEndingPrincipal: Number(plan.endingPrincipal).toFixed(2),
      postAccrualDelta: "0.00", paymentsUnchanged: true,
      cashUnchanged: true, journalGroupsBalanced: true,
      nonCashCorrection: true,
      ...proofState.override,
    });
  }) };
});

vi.mock("@/lib/interest/historical-rate-backup", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interest/historical-rate-backup")>(),
  verifyHistoricalRateBackup: vi.fn(async () => ({
    dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
  })),
}));

const backupGate = (plan?: HistoricalRatePlan) => {
  if (plan) proofState.plan = plan;
  return {
    manifestPath: "/private/tmp/integration.dump.manifest.json",
    expectedDumpSha256: "b".repeat(64),
    primaryUrl: process.env.DATABASE_URL!,
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  };
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function seedLoan() {
  await seedCategories();
  await testDb.insert(transactionCategories).values({
    name: "Overpayment Revenue", type: "revenue", isDefault: true,
  });
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]));
  const [customer] = await testDb.insert(customers).values({
    fullName: "Apply Fixture", nin: "C1234567890999",
    contact: "+256700000099", address: "Kampala",
  }).returning();
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id, principalAmount: "30000",
    interestRate: "0.1000", interestRateOverride: "0.1500",
    startDate: day("2026-01-01"), createdAt: day("2026-03-01"),
    minInterestDays: 0, issuanceFee: "0", status: "active",
    issuedBy: "actor-1", disbursementSource: "cash",
  }).returning();
  const [payment] = await testDb.insert(payments).values({
    loanId: loan.id, amount: "5000", paymentDate: day("2026-01-11"),
    recordedBy: "actor-1", depositLocation: "cash",
  }).returning();
  const issueGroup = randomUUID();
  const paymentGroup = randomUUID();
  await testDb.insert(transactions).values([
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "debit",
      amount: "30000", referenceType: "loan", referenceId: loan.id,
      journalGroupId: issueGroup, transactionDate: loan.startDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "credit",
      amount: "30000", referenceType: "loan", referenceId: loan.id,
      depositLocation: "cash", journalGroupId: issueGroup,
      transactionDate: loan.startDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "debit",
      amount: "5000", referenceType: "payment", referenceId: payment.id,
      depositLocation: "cash", journalGroupId: paymentGroup,
      transactionDate: payment.paymentDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
      amount: "3000", referenceType: "payment", referenceId: payment.id,
      journalGroupId: paymentGroup, transactionDate: payment.paymentDate,
      recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "credit",
      amount: "2000", referenceType: "payment", referenceId: payment.id,
      journalGroupId: paymentGroup, transactionDate: payment.paymentDate,
      recordedBy: "actor-1" },
  ]);
  await testDb.insert(auditLog).values({
    actorId: "actor-1", action: "loan.rate_change.admin_adjusted",
    entityType: "loan", entityId: loan.id,
    beforeValue: JSON.stringify({ interestRate: "0.1000" }),
    afterValue: JSON.stringify({ interestRateOverride: "0.1500" }),
    occurredAt: day("2026-04-01"),
  });
  return { loan, payment };
}

describe("historical paid-rate agent review and apply", () => {
  beforeEach(async () => {
    proofState.plan = null;
    proofState.override = {};
    await resetDb();
    await testDb.update(user).set({ role: "superAdmin" }).where(eq(user.id, "admin-1"));
  });

  it("stores independent evidence only for the exact current plan and a named agent", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(plan.classification).toBe("review");

    await expect(reviewHistoricalRateRepair(plan, "actor-1", "attempt-1"))
      .rejects.toThrow(/agent/i);
    expect(await testDb.select().from(financialCorrectionAgentReviews)).toHaveLength(0);

    const reviewed = await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    expect(reviewed).toMatchObject({ verdict: "pass", findings: [] });
    expect(reviewed.reviewId).toMatch(/^[a-f0-9-]{36}$/);
    const reviews = await testDb.select().from(financialCorrectionAgentReviews);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      subjectId: loan.id, planHash: plan.planHash,
      inputFingerprint: plan.inputFingerprint,
      reviewerAgentId: "agent:history-reviewer", verdict: "pass",
    });

    await testDb.update(loans).set({ penaltyMultiplier: "0.2000" })
      .where(eq(loans.id, loan.id));
    await expect(reviewHistoricalRateRepair(
      plan, "agent:history-reviewer", "attempt-2",
    )).rejects.toThrow(/changed|stale/i);
    expect(await testDb.select().from(financialCorrectionAgentReviews)).toHaveLength(1);
  });

  it("replays agent-reviewed allocations atomically without changing Cash or duplicate runs", async () => {
    const { loan, payment } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    const reviewed = await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    expect(reviewed.verdict).toBe("pass");
    const cashCategory = (await testDb.select().from(transactionCategories))
      .find((category) => category.name === "Cash");
    expect(cashCategory).toBeDefined();
    const beforeCash = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === cashCategory?.id);

    const result = await applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan));
    expect(result.alreadyApplied).toBe(false);
    expect(result.runId).toMatch(/^[a-f0-9-]{36}$/);
    const after = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(after.classification).toBe("noop");
    expect(after.changes.find((change) => change.id === payment.id)).toMatchObject({
      oldInterest: "1500.00", oldPrincipal: "3500.00",
      newInterest: "1500.00", newPrincipal: "3500.00",
    });
    expect(after.endingPrincipal).toBe("26500");
    const [balance] = await testDb.select().from(loanBalances)
      .where(eq(loanBalances.loanId, loan.id));
    expect(balance.outstandingBalance).toBe("26500.00");
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(1);
    const [run] = await testDb.select().from(historicalRateRepairRuns);
    expect(run).toMatchObject({ reviewedBy: null, agentReviewId: reviewed.reviewId,
      appliedByAgent: "agent:history-executor" });
    const [review] = await testDb.select().from(financialCorrectionAgentReviews);
    expect(review.consumedByRunId).toBe(result.runId);
    const agentAudit = (await testDb.select().from(auditLog))
      .find((row) => row.action === "historical_rate_corrected_by_agent");
    expect(agentAudit?.actorId).toBeNull();
    expect(JSON.parse(agentAudit?.afterValue ?? "{}")).toMatchObject({
      agentReviewId: reviewed.reviewId, executorAgentId: "agent:history-executor",
      repairRunId: result.runId,
    });
    expect((await testDb.select().from(transactions))
      .filter((row) => beforeCash.some((cash) => cash.id === row.id))).toEqual(beforeCash);
    expect((await testDb.select().from(transactions))
      .filter((row) => row.categoryId === beforeCash[0].categoryId)).toEqual(beforeCash);
    const correctionRows = (await testDb.select().from(transactions))
      .filter((row) => row.description === `Historical rate repair ${plan.planHash}`);
    expect(correctionRows.filter((row) => row.referenceId === payment.id)
      .every((row) => row.transactionDate.getTime() === payment.paymentDate.getTime()))
      .toBe(true);
    expect(correctionRows.filter((row) => row.referenceType === "interest_accrual")
      .every((row) => row.transactionDate.getTime() === plan.asOf.getTime()))
      .toBe(true);

    const lineCount = (await testDb.select().from(transactions)).length;
    const repeated = await applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan));
    expect(repeated).toEqual({ runId: result.runId, alreadyApplied: true });
    expect((await testDb.select().from(transactions)).length).toBe(lineCount);
  });

  it("refuses an unreviewed or stale plan without writing journals", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    const count = (await testDb.select().from(transactions)).length;
    await expect(applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan)))
      .rejects.toThrow(/review/i);
    await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    await testDb.update(loans).set({ penaltyMultiplier: "0.2000" })
      .where(eq(loans.id, loan.id));
    await expect(applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan)))
      .rejects.toThrow(/changed|stale/i);
    expect((await testDb.select().from(transactions)).length).toBe(count);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
  });

  it("rejects the same agent as reviewer and executor", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    await expect(applyHistoricalRateRepair(plan, "agent:history-reviewer", backupGate(plan)))
      .rejects.toThrow(/distinct/i);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
  });

  it("rejects an old calculation policy even if its source still matches", async () => {
    const { loan } = await seedLoan();
    const oldPlan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"), "v1");
    await expect(reviewHistoricalRateRepair(oldPlan, "agent:history-reviewer", "attempt-1"))
      .rejects.toThrow(/reviewable plan/i);
    await expect(applyHistoricalRateRepair(oldPlan, "agent:history-executor", backupGate(oldPlan)))
      .rejects.toThrow(/current review plan/i);
  });

  it("rejects tampered independent evidence without consuming the review", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    const reviewed = await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    await testDb.update(financialCorrectionAgentReviews).set({ evidenceSha256: "c".repeat(64) })
      .where(eq(financialCorrectionAgentReviews.id, reviewed.reviewId));
    await expect(applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan)))
      .rejects.toThrow(/digest/i);
    const [review] = await testDb.select().from(financialCorrectionAgentReviews);
    expect(review.consumedAt).toBeNull();
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
  });

  it("rejects backup identity supplied for a database other than the live connection", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    await expect(applyHistoricalRateRepair(plan, "agent:history-executor", {
      ...backupGate(plan),
      primaryUrl: "postgresql://faridmatovu@127.0.0.1:55439/another_database",
      directUrl: "postgresql://faridmatovu@127.0.0.1:55439/another_database",
    })).rejects.toThrow(/database identity|configured/i);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
  });

  it("rejects a restore proof for another plan without posting journals or consuming review", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    const reviewed = await reviewHistoricalRateRepair(plan, "agent:history-reviewer", "attempt-1");
    const journalCount = (await testDb.select().from(transactions)).length;
    proofState.override = { planHash: "d".repeat(64) };

    await expect(applyHistoricalRateRepair(plan, "agent:history-executor", backupGate(plan)))
      .rejects.toThrow(/restore proof does not match the reviewed plan/i);

    expect((await testDb.select().from(transactions)).length).toBe(journalCount);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
    const [review] = await testDb.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, reviewed.reviewId));
    expect(review.consumedAt).toBeNull();
  });

  it("blocks a preview with accrual journals later than its as-of instant", async () => {
    const { loan } = await seedLoan();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const groupId = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "100", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: groupId, transactionDate: day("2026-02-11"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "100", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: groupId, transactionDate: day("2026-02-11"), recordedBy: "actor-1" },
    ]);
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions.join(" ")).toMatch(/later accrual/i);
  });
});
