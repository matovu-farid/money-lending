import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { resetDb, seedCategories, testDb } from "./setup";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { rolloverCorrectionRuns } from "@/lib/db/schema/rollover-correction-runs";
import { financialCorrectionAgentReviews } from "@/lib/db/schema/financial-correction-agent-reviews";
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review";
import { verifyRolloverCorrectionBackup } from "@/lib/interest/rollover-backup";
import { user } from "@/lib/db/schema/auth";
import { loadRolloverCorrectionPlans } from "../rollover-correction.service";
import { applyRolloverCorrection, reviewRolloverCorrection } from "../rollover-correction-apply.service";
import { getLoanBalancesFromLedger, getPaymentOverpaymentFromLedger,
  getRolloverInterestSettledFromLedger } from "../ledger-queries.service";

const date = (day: string) => new Date(`${day}T00:00:00Z`);
vi.mock("@/lib/interest/rollover-backup", () => ({
  verifyRolloverCorrectionBackup: vi.fn(async () => ({
    dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
  })),
}));
const gate = () => ({ manifestPath: "/private/tmp/integration.dump.manifest.json",
  expectedDumpSha256: "b".repeat(64), primaryUrl: process.env.DATABASE_URL!,
  directUrl: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! });

async function seedSamuelChain() {
  await seedCategories();
  const categoryRows = await testDb.select().from(transactionCategories);
  const category = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]));
  const [customer] = await testDb.insert(customers).values({
    fullName: "Fixture Borrower", nin: "C0000000000000",
    contact: "+256700000000", address: "Kampala",
  }).returning();
  const loanRows: (typeof loans.$inferSelect)[] = [];
  for (const item of [
    { day: "2026-08-28", principal: "15000000", rollover: null, from: null, status: "rolled_over" as const },
    { day: "2026-09-18", principal: "26550000", rollover: "16550000", from: 0, status: "rolled_over" as const },
    { day: "2026-10-01", principal: "29858500", rollover: "26858500", from: 1, status: "rolled_over" as const },
    { day: "2026-10-08", principal: "32346227", rollover: "30346227", from: 2, status: "active" as const },
  ]) {
    const [loan] = await testDb.insert(loans).values({
      customerId: customer.id,
      principalAmount: item.principal,
      rolloverAmount: item.rollover,
      rolledOverFrom: item.from === null ? null : loanRows[item.from].id,
      startDate: date(item.day), createdAt: date(item.day),
      interestRate: "0.1000", minInterestDays: 30,
      issuanceFee: "0", status: item.status,
      issuedBy: "actor-1", disbursementSource: "cash",
    }).returning();
    loanRows.push(loan);
  }

  async function pair(left: {
    loanId: string; name: string; type: "debit" | "credit"; refType: string; refId: string;
  }, right: {
    loanId: string; name: string; type: "debit" | "credit"; refType: string; refId: string;
  }, amount: string, at: Date) {
    const journalGroupId = randomUUID();
    await testDb.insert(transactions).values([left, right].map((leg) => ({
      loanId: leg.loanId, categoryId: category[leg.name], type: leg.type,
      referenceType: leg.refType, referenceId: leg.refId,
      amount, transactionDate: at, journalGroupId, recordedBy: "actor-1",
      depositLocation: leg.name === "Cash" ? ("cash" as const) : null,
    })));
  }

  for (const [index, amount] of ["15000000", "10000000", "3000000", "2000000"].entries()) {
    const id = loanRows[index].id;
    await pair(
      { loanId: id, name: "Loans Receivable", type: "debit", refType: "loan", refId: id },
      { loanId: id, name: "Cash", type: "credit", refType: "loan", refId: id },
      amount, loanRows[index].startDate,
    );
  }
  for (const [index, oldPrincipal, oldInterest] of [
    [1, "15000000", "1550000"],
    [2, "26550000", "308500"],
    [3, "29858500", "487727"],
  ] as const) {
    const oldId = loanRows[index - 1].id;
    const newId = loanRows[index].id;
    const at = loanRows[index].startDate;
    await pair(
      { loanId: newId, name: "Loans Receivable", type: "debit", refType: "rollover", refId: oldId },
      { loanId: oldId, name: "Loans Receivable", type: "credit", refType: "rollover", refId: newId },
      oldPrincipal, at,
    );
    await pair(
      { loanId: newId, name: "Loans Receivable", type: "debit", refType: "rollover", refId: oldId },
      { loanId: newId, name: "Interest Earned", type: "credit", refType: "rollover", refId: oldId },
      oldInterest, at,
    );
  }
  return loanRows;
}

describe("rollover correction apply", () => {
  beforeEach(async () => {
    await resetDb();
    await testDb.update(user).set({ role: "superAdmin" }).where(eq(user.id, "actor-1"));
    vi.mocked(verifyRolloverCorrectionBackup).mockResolvedValue({
      dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
    });
  });

  it("corrects a same-day predecessor receipt without moving its cash or loan attribution", async () => {
    const chain = await seedSamuelChain();
    const predecessor = chain[0];
    const successor = chain[1];
    const receiptDate = new Date("2026-09-18T12:00:00.000Z");
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const [payment] = await testDb.insert(payments).values({
      loanId: predecessor.id, paymentDate: receiptDate, amount: "1000000",
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning();
    const group = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: predecessor.id, categoryId: categories.Cash, type: "debit",
        amount: "1000000", referenceType: "payment", referenceId: payment.id,
        transactionDate: receiptDate, journalGroupId: group, recordedBy: "actor-1",
        depositLocation: "cash" },
      { loanId: predecessor.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "500000", referenceType: "payment", referenceId: payment.id,
        transactionDate: receiptDate, journalGroupId: group, recordedBy: "actor-1" },
      { loanId: predecessor.id, categoryId: categories["Loans Receivable"], type: "credit",
        amount: "500000", referenceType: "payment", referenceId: payment.id,
        transactionDate: receiptDate, journalGroupId: group, recordedBy: "actor-1" },
    ]);
    const rolloverRows = (await testDb.select().from(transactions)).filter((row) =>
      row.referenceType === "rollover" && row.transactionDate.getTime() ===
        successor.startDate.getTime() &&
      [predecessor.id, successor.id].includes(row.loanId ?? ""));
    expect(rolloverRows).toHaveLength(4);
    for (const row of rolloverRows) {
      await testDb.update(transactions).set({ amount: row.amount === "15000000.00"
        ? "14500000.00" : "2050000.00" }).where(eq(transactions.id, row.id));
    }
    const cashBefore = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === categories.Cash)
      .map((row) => `${row.id}:${row.loanId}:${row.amount}:${row.transactionDate.toISOString()}`);
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("review");
    expect(plan.settlementChanges).toContainEqual(expect.objectContaining({
      id: payment.id, loanId: predecessor.id, newInterest: "1000000.00",
      newPrincipal: "0.00" }));
    await reviewRolloverCorrection(plan, "agent:reviewer", "same-day-review");
    expect((await applyRolloverCorrection(plan, "agent:executor", gate())).applied).toBe(true);
    const [storedPayment] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(storedPayment.loanId).toBe(predecessor.id);
    expect(storedPayment.paymentDate).toEqual(receiptDate);
    expect(storedPayment.amount).toBe("1000000.00");
    const cashAfter = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === categories.Cash)
      .map((row) => `${row.id}:${row.loanId}:${row.amount}:${row.transactionDate.toISOString()}`);
    expect(cashAfter).toEqual(cashBefore);
    const balances = await getLoanBalancesFromLedger(chain.map((loan) => loan.id));
    expect(balances.get(predecessor.id)?.toFixed(2)).toBe("0.00");
    const [correctedSuccessor] = await testDb.select().from(loans)
      .where(eq(loans.id, successor.id));
    expect(correctedSuccessor.principalAmount).toBe("25500000.00");
    const [after] = (await loadRolloverCorrectionPlans()).plans;
    expect(after.edges.every((edge) => edge.deltaPrincipal === "0")).toBe(true);
    expect(after.settlementChanges.every((change) =>
      change.oldInterest === change.newInterest &&
      change.oldPrincipal === change.newPrincipal)).toBe(true);
    // A balanced payment group with no chain loan ID must still be discovered
    // by its receipt reference and invalidate the supposedly settled source.
    const disconnectedGroup = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: null, categoryId: categories["Loans Receivable"], type: "debit", amount: "100",
        referenceType: "payment", referenceId: payment.id,
        transactionDate: receiptDate, journalGroupId: disconnectedGroup,
        recordedBy: "actor-1" },
      { loanId: null, categoryId: categories["Loans Receivable"], type: "credit",
        amount: "100", referenceType: "payment", referenceId: payment.id,
        transactionDate: receiptDate, journalGroupId: disconnectedGroup,
        recordedBy: "actor-1" },
    ]);
    const [tampered] = (await loadRolloverCorrectionPlans()).plans;
    expect(tampered.classification).toBe("blocked");
    expect(tampered.exceptions).toContainEqual(expect.stringMatching(
      /same-day.*journal.*predecessor/i));
  });

  it("corrects the whole chain with balanced non-cash entries and is idempotent", async () => {
    const chain = await seedSamuelChain();
    const before = await loadRolloverCorrectionPlans();
    expect(before.plans).toHaveLength(1);
    expect(before.plans[0].classification).toBe("ready");
    const [cashCategory] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Cash"));
    const cashBefore = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === cashCategory.id)
      .map((row) => `${row.type}:${row.amount}`);

    await reviewRolloverCorrection(before.plans[0], "agent:reviewer", "review-run-1");
    const first = await applyRolloverCorrection(before.plans[0], "agent:executor", gate());
    expect(first.applied).toBe(true);
    const corrected = await testDb.select().from(loans);
    expect(chain.slice(1).map((row) => corrected.find((loan) => loan.id === row.id)?.principalAmount))
      .toEqual(["26500000.00", "30648333.00", "33363461.00"]);
    const balances = await getLoanBalancesFromLedger(chain.map((loan) => loan.id));
    expect(chain.slice(0, 3).map((loan) => balances.get(loan.id)?.toFixed(2)))
      .toEqual(["0.00", "0.00", "0.00"]);
    expect(balances.get(chain[3].id)?.toFixed(2)).toBe("33363461.00");
    const settled = await getRolloverInterestSettledFromLedger([chain[1].id]);
    expect(settled.get(chain[1].id)?.toFixed(2)).toBe("1500000.00");

    const cashAfter = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === cashCategory.id)
      .map((row) => `${row.type}:${row.amount}`);
    expect(cashAfter).toEqual(cashBefore);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(1);
    const groups = new Map<string, number>();
    for (const row of await testDb.select().from(transactions)) {
      if (!row.journalGroupId) continue;
      groups.set(row.journalGroupId, (groups.get(row.journalGroupId) ?? 0) +
        (row.type === "debit" ? Number(row.amount) : -Number(row.amount)));
    }
    expect([...groups.values()].every((balance) => balance === 0)).toBe(true);
    const count = (await testDb.select().from(transactions)).length;
    const repeat = await applyRolloverCorrection(before.plans[0], "agent:executor", gate());
    expect(repeat.applied).toBe(false);
    expect((await testDb.select().from(transactions)).length).toBe(count);
    const [run] = await testDb.select().from(rolloverCorrectionRuns);
    const [review] = await testDb.select().from(financialCorrectionAgentReviews);
    expect(run).toEqual(expect.objectContaining({ reviewedBy: null,
      appliedByAgent: "agent:executor", agentReviewId: review.id }));
    expect(review.consumedByRunId).toBe(run.id);
    const after = await loadRolloverCorrectionPlans();
    expect(after.plans[0].edges.every((edge) => edge.deltaPrincipal === "0")).toBe(true);
  });

  it("rejects a stale plan without changing loans, journals, or run history", async () => {
    const chain = await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    await testDb.update(loans).set({ interestRate: "0.0900" })
      .where(eq(loans.id, chain[0].id));
    const beforeEntries = (await testDb.select().from(transactions)).length;
    await expect(applyRolloverCorrection(plan, "agent:executor", gate())).rejects.toThrow(/stale/);
    expect((await testDb.select().from(transactions)).length).toBe(beforeEntries);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
    const [unchanged] = await testDb.select().from(loans).where(eq(loans.id, chain[1].id));
    expect(unchanged.principalAmount).toBe("26550000.00");
  });

  it("invalidates approval when a source cash journal changes", async () => {
    const chain = await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    const [cashCategory] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Cash"));
    const [cashEntry] = (await testDb.select().from(transactions))
      .filter((row) => row.loanId === chain[0].id && row.categoryId === cashCategory.id);
    await testDb.update(transactions).set({ depositLocation: "strong_room" })
      .where(eq(transactions.id, cashEntry.id));
    await expect(applyRolloverCorrection(plan, "agent:executor", gate())).rejects.toThrow(/stale/);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
  });

  it("waits for a concurrent change to a null-loan journal leg before validating the plan", async () => {
    const chain = await seedSamuelChain();
    const [cashCategory] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Cash"));
    const [cashLeg] = (await testDb.select().from(transactions))
      .filter((row) => row.loanId === chain[0].id && row.categoryId === cashCategory.id);
    await testDb.update(transactions).set({ loanId: null })
      .where(eq(transactions.id, cashLeg.id));
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("ready");
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");

    let releaseWriter!: () => void;
    let writerReady!: () => void;
    const writerReadyPromise = new Promise<void>((resolve) => { writerReady = resolve; });
    const writerReleasePromise = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = testDb.transaction(async (tx) => {
      await tx.update(transactions).set({ depositLocation: "strong_room" })
        .where(eq(transactions.id, cashLeg.id));
      writerReady();
      await writerReleasePromise;
    });
    await writerReadyPromise;
    let finished = false;
    const apply = applyRolloverCorrection(plan, "agent:executor", gate())
      .finally(() => { finished = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(finished).toBe(false);
    } finally {
      releaseWriter();
      await writer;
    }
    await expect(apply).rejects.toThrow(/stale/);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
  });

  it("returns the first run when an identical retry waited for its source lock", async () => {
    await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");

    let releaseAudit!: () => void;
    let auditReady!: () => void;
    const ready = new Promise<void>((resolve) => { auditReady = resolve; });
    const released = new Promise<void>((resolve) => { releaseAudit = resolve; });
    const auditBlocker = testDb.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE`);
      auditReady();
      await released;
    });
    await ready;

    async function waitForSourceLock(granted: boolean) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await testDb.execute(sql`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE relation = 'public.loans'::regclass
            AND mode = 'ShareRowExclusiveLock' AND granted = ${granted}
        `);
        if (Number(rows[0]?.count) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for source lock granted=${granted}`);
    }

    const first = applyRolloverCorrection(plan, "agent:executor", gate())
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    let second: typeof first | undefined;
    try {
      await waitForSourceLock(true);
      second = applyRolloverCorrection(plan, "agent:executor", gate())
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitForSourceLock(false);
    } finally {
      releaseAudit();
      await auditBlocker;
    }
    const firstResult = await first;
    const secondResult = await second!;
    expect(firstResult).toHaveProperty("value", expect.objectContaining({ applied: true }));
    expect(secondResult).toHaveProperty("value", {
      applied: false, runId: "value" in firstResult ? firstResult.value.runId : null,
    });
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(1);
  });

  it("rejects a ready plan without an agent review", async () => {
    await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await expect(applyRolloverCorrection(plan, "agent:executor", gate()))
      .rejects.toThrow(/agent review/);
  });

  it("refuses a later failed agent review for the same chain", async () => {
    await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-pass");
    await testDb.insert(financialCorrectionAgentReviews).values({
      kind: "rollover_correction", subjectId: plan.edges[0].predecessorId,
      planHash: plan.planHash, inputFingerprint: plan.inputFingerprint,
      policyVersion: plan.policyVersion, reviewerAgentId: "agent:reviewer-2",
      reviewRunId: "review-run-fail", evidenceJson: "{}",
      evidenceSha256: hashReviewEvidence({}), verdict: "fail",
      findingsJson: JSON.stringify({ checks: ["source"], issues: ["contradictory evidence"] }),
      reviewedAt: new Date(Date.now() + 1000),
    });
    await expect(applyRolloverCorrection(plan, "agent:executor", gate()))
      .rejects.toThrow(/passing agent review/i);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
  });

  it("rejects an invalid backup inside the apply service", async () => {
    await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    vi.mocked(verifyRolloverCorrectionBackup)
      .mockRejectedValueOnce(new Error("Invalid rollover backup"));
    await expect(applyRolloverCorrection(plan, "agent:executor", gate()))
      .rejects.toThrow(/backup/i);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
  });

  it("requires separate named reviewer and executor agents", async () => {
    await seedSamuelChain();
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    await expect(reviewRolloverCorrection(plan, "test-actor", "review-run-1"))
      .rejects.toThrow(/agent/);
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    await expect(applyRolloverCorrection(plan, "agent:reviewer", gate()))
      .rejects.toThrow(/distinct/);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
  });

  it("reclassifies payment and waiver allocations without changing cash or loss totals", async () => {
    const chain = await seedSamuelChain();
    const last = chain[3];
    const categoryRows = await testDb.select().from(transactionCategories);
    const category = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]));
    const [payment] = await testDb.insert(payments).values({
      loanId: last.id, paymentDate: date("2026-10-09"), amount: "1000000",
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning();
    const [waiver] = await testDb.insert(loanWaivers).values({
      loanId: last.id, waiverDate: date("2026-10-10"), amount: "500000",
      reason: "Fixture agreement", recordedBy: "actor-1",
    }).returning();
    for (const [referenceType, referenceId, at, debitCategory, creditCategory, amount] of [
      ["payment", payment.id, date("2026-10-09"), "Cash", "Interest Earned", "100000"],
      ["payment", payment.id, date("2026-10-09"), "Cash", "Loans Receivable", "900000"],
      ["loan_waiver", waiver.id, date("2026-10-10"), "Loan Losses", "Interest Earned", "100000"],
      ["loan_waiver", waiver.id, date("2026-10-10"), "Loan Losses", "Loans Receivable", "400000"],
    ] as const) {
      const journalGroupId = randomUUID();
      await testDb.insert(transactions).values([
        { loanId: last.id, categoryId: category[debitCategory], type: "debit",
          amount, referenceType, referenceId, transactionDate: at,
          journalGroupId, recordedBy: "actor-1",
          depositLocation: debitCategory === "Cash" ? "cash" : null },
        { loanId: last.id, categoryId: category[creditCategory], type: "credit",
          amount, referenceType, referenceId, transactionDate: at,
          journalGroupId, recordedBy: "actor-1" },
      ]);
    }
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("review");
    expect(plan.settlementChanges).toHaveLength(2);
    const beforeRows = await testDb.select().from(transactions);
    const cashBefore = beforeRows.filter((row) => row.categoryId === category.Cash)
      .reduce((total, row) => total + (row.type === "debit" ? 1 : -1) * Number(row.amount), 0);
    const lossesBefore = beforeRows.filter((row) => row.categoryId === category["Loan Losses"])
      .reduce((total, row) => total + (row.type === "debit" ? 1 : -1) * Number(row.amount), 0);
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    expect((await applyRolloverCorrection(plan, "agent:executor", gate())).applied).toBe(true);
    const rows = await testDb.select().from(transactions);
    const cashAfter = rows.filter((row) => row.categoryId === category.Cash)
      .reduce((total, row) => total + (row.type === "debit" ? 1 : -1) * Number(row.amount), 0);
    const lossesAfter = rows.filter((row) => row.categoryId === category["Loan Losses"])
      .reduce((total, row) => total + (row.type === "debit" ? 1 : -1) * Number(row.amount), 0);
    expect(cashAfter).toBe(cashBefore);
    expect(lossesAfter).toBe(lossesBefore);
    const [after] = (await loadRolloverCorrectionPlans()).plans;
    expect(after.settlementChanges.every((change) =>
      change.oldInterest === change.newInterest &&
      change.oldPrincipal === change.newPrincipal)).toBe(true);
    expect(after.edges.every((edge) => edge.deltaPrincipal === "0")).toBe(true);
  });

  it("replays a fully paid loan's overpayment without changing its cash receipt or status", async () => {
    const chain = await seedSamuelChain();
    const last = chain[3];
    await testDb.update(loans).set({ status: "fully_paid" }).where(eq(loans.id, last.id));
    const [overpaymentCategory] = await testDb.insert(transactionCategories).values({
      name: "Overpayment Revenue", type: "revenue", isDefault: true,
    }).returning();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const [payment] = await testDb.insert(payments).values({
      loanId: last.id, paymentDate: date("2026-10-09"), amount: "34000000",
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning();
    for (const [creditCategory, amount] of [
      ["Interest Earned", "107821"],
      ["Loans Receivable", "32346227"],
      ["Overpayment Revenue", "1545952"],
    ] as const) {
      const journalGroupId = randomUUID();
      await testDb.insert(transactions).values([
        { loanId: last.id, categoryId: categories.Cash, type: "debit", amount,
          referenceType: "payment", referenceId: payment.id,
          transactionDate: payment.paymentDate, journalGroupId, recordedBy: "actor-1",
          depositLocation: "cash" },
        { loanId: last.id, categoryId: categories[creditCategory], type: "credit", amount,
          referenceType: "payment", referenceId: payment.id,
          transactionDate: payment.paymentDate, journalGroupId, recordedBy: "actor-1" },
      ]);
    }
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("review");
    expect(plan.settlementChanges).toEqual([
      expect.objectContaining({ oldOverpayment: "1545952.00" }),
    ]);
    const cashBefore = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === categories.Cash)
      .map((row) => `${row.type}:${row.amount}`);
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    expect((await applyRolloverCorrection(plan, "agent:executor", gate())).applied).toBe(true);
    const cashAfter = (await testDb.select().from(transactions))
      .filter((row) => row.categoryId === categories.Cash)
      .map((row) => `${row.type}:${row.amount}`);
    expect(cashAfter).toEqual(cashBefore);
    const [updated] = await testDb.select().from(loans).where(eq(loans.id, last.id));
    expect(updated.status).toBe("fully_paid");
    expect((await getLoanBalancesFromLedger([last.id])).get(last.id)?.toFixed(2)).toBe("0.00");
    const overpayment = await getPaymentOverpaymentFromLedger([payment.id]);
    expect(overpayment.get(payment.id)).toBe(plan.settlementChanges[0].newOverpayment);
    expect((await testDb.select().from(transactions))
      .some((row) => row.categoryId === overpaymentCategory.id && row.type === "debit"))
      .toBe(true);
    const [after] = (await loadRolloverCorrectionPlans()).plans;
    expect(after.edges.every((edge) => edge.deltaPrincipal === "0")).toBe(true);
    expect(after.settlementChanges.every((change) =>
      change.oldOverpayment === change.newOverpayment &&
      change.oldInterest === change.newInterest &&
      change.oldPrincipal === change.newPrincipal)).toBe(true);
  });

  it("applies a predecessor payment reclassification even when successor principal stays equal", async () => {
    await seedCategories();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const [customer] = await testDb.insert(customers).values({
      fullName: "Payment Fixture", nin: "C1111111111111",
      contact: "+256700000001", address: "Kampala",
    }).returning();
    const [root] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "15000000", startDate: date("2026-08-28"),
      createdAt: date("2026-08-28"), interestRate: "0.1000", minInterestDays: 30,
      issuanceFee: "0", status: "rolled_over", issuedBy: "actor-1", disbursementSource: "cash",
    }).returning();
    const [next] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "25500000", rolloverAmount: "15500000",
      rolledOverFrom: root.id, startDate: date("2026-09-18"),
      createdAt: date("2026-09-18"), interestRate: "0.1000", minInterestDays: 30,
      issuanceFee: "0", status: "active", issuedBy: "actor-1", disbursementSource: "cash",
    }).returning();
    const [payment] = await testDb.insert(payments).values({
      loanId: root.id, paymentDate: date("2026-09-05"), amount: "1000000",
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning();
    const pair = async (debit: { loanId: string; category: string; refType: string; refId: string },
      credit: { loanId: string; category: string; refType: string; refId: string },
      amount: string, at: Date) => {
      const journalGroupId = randomUUID();
      await testDb.insert(transactions).values([
        { loanId: debit.loanId, categoryId: categories[debit.category], type: "debit",
          amount, referenceType: debit.refType, referenceId: debit.refId,
          transactionDate: at, journalGroupId, recordedBy: "actor-1",
          depositLocation: debit.category === "Cash" ? "cash" : null },
        { loanId: credit.loanId, categoryId: categories[credit.category], type: "credit",
          amount, referenceType: credit.refType, referenceId: credit.refId,
          transactionDate: at, journalGroupId, recordedBy: "actor-1",
          depositLocation: credit.category === "Cash" ? "cash" : null },
      ]);
    };
    await pair(
      { loanId: root.id, category: "Loans Receivable", refType: "loan", refId: root.id },
      { loanId: root.id, category: "Cash", refType: "loan", refId: root.id },
      "15000000", root.startDate);
    for (const [creditCategory, amount] of [["Interest Earned", "500000"],
      ["Loans Receivable", "500000"]] as const) {
      await pair(
        { loanId: root.id, category: "Cash", refType: "payment", refId: payment.id },
        { loanId: root.id, category: creditCategory, refType: "payment", refId: payment.id },
        amount, payment.paymentDate);
    }
    await pair(
      { loanId: next.id, category: "Loans Receivable", refType: "loan", refId: next.id },
      { loanId: next.id, category: "Cash", refType: "loan", refId: next.id },
      "10000000", next.startDate);
    await pair(
      { loanId: next.id, category: "Loans Receivable", refType: "rollover", refId: root.id },
      { loanId: root.id, category: "Loans Receivable", refType: "rollover", refId: next.id },
      "14500000", next.startDate);
    await pair(
      { loanId: next.id, category: "Loans Receivable", refType: "rollover", refId: root.id },
      { loanId: next.id, category: "Interest Earned", refType: "rollover", refId: root.id },
      "1000000", next.startDate);

    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("review");
    expect(plan.edges[0].deltaPrincipal).toBe("0");
    expect(plan.settlementChanges[0]).toEqual(expect.objectContaining({
      oldInterest: "500000.00", newInterest: "1000000.00",
      oldPrincipal: "500000.00", newPrincipal: "0.00",
    }));
    await reviewRolloverCorrection(plan, "agent:reviewer", "review-run-1");
    expect((await applyRolloverCorrection(plan, "agent:executor", gate())).applied).toBe(true);
    const balances = await getLoanBalancesFromLedger([root.id, next.id]);
    expect(balances.get(root.id)?.toFixed(2)).toBe("0.00");
    expect(balances.get(next.id)?.toFixed(2)).toBe("25500000.00");
    const [after] = (await loadRolloverCorrectionPlans()).plans;
    expect(after.settlementChanges[0].oldInterest).toBe(after.settlementChanges[0].newInterest);
    expect((await applyRolloverCorrection(plan, "agent:executor", gate())).applied).toBe(false);
  });

  it("blocks a pre-existing receivable discrepancy before any adjustment", async () => {
    const chain = await seedSamuelChain();
    const categoryRows = await testDb.select().from(transactionCategories);
    const receivableId = categoryRows.find((row) => row.name === "Loans Receivable")!.id;
    const lossId = categoryRows.find((row) => row.name === "Loan Losses")!.id;
    const journalGroupId = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: chain[3].id, categoryId: receivableId, type: "debit", amount: "100",
        referenceType: "manual_test", referenceId: chain[3].id,
        transactionDate: date("2026-10-09"), journalGroupId, recordedBy: "actor-1" },
      { loanId: chain[3].id, categoryId: lossId, type: "credit", amount: "100",
        referenceType: "manual_test", referenceId: chain[3].id,
        transactionDate: date("2026-10-09"), journalGroupId, recordedBy: "actor-1" },
    ]);
    const [plan] = (await loadRolloverCorrectionPlans()).plans;
    expect(plan.classification).toBe("blocked");
    const beforeEntries = (await testDb.select().from(transactions)).length;
    await expect(applyRolloverCorrection(plan, "agent:executor", gate()))
      .rejects.toThrow(/non-blocked rollover plan/);
    expect((await testDb.select().from(transactions)).length).toBe(beforeEntries);
    expect(await testDb.select().from(rolloverCorrectionRuns)).toHaveLength(0);
    const [unchanged] = await testDb.select().from(loans).where(eq(loans.id, chain[1].id));
    expect(unchanged.principalAmount).toBe("26550000.00");
  });
});
