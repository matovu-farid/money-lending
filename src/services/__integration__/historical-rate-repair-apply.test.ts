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
import { historicalRateRepairApprovals } from
  "@/lib/db/schema/historical-rate-repair-runs";
import { historicalRateRepairRuns } from
  "@/lib/db/schema/historical-rate-repair-runs";
import { loadHistoricalRateRepairPlan } from "../historical-rate-repair.service";
import { approveHistoricalRateRepair, applyHistoricalRateRepair } from
  "../historical-rate-repair-apply.service";

vi.mock("@/lib/interest/historical-rate-backup", () => ({
  verifyHistoricalRateBackup: vi.fn(async () => ({
    dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
  })),
}));

const backupGate = {
  manifestPath: "/private/tmp/integration.dump.manifest.json",
  expectedDumpSha256: "b".repeat(64),
  primaryUrl: "postgresql://faridmatovu@127.0.0.1:55439/money_lending_integration_test",
  directUrl: "postgresql://faridmatovu@127.0.0.1:55439/money_lending_integration_test",
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

describe("historical paid-rate correction approval and apply", () => {
  beforeEach(async () => {
    await resetDb();
    await testDb.update(user).set({ role: "superAdmin" }).where(eq(user.id, "admin-1"));
  });

  it("stores approval only for the exact current review plan and an identified administrator", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(plan.classification).toBe("review");

    await expect(approveHistoricalRateRepair(plan, "actor-1", "Reviewed allocations"))
      .rejects.toThrow(/administrator/i);
    expect(await testDb.select().from(historicalRateRepairApprovals)).toHaveLength(0);

    const approvalId = await approveHistoricalRateRepair(
      plan, "admin-1", "Reviewed payment allocation and accrued interest",
    );
    expect(approvalId).toMatch(/^[a-f0-9-]{36}$/);
    const approvals = await testDb.select().from(historicalRateRepairApprovals);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      loanId: loan.id, planHash: plan.planHash,
      inputFingerprint: plan.inputFingerprint, approvedBy: "admin-1",
    });

    await testDb.update(loans).set({ penaltyMultiplier: "0.2000" })
      .where(eq(loans.id, loan.id));
    await expect(approveHistoricalRateRepair(
      plan, "admin-1", "Stale payment allocation",
    )).rejects.toThrow(/changed|stale/i);
    expect(await testDb.select().from(historicalRateRepairApprovals)).toHaveLength(1);
  });

  it("replays approved allocations atomically without changing Cash or duplicate runs", async () => {
    const { loan, payment } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    await approveHistoricalRateRepair(plan, "admin-1", "Reviewed corrected allocation");
    const cashCategory = (await testDb.select().from(transactionCategories))
      .find((category) => category.name === "Cash");
    expect(cashCategory).toBeDefined();
    const beforeCash = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === cashCategory?.id);

    const result = await applyHistoricalRateRepair(plan, "admin-1", backupGate);
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
    const repeated = await applyHistoricalRateRepair(plan, "admin-1", backupGate);
    expect(repeated).toEqual({ runId: result.runId, alreadyApplied: true });
    expect((await testDb.select().from(transactions)).length).toBe(lineCount);
  });

  it("refuses an unapproved or stale plan without writing journals", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    const count = (await testDb.select().from(transactions)).length;
    await expect(applyHistoricalRateRepair(plan, "admin-1", backupGate))
      .rejects.toThrow(/approval/i);
    await approveHistoricalRateRepair(plan, "admin-1", "Reviewed corrected allocation");
    await testDb.update(loans).set({ penaltyMultiplier: "0.2000" })
      .where(eq(loans.id, loan.id));
    await expect(applyHistoricalRateRepair(plan, "admin-1", backupGate))
      .rejects.toThrow(/changed|stale/i);
    expect((await testDb.select().from(transactions)).length).toBe(count);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
  });

  it("rejects backup identity supplied for a database other than the live connection", async () => {
    const { loan } = await seedLoan();
    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    await approveHistoricalRateRepair(plan, "admin-1", "Reviewed corrected allocation");
    await expect(applyHistoricalRateRepair(plan, "admin-1", {
      ...backupGate,
      primaryUrl: "postgresql://faridmatovu@127.0.0.1:55439/another_database",
      directUrl: "postgresql://faridmatovu@127.0.0.1:55439/another_database",
    })).rejects.toThrow(/database identity|configured/i);
    expect(await testDb.select().from(historicalRateRepairRuns)).toHaveLength(0);
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
