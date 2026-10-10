import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedCategories, testDb } from "./setup";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { auditLog } from "@/lib/db/schema/audit";
import { loadHistoricalRateRepairPlan } from "../historical-rate-repair.service";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

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
});
