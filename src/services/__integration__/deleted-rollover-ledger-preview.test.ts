import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { resetDb, seedCategories, testDb } from "./setup"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { payments } from "@/lib/db/schema/payments"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { loadDeletedRolloverSource } from "../deleted-rollover-ledger.service"

describe("deleted rollover ledger source loader", () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  })

  it("loads complete journal groups including a null-loan counterpart and hashes full rows", async () => {
    const [customer] = await testDb.insert(customers).values({
      fullName: "Deleted rollover fixture", nin: "C5555555555555",
      contact: "+256700000000", address: "Kampala",
    }).returning()
    const [predecessor] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "5000000", issuanceFee: "0",
      interestRate: "0.1000", startDate: new Date("2024-11-28T00:00:00Z"),
      status: "active", deletedAt: new Date("2026-08-04T02:32:27Z"),
      issuedBy: "actor-1", disbursementSource: "cash",
    }).returning()
    const [successor] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "15358484", issuanceFee: "0",
      interestRate: "0.1000", startDate: new Date("2025-02-21T00:00:00Z"),
      rolledOverFrom: predecessor.id, rolloverAmount: "5358484",
      status: "active", deletedAt: new Date("2026-08-03T17:54:59Z"),
      issuedBy: "actor-1", disbursementSource: "cash",
    }).returning()
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]))
    const group = randomUUID()
    const [debit, counterpart] = await testDb.insert(transactions).values([
      { loanId: successor.id, categoryId: categories["Loans Receivable"],
        type: "debit", amount: "100.00", referenceType: "rollover",
        referenceId: predecessor.id, journalGroupId: group,
        transactionDate: successor.startDate, recordedBy: "actor-1" },
      { loanId: null, categoryId: categories["Interest Earned"],
        type: "credit", amount: "100.00", referenceType: "rollover",
        referenceId: predecessor.id, journalGroupId: group,
        transactionDate: successor.startDate, recordedBy: "actor-1" },
    ]).returning()

    const first = await loadDeletedRolloverSource(predecessor.id, testDb)
    expect(first.predecessor.id).toBe(predecessor.id)
    expect(first.successor.id).toBe(successor.id)
    expect(first.journals.map((row) => row.id).sort())
      .toEqual([debit.id, counterpart.id].sort())
    expect(first.journals.find((row) => row.id === counterpart.id)?.loanId).toBeNull()
    expect(first.fullSourceDigest).toMatch(/^[a-f0-9]{64}$/)

    const extraGroup = randomUUID()
    const [orphan] = await testDb.insert(transactions).values([
      { loanId: null, categoryId: categories["Loans Receivable"],
        type: "debit", amount: "1.00", referenceType: "loan_deletion_reversal",
        referenceId: predecessor.id, journalGroupId: extraGroup,
        transactionDate: successor.startDate, recordedBy: "actor-1" },
      { loanId: null, categoryId: categories["Interest Earned"],
        type: "credit", amount: "1.00", referenceType: "loan_deletion_reversal",
        referenceId: null, journalGroupId: extraGroup,
        transactionDate: successor.startDate, recordedBy: "actor-1" },
    ]).returning()
    const [payment] = await testDb.insert(payments).values({ loanId: predecessor.id,
      amount: "50.00", paymentDate: successor.startDate,
      recordedBy: "actor-1", depositLocation: "cash" }).returning()
    const [settlementJournal] = await testDb.insert(transactions).values([
      { loanId: null, categoryId: categories["Loans Receivable"],
        type: "debit", amount: "2.00", referenceType: "payment",
        referenceId: payment.id, journalGroupId: randomUUID(),
        transactionDate: payment.paymentDate, recordedBy: "actor-1" },
    ]).returning()
    await testDb.insert(rateChangeRequests).values({ loanId: predecessor.id,
      requestedRate: "0.0900", currentRate: "0.1000",
      requestedBy: "actor-1", requiredApproverRole: "admin" })
    const withExtras = await loadDeletedRolloverSource(predecessor.id, testDb)
    expect(withExtras.journals.some((row) => row.id === orphan.id)).toBe(true)
    expect(withExtras.journals.some((row) => row.id === settlementJournal.id)).toBe(true)
    expect(withExtras.payments).toHaveLength(1)
    expect(withExtras.payments[0].deletedAt).toBeNull()
    expect(withExtras.rateChanges).toHaveLength(1)

    await testDb.update(transactions).set({ description: "Changed source note" })
      .where(eq(transactions.id, counterpart.id))
    const second = await loadDeletedRolloverSource(predecessor.id, testDb)
    expect(second.fullSourceDigest).not.toBe(withExtras.fullSourceDigest)
  })
})
