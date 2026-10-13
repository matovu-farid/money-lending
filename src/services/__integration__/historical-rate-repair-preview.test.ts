import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedCategories, testDb } from "./setup";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { auditLog } from "@/lib/db/schema/audit";
import { financialCorrectionAgentReviews } from "@/lib/db/schema/financial-correction-agent-reviews";
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs";
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests";
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review";
import { loadHistoricalRateRepairPlan } from "../historical-rate-repair.service";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const portfolioAsOf = day("2026-02-10");
const portfolioAppliedAt = day("2026-02-12");

async function seedReviewedPortfolioAccrual(loanId: string) {
  const entry = {
    date: day("2026-01-31"), period: "2026-01", accrued: "125.00",
    settled: "0.00", existingReceivable: "0.00", delta: "125.00",
    resultingReceivable: "125.00",
  };
  const evidence = { loanId, asOf: portfolioAsOf.toISOString(),
    checkpoints: [{ ...entry, date: entry.date.toISOString() }] };
  const planHash = "c".repeat(64);
  const inputFingerprint = "a".repeat(64);
  const policyVersion = "v2";
  const [review] = await testDb.insert(financialCorrectionAgentReviews).values({
    kind: "portfolio_accrual", subjectId: loanId, planHash,
    inputFingerprint, policyVersion,
    reviewerAgentId: "agent:portfolio-reviewer", reviewRunId: randomUUID(),
    evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence),
    verdict: "pass", findingsJson: JSON.stringify({ checks: ["source", "dated checkpoints",
      "balanced non-cash journals"], issues: [] }),
    reviewedAt: day("2026-02-11"),
  }).returning();
  const [run] = await testDb.insert(portfolioAccrualRepairRuns).values({
    loanId, planHash, inputFingerprint, policyVersion,
    agentReviewId: review.id, appliedByAgent: "agent:portfolio-executor",
    backupSha256: "b".repeat(64), appliedAt: portfolioAppliedAt,
    beforeSummary: JSON.stringify({ asOf: portfolioAsOf, entries: [entry] }),
    afterSummary: JSON.stringify({ classification: "pending" }),
  }).returning();
  await testDb.update(financialCorrectionAgentReviews)
    .set({ consumedByRunId: run.id, consumedAt: portfolioAppliedAt })
    .where(eq(financialCorrectionAgentReviews.id, review.id));
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]));
  const journalGroupId = randomUUID();
  const common = { loanId, referenceType: "portfolio_accrual_repair",
    referenceId: run.id, description: `Portfolio interest repair ${run.id}`,
    transactionDate: entry.date, createdAt: portfolioAppliedAt,
    recordedBy: "agent:portfolio-executor", journalGroupId,
    amount: entry.delta };
  const journal = await testDb.insert(transactions).values([
    { ...common, categoryId: categories["Interest Receivable"], type: "debit" },
    { ...common, categoryId: categories["Interest Earned"], type: "credit" },
  ]).returning();
  return { run, review, entry, journal, categories, common };
}

function expectBlockedPortfolioProof(plan: Awaited<ReturnType<typeof loadHistoricalRateRepairPlan>>) {
  expect(plan.classification).toBe("blocked");
  expect(plan.exceptions.join(" ")).toMatch(/portfolio|reviewed.*(?:journal|proof)/i);
  expect(plan.exceptions.join(" ")).not.toMatch(/unknown source/i);
}

async function seedPaidLoan(issuanceFee = "0") {
  await seedCategories();
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]));
  if (issuanceFee !== "0") {
    const [feeCategory] = await testDb.insert(transactionCategories).values({
      name: "Issuance Fees", type: "revenue", isDefault: true,
    }).returning();
    categories["Issuance Fees"] = feeCategory.id;
  }
  const [customer] = await testDb.insert(customers).values({
    fullName: "Historical Rate Fixture", nin: "C1234567890123",
    contact: "+256700000001", address: "Kampala",
  }).returning();
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id,
    principalAmount: "30000",
    interestRate: "0.1000",
    interestRateOverride: "0.1500",
    startDate: day("2026-01-01"),
    createdAt: day("2026-03-01"),
    minInterestDays: 30,
    issuanceFee,
    status: "active",
    issuedBy: "actor-1",
    disbursementSource: "cash",
  }).returning();
  const [payment] = await testDb.insert(payments).values({
    loanId: loan.id,
    amount: "5000",
    paymentDate: day("2026-01-11"),
    recordedBy: "actor-1",
    depositLocation: "cash",
  }).returning();
  const issuanceGroup = randomUUID();
  const paymentGroup = randomUUID();
  await testDb.insert(transactions).values([
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "debit",
      amount: "30000", referenceType: "loan", referenceId: loan.id,
      journalGroupId: issuanceGroup, transactionDate: loan.startDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "credit",
      amount: "30000", referenceType: "loan", referenceId: loan.id,
      depositLocation: "cash", journalGroupId: issuanceGroup,
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
  if (issuanceFee !== "0") {
    const feeGroup = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories.Cash, type: "debit",
        amount: issuanceFee, referenceType: "loan", referenceId: loan.id,
        depositLocation: "cash", journalGroupId: feeGroup,
        transactionDate: loan.startDate, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Issuance Fees"], type: "credit",
        amount: issuanceFee, referenceType: "loan", referenceId: loan.id,
        journalGroupId: feeGroup, transactionDate: loan.startDate,
        recordedBy: "actor-1" },
    ]);
  }
  const [audit] = await testDb.insert(auditLog).values({
    actorId: "actor-1",
    action: "loan.rate_change.admin_adjusted",
    entityType: "loan",
    entityId: loan.id,
    beforeValue: JSON.stringify({ interestRateOverride: "0.1000" }),
    afterValue: JSON.stringify({ interestRateOverride: "0.1500" }),
    occurredAt: day("2026-04-01"),
  }).returning();
  return { loan, payment, audit };
}

describe("historical rate repair source preview", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads the final rate and reconciled old portions from one read-only snapshot", async () => {
    const { loan, payment, audit } = await seedPaidLoan();
    const asOf = day("2026-02-10");

    const first = await loadHistoricalRateRepairPlan(loan.id, asOf);

    expect(first.classification).toBe("review");
    expect(first.exceptions).toEqual([]);
    expect(first.correctedRate).toBe("0.1500");
    expect(first.changes).toEqual([expect.objectContaining({
      id: payment.id, oldInterest: "3000.00", oldPrincipal: "2000.00",
      newInterest: "4500.00", newPrincipal: "500.00",
    })]);
    expect(first.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);

    await testDb.update(auditLog).set({
      afterValue: JSON.stringify({ interestRateOverride: "0.1500", reviewedNote: "updated" }),
    }).where(eq(auditLog.id, audit.id));
    const changed = await loadHistoricalRateRepairPlan(loan.id, asOf);
    expect(changed.inputFingerprint).not.toBe(first.inputFingerprint);
  });

  it("blocks an issuance whose cash journal names a different location", async () => {
    const { loan } = await seedPaidLoan();
    const [cashCategory] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Cash"));
    const [cashIssue] = (await testDb.select().from(transactions))
      .filter((row) => row.referenceType === "loan" && row.categoryId === cashCategory.id);
    await testDb.update(transactions).set({ depositLocation: "strong_room" })
      .where(eq(transactions.id, cashIssue.id));

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/issuance cash/i),
    ]));
  });

  it("accepts an issuance fee collected through a separate cash journal", async () => {
    const { loan } = await seedPaidLoan("50");

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("review");
    expect(plan.exceptions).toEqual([]);
  });

  it("blocks an approved audit whose requested rate differs from the approved request", async () => {
    const { loan, audit } = await seedPaidLoan();
    const [request] = await testDb.insert(rateChangeRequests).values({
      loanId: loan.id, requestedRate: "0.2000", currentRate: "0.1000",
      requestedBy: "actor-1", requiredApproverRole: "admin",
      status: "approved", reviewedBy: "admin-1", reviewedAt: day("2026-04-01"),
    }).returning();
    await testDb.update(auditLog).set({
      action: "loan.rate_change.approved",
      afterValue: JSON.stringify({ interestRateOverride: "0.1500", requestId: request.id }),
    }).where(eq(auditLog.id, audit.id));

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/approved.*rate.*request/i),
    ]));
  });

  it("blocks a receipt whose cash journal still carries the old payment date", async () => {
    const { loan, payment } = await seedPaidLoan();
    await testDb.update(payments).set({ paymentDate: day("2026-01-12") })
      .where(eq(payments.id, payment.id));

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/cash receipt/i),
    ]));
  });

  it.each(["deleted", "marked wrong"] as const)(
    "blocks a %s receipt whose balanced cash/revenue journal was never reversed",
    async (state) => {
      const { loan } = await seedPaidLoan();
      const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
        .map((row) => [row.name, row.id]));
      const receiptDate = day("2026-01-15");
      const [excluded] = await testDb.insert(payments).values({
        loanId: loan.id, amount: "100", paymentDate: receiptDate,
        recordedBy: "actor-1", depositLocation: "cash",
        ...(state === "deleted" ? { deletedAt: day("2026-02-01") } : { markedWrong: true }),
      }).returning();
      const group = randomUUID();
      await testDb.insert(transactions).values([
        { loanId: loan.id, categoryId: categories.Cash, type: "debit",
          amount: "100", referenceType: "payment", referenceId: excluded.id,
          depositLocation: "cash", journalGroupId: group,
          transactionDate: receiptDate, recordedBy: "actor-1" },
        { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
          amount: "100", referenceType: "payment", referenceId: excluded.id,
          journalGroupId: group, transactionDate: receiptDate, recordedBy: "actor-1" },
      ]);

      const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
      expect(plan.classification).toBe("blocked");
      expect(plan.exceptions.join(" ")).toMatch(/excluded|reversal|receipt/i);

      const reversalGroup = randomUUID();
      await testDb.insert(transactions).values([
        { loanId: loan.id, categoryId: categories.Cash, type: "credit",
          amount: "100", referenceType: "payment_reversal", referenceId: excluded.id,
          depositLocation: "cash", journalGroupId: reversalGroup,
          transactionDate: receiptDate, recordedBy: "actor-1" },
        { loanId: loan.id, categoryId: categories["Interest Earned"], type: "debit",
          amount: "100", referenceType: "payment_reversal", referenceId: excluded.id,
          journalGroupId: reversalGroup,
          transactionDate: receiptDate, recordedBy: "actor-1" },
      ]);
      const reversed = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
      expect(reversed.classification).toBe("review");
    },
  );

  it("blocks a deleted waiver whose loss and revenue journal was never reversed", async () => {
    const { loan } = await seedPaidLoan();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const waiverDate = day("2026-01-15");
    const [waiver] = await testDb.insert(loanWaivers).values({
      loanId: loan.id, amount: "100", waiverDate,
      reason: "Excluded historical waiver", recordedBy: "actor-1",
      deletedAt: day("2026-02-01"),
    }).returning();
    const group = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Loan Losses"], type: "debit",
        amount: "100", referenceType: "loan_waiver", referenceId: waiver.id,
        journalGroupId: group, transactionDate: waiverDate, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "100", referenceType: "loan_waiver", referenceId: waiver.id,
        journalGroupId: group, transactionDate: waiverDate, recordedBy: "actor-1" },
    ]);

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions.join(" ")).toMatch(/excluded|waiver|reversal/i);

    const reversalGroup = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Loan Losses"], type: "credit",
        amount: "100", referenceType: "loan_waiver_reversal", referenceId: waiver.id,
        journalGroupId: reversalGroup, transactionDate: day("2026-02-01"),
        recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "debit",
        amount: "100", referenceType: "loan_waiver_reversal", referenceId: waiver.id,
        journalGroupId: reversalGroup, transactionDate: day("2026-02-01"),
        recordedBy: "actor-1" },
    ]);
    const reversed = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));
    expect(reversed.classification).toBe("review");
  });

  it("blocks a journal whose category changed from asset to liability", async () => {
    const { loan } = await seedPaidLoan();
    await testDb.update(transactionCategories).set({ type: "liability" })
      .where(eq(transactionCategories.name, "Loans Receivable"));

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/category.*type/i),
    ]));
  });

  it("nets a waiver accrual reversal before quoting the new accrual journal", async () => {
    const { loan } = await seedPaidLoan();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const [waiver] = await testDb.insert(loanWaivers).values({
      loanId: loan.id, amount: "500", waiverDate: day("2026-02-10"),
      reason: "Fixture write-down", recordedBy: "actor-1",
    }).returning();
    const groups = [randomUUID(), randomUUID(), randomUUID()];
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "500", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: groups[0], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "500", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: groups[0], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "credit",
        amount: "500", referenceType: "loan_waiver_accrual_reversal", referenceId: waiver.id,
        journalGroupId: groups[1], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "debit",
        amount: "500", referenceType: "loan_waiver_accrual_reversal", referenceId: waiver.id,
        journalGroupId: groups[1], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Loan Losses"], type: "debit",
        amount: "500", referenceType: "loan_waiver", referenceId: waiver.id,
        journalGroupId: groups[2], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "500", referenceType: "loan_waiver", referenceId: waiver.id,
        journalGroupId: groups[2], transactionDate: day("2026-02-10"), recordedBy: "actor-1" },
    ]);

    const plan = await loadHistoricalRateRepairPlan(loan.id, day("2026-02-10"));

    expect(plan.classification).toBe("review");
    expect(plan.accrualJournalTarget).toBe("925.00");
    expect(plan.accrualJournalDelta).toBe("925.00");
  });

  it("recognizes an exact reviewed same-loan portfolio accrual pair", async () => {
    const { loan } = await seedPaidLoan();
    await seedReviewedPortfolioAccrual(loan.id);

    const plan = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);

    expect(plan.classification, plan.exceptions.join("; ")).toBe("review");
    expect(plan.exceptions).toEqual([]);
    expect(plan.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks portfolio journals whose referenced run is absent", async () => {
    const { loan } = await seedPaidLoan();
    const { run } = await seedReviewedPortfolioAccrual(loan.id);
    await testDb.delete(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.id, run.id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks portfolio journals without a run reference ID", async () => {
    const { loan } = await seedPaidLoan();
    const { journal } = await seedReviewedPortfolioAccrual(loan.id);
    await testDb.update(transactions).set({ referenceId: null })
      .where(eq(transactions.id, journal[0].id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks portfolio journals whose run belongs to another loan", async () => {
    const { loan } = await seedPaidLoan();
    const { run } = await seedReviewedPortfolioAccrual(loan.id);
    const [otherCustomer] = await testDb.insert(customers).values({
      fullName: "Other Portfolio Customer", nin: "C1234567890999",
      contact: "+256700000999", address: "Kampala",
    }).returning();
    const [otherLoan] = await testDb.insert(loans).values({
      customerId: otherCustomer.id, principalAmount: "30000", issuanceFee: "0",
      interestRate: "0.1000", startDate: day("2026-01-01"),
      issuedBy: "actor-1", disbursementSource: "cash",
    }).returning();
    await testDb.update(portfolioAccrualRepairRuns).set({ loanId: otherLoan.id })
      .where(eq(portfolioAccrualRepairRuns.id, run.id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks a portfolio group with a missing earned counterpart", async () => {
    const { loan } = await seedPaidLoan();
    const { journal } = await seedReviewedPortfolioAccrual(loan.id);
    await testDb.delete(transactions).where(eq(transactions.id, journal[1].id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks a balanced portfolio pair with altered counterpart attribution", async () => {
    const { loan } = await seedPaidLoan();
    const { journal } = await seedReviewedPortfolioAccrual(loan.id);
    await testDb.update(transactions).set({ recordedBy: "agent:wrong-executor" })
      .where(eq(transactions.id, journal[1].id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks an extra balanced portfolio journal group absent from the run summary", async () => {
    const { loan } = await seedPaidLoan();
    const { common, categories } = await seedReviewedPortfolioAccrual(loan.id);
    const extra = { ...common, journalGroupId: randomUUID() };
    await testDb.insert(transactions).values([
      { ...extra, categoryId: categories["Interest Receivable"], type: "debit" },
      { ...extra, categoryId: categories["Interest Earned"], type: "credit" },
    ]);

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks a changed run summary even when both journal amounts change with it", async () => {
    const { loan } = await seedPaidLoan();
    const { run, common } = await seedReviewedPortfolioAccrual(loan.id);
    const before = JSON.parse(run.beforeSummary) as { asOf: string;
      entries: Array<{ delta: string; resultingReceivable: string }> };
    before.entries[0].delta = "150.00";
    before.entries[0].resultingReceivable = "150.00";
    await testDb.update(portfolioAccrualRepairRuns)
      .set({ beforeSummary: JSON.stringify(before) })
      .where(eq(portfolioAccrualRepairRuns.id, run.id));
    await testDb.update(transactions).set({ amount: "150.00" })
      .where(eq(transactions.journalGroupId, common.journalGroupId));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it("blocks a portfolio entry dated later than the requested as-of instant", async () => {
    const { loan } = await seedPaidLoan();
    const { run, review, journal } = await seedReviewedPortfolioAccrual(loan.id);
    const later = day("2026-02-11");
    const before = JSON.parse(run.beforeSummary) as { asOf: string;
      entries: Array<{ date: string; period: string }> };
    before.entries[0].date = later.toISOString();
    before.entries[0].period = "2026-02";
    const evidence = JSON.parse(review.evidenceJson) as { checkpoints:
      Array<{ date: string; period: string }> };
    evidence.checkpoints[0].date = later.toISOString();
    evidence.checkpoints[0].period = "2026-02";
    await testDb.update(portfolioAccrualRepairRuns)
      .set({ beforeSummary: JSON.stringify(before) })
      .where(eq(portfolioAccrualRepairRuns.id, run.id));
    await testDb.update(financialCorrectionAgentReviews).set({
      evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence),
    }).where(eq(financialCorrectionAgentReviews.id, review.id));
    await testDb.update(transactions).set({ transactionDate: later })
      .where(eq(transactions.journalGroupId, journal[0].journalGroupId!));

    const plan = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/later accrual than the as-of instant/i),
    ]));
    expect(plan.exceptions.join(" ")).not.toMatch(/unknown source/i);
  });

  it("keeps a stable fingerprint and changes it for run and review provenance edits", async () => {
    const { loan } = await seedPaidLoan();
    const { run, review } = await seedReviewedPortfolioAccrual(loan.id);
    const first = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);
    const repeated = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);
    expect(first.classification, first.exceptions.join("; ")).toBe("review");
    expect(repeated.inputFingerprint).toBe(first.inputFingerprint);

    await testDb.update(portfolioAccrualRepairRuns)
      .set({ afterSummary: JSON.stringify({ classification: "posted" }) })
      .where(eq(portfolioAccrualRepairRuns.id, run.id));
    const changedRun = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);
    expect(changedRun.classification, changedRun.exceptions.join("; ")).toBe("review");
    expect(changedRun.inputFingerprint).not.toBe(first.inputFingerprint);

    await testDb.update(financialCorrectionAgentReviews).set({ reviewRunId: randomUUID() })
      .where(eq(financialCorrectionAgentReviews.id, review.id));
    const changedReview = await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf);
    expect(changedReview.classification, changedReview.exceptions.join("; ")).toBe("review");
    expect(changedReview.inputFingerprint).not.toBe(changedRun.inputFingerprint);
  });

  it("blocks a review whose as-of differs from the run's before summary", async () => {
    const { loan } = await seedPaidLoan();
    const { review } = await seedReviewedPortfolioAccrual(loan.id);
    const evidence = JSON.parse(review.evidenceJson) as { asOf: string };
    evidence.asOf = day("2026-02-09").toISOString();
    await testDb.update(financialCorrectionAgentReviews).set({
      evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence),
    }).where(eq(financialCorrectionAgentReviews.id, review.id));

    expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
  });

  it.each(["g".repeat(64), "a".repeat(63)])(
    "blocks a malformed optional review source digest (%s)", async (sourceDigest) => {
      const { loan } = await seedPaidLoan();
      const { review } = await seedReviewedPortfolioAccrual(loan.id);
      const evidence = { ...JSON.parse(review.evidenceJson), sourceDigest };
      await testDb.update(financialCorrectionAgentReviews).set({
        evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence),
      }).where(eq(financialCorrectionAgentReviews.id, review.id));

      expectBlockedPortfolioProof(await loadHistoricalRateRepairPlan(loan.id, portfolioAsOf));
    },
  );
});
