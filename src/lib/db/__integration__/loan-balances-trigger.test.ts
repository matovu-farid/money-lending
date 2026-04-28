// src/lib/db/__integration__/loan-balances-trigger.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loanBalances } from "@/lib/db/schema/loan-balances"
import { eq, sql } from "drizzle-orm"

describe("loan_balances trigger", () => {
  beforeEach(async () => {
    // Clean slate. ON DELETE CASCADE on loan_balances.loan_id handles cleanup.
    await db.execute(sql`TRUNCATE TABLE transactions, transaction_categories, payments, loans, customers, loan_balances RESTART IDENTITY CASCADE`)
  })

  it("upserts loan_balances when a transaction with a loanId is inserted", async () => {
    // Arrange: a customer, a loan, the Loans Receivable category.
    const [c] = await db.insert(customers).values({
      fullName: "Test", nin: "CM00000000TEST", contact: "0700000000", address: "Kampala",
    }).returning()
    const [l] = await db.insert(loans).values({
      customerId: c.id,
      principalAmount: "100000",
      issuanceFee: "50000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: new Date(),
      disbursementSource: "cash",
      status: "active",
      issuedBy: "test-user",
    }).returning()
    const [cat] = await db.insert(transactionCategories).values({
      name: "Loans Receivable", type: "asset",
    }).returning()

    // Act: insert a debit (loan disbursement).
    await db.insert(transactions).values({
      type: "debit",
      amount: "100000",
      categoryId: cat.id,
      loanId: l.id,
      transactionDate: new Date(),
      recordedBy: "test-user",
    })

    // Assert: loan_balances row appears with outstanding_balance = 100000.
    const [row] = await db.select().from(loanBalances).where(eq(loanBalances.loanId, l.id))
    expect(row).toBeDefined()
    expect(row.outstandingBalance).toBe("100000.00")
    expect(row.unpaidInterest).toBe("0.00")
  })

  it("subtracts a credit (payment) from outstanding_balance", async () => {
    const [c] = await db.insert(customers).values({
      fullName: "Test", nin: "CM00000001TEST", contact: "0700000000", address: "Kampala",
    }).returning()
    const [l] = await db.insert(loans).values({
      customerId: c.id,
      principalAmount: "100000", issuanceFee: "50000", interestRate: "0.10",
      minInterestDays: 30, startDate: new Date(),
      disbursementSource: "cash", status: "active", issuedBy: "test-user",
    }).returning()
    const [cat] = await db.insert(transactionCategories).values({
      name: "Loans Receivable", type: "asset",
    }).returning()
    await db.insert(transactions).values({
      type: "debit", amount: "100000", categoryId: cat.id, loanId: l.id,
      transactionDate: new Date(), recordedBy: "test-user",
    })

    // Pay back 30000.
    await db.insert(transactions).values({
      type: "credit", amount: "30000", categoryId: cat.id, loanId: l.id,
      transactionDate: new Date(), recordedBy: "test-user",
    })

    const [row] = await db.select().from(loanBalances).where(eq(loanBalances.loanId, l.id))
    expect(row.outstandingBalance).toBe("70000.00")
  })
})
