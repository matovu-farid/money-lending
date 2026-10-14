import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedCategories, testDb } from "./setup";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { quoteRecordedRollover } from "../rollover-quote.service";

const issueDate = new Date("2026-05-16T00:00:00.000Z");
const rolloverDate = new Date("2026-07-20T00:00:00.000Z");
const receiptDate = new Date("2026-07-20T12:00:00.000Z");

async function seedPredecessor(journalLoanId?: string) {
  await seedCategories();
  const categoryRows = await testDb.select().from(transactionCategories);
  const category = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]));
  const [customer] = await testDb.insert(customers).values({
    fullName: "Same-day rollover test", nin: "C0000000000000",
    contact: "+256700000000", address: "Kampala",
  }).returning();
  const [predecessor] = await testDb.insert(loans).values({
    customerId: customer.id, principalAmount: "3000000", interestRate: "0.1000",
    minInterestDays: 0, startDate: issueDate, issuanceFee: "0", status: "active",
    issuedBy: "test-agent", disbursementSource: "cash",
  }).returning();
  const [payment] = await testDb.insert(payments).values({
    loanId: predecessor.id, paymentDate: receiptDate, amount: "333000",
    recordedBy: "test-agent", depositLocation: "cash",
  }).returning();
  const group = randomUUID();
  await testDb.insert(transactions).values([
    { loanId: predecessor.id, categoryId: category["Loans Receivable"], type: "debit",
      referenceType: "loan", referenceId: predecessor.id, amount: "3000000",
      transactionDate: issueDate, recordedBy: "test-agent", journalGroupId: group },
    { loanId: predecessor.id, categoryId: category.Cash, type: "credit",
      referenceType: "loan", referenceId: predecessor.id, amount: "3000000",
      transactionDate: issueDate, recordedBy: "test-agent", journalGroupId: group,
      depositLocation: "cash" },
  ]);
  for (const [name, amount] of [["Interest Earned", "100000"], ["Loans Receivable", "233000"]]) {
    const paymentGroup = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: journalLoanId ?? predecessor.id, categoryId: category[name], type: "credit",
        referenceType: "payment", referenceId: payment.id, amount,
        transactionDate: receiptDate, recordedBy: "test-agent", journalGroupId: paymentGroup },
      { loanId: journalLoanId ?? predecessor.id, categoryId: category.Cash, type: "debit",
        referenceType: "payment", referenceId: payment.id, amount,
        transactionDate: receiptDate, recordedBy: "test-agent", journalGroupId: paymentGroup,
        depositLocation: "cash" },
    ]);
  }
  return { predecessor, customer, payment };
}

describe("date-only rollover quote with a same-day predecessor receipt", () => {
  beforeEach(resetDb);

  it("quotes the receipt on its recorded loan without an extra interest day", async () => {
    const { predecessor, payment } = await seedPredecessor();
    const quote = await quoteRecordedRollover(testDb, predecessor, rolloverDate);
    // Five overdue intervals at 11% add UGX 5,000 before the July 20 receipt.
    expect(quote).toEqual({ carriedPrincipal: "2767000", carriedInterest: "555000" });
    const [unchanged] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(unchanged.loanId).toBe(predecessor.id);
    expect(unchanged.paymentDate).toEqual(receiptDate);
    expect(unchanged.amount).toBe("333000.00");
  });

  it("rejects a same-day receipt whose journal legs belong to another loan", async () => {
    const { predecessor, customer } = await seedPredecessor();
    const [other] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: issueDate, issuanceFee: "0", status: "active",
      issuedBy: "test-agent", disbursementSource: "cash",
    }).returning();
    await testDb.update(transactions).set({ loanId: other.id })
      .where(eq(transactions.referenceType, "payment"));
    await expect(quoteRecordedRollover(testDb, predecessor, rolloverDate))
      .rejects.toThrow(/journal.*predecessor/i);
  });

  it("rejects an outgoing rollover already posted for the predecessor", async () => {
    const { predecessor, customer } = await seedPredecessor();
    await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: rolloverDate, issuanceFee: "0", status: "active",
      issuedBy: "test-agent", disbursementSource: "cash", rolledOverFrom: predecessor.id,
      rolloverAmount: "0",
    });
    await expect(quoteRecordedRollover(testDb, predecessor, rolloverDate))
      .rejects.toThrow(/already.*rollover/i);
  });

  it("rejects an outgoing rollover journal even without a successor link", async () => {
    const { predecessor, customer } = await seedPredecessor();
    const [other] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: rolloverDate, issuanceFee: "0", status: "active",
      issuedBy: "test-agent", disbursementSource: "cash",
    }).returning();
    const [receivable] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Loans Receivable"));
    const group = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: predecessor.id, categoryId: receivable.id, type: "credit",
        referenceType: "rollover", referenceId: other.id, amount: "100",
        transactionDate: rolloverDate, journalGroupId: group, recordedBy: "test-agent" },
      { loanId: other.id, categoryId: receivable.id, type: "debit",
        referenceType: "rollover", referenceId: predecessor.id, amount: "100",
        transactionDate: rolloverDate, journalGroupId: group, recordedBy: "test-agent" },
    ]);
    await expect(quoteRecordedRollover(testDb, predecessor, rolloverDate))
      .rejects.toThrow(/already.*outgoing rollover journal/i);
  });

  it("rejects an unattributed rollover credit with a null reference", async () => {
    const { predecessor, customer } = await seedPredecessor();
    const [other] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: rolloverDate, issuanceFee: "0", status: "active",
      issuedBy: "test-agent", disbursementSource: "cash",
    }).returning();
    const [receivable] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Loans Receivable"));
    const group = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: predecessor.id, categoryId: receivable.id, type: "credit",
        referenceType: "rollover", referenceId: null, amount: "100",
        transactionDate: rolloverDate, journalGroupId: group, recordedBy: "test-agent" },
      { loanId: other.id, categoryId: receivable.id, type: "debit",
        referenceType: "rollover", referenceId: predecessor.id, amount: "100",
        transactionDate: rolloverDate, journalGroupId: group, recordedBy: "test-agent" },
    ]);
    await expect(quoteRecordedRollover(testDb, predecessor, rolloverDate))
      .rejects.toThrow(/already.*outgoing rollover journal/i);
  });

  it("does not trust a matching prior-loan reference without a valid reversal pair", async () => {
    const { predecessor, customer } = await seedPredecessor();
    const [prior] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: new Date("2026-04-16T00:00:00Z"),
      issuanceFee: "0", status: "rolled_over", issuedBy: "test-agent",
      disbursementSource: "cash",
    }).returning();
    const [updated] = await testDb.update(loans).set({ rolledOverFrom: prior.id })
      .where(eq(loans.id, predecessor.id)).returning();
    const [receivable] = await testDb.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Loans Receivable"));
    const group = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: predecessor.id, categoryId: receivable.id, type: "credit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: group, recordedBy: "agent:executor",
        description: "Non-cash rollover correction forged-run" },
      { loanId: null, categoryId: receivable.id, type: "debit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: group, recordedBy: "agent:executor",
        description: "Non-cash rollover correction forged-run" },
    ]);
    await expect(quoteRecordedRollover(testDb, updated, rolloverDate))
      .rejects.toThrow(/already.*outgoing rollover journal/i);
  });

  it("allows a verified incoming correction on a previously rolled-over loan", async () => {
    const { predecessor, customer } = await seedPredecessor();
    const [prior] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "1000", interestRate: "0.1000",
      minInterestDays: 0, startDate: new Date("2026-04-16T00:00:00Z"),
      issuanceFee: "0", status: "rolled_over", issuedBy: "test-agent",
      disbursementSource: "cash",
    }).returning();
    const [updated] = await testDb.update(loans).set({ rolledOverFrom: prior.id })
      .where(eq(loans.id, predecessor.id)).returning();
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]));
    const originalGroup = randomUUID();
    const correctionGroup = randomUUID();
    await testDb.insert(transactions).values([
      { loanId: predecessor.id, categoryId: categories["Loans Receivable"], type: "debit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: originalGroup, recordedBy: "test-agent" },
      { loanId: predecessor.id, categoryId: categories["Interest Earned"], type: "credit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: originalGroup, recordedBy: "test-agent" },
      { loanId: predecessor.id, categoryId: categories["Loans Receivable"], type: "credit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: correctionGroup,
        description: "Non-cash rollover correction test-run", recordedBy: "agent:executor" },
      { loanId: predecessor.id, categoryId: categories["Interest Earned"], type: "debit",
        referenceType: "rollover", referenceId: prior.id, amount: "100",
        transactionDate: issueDate, journalGroupId: correctionGroup,
        description: "Non-cash rollover correction test-run", recordedBy: "agent:executor" },
    ]);
    await expect(quoteRecordedRollover(testDb, updated, rolloverDate))
      .resolves.toEqual({ carriedPrincipal: "2767000", carriedInterest: "555000" });
  });
});
