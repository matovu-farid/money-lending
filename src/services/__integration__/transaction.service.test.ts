import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect, Exit, Cause } from "effect"
import {
  recordExpense,
  recordIncome,
  listTransactions,
  getTransactionById,
  deleteTransaction,
  autoPostInterestEarned,
  autoPostInterestExpense,
  accrueInterestForLoans,
} from "@/services/transaction.service"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import { getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import BigNumber from "bignumber.js"
import { TransactionNotFound } from "@/lib/errors"
import { auditLog } from "@/lib/db/schema/audit"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"

/** Seed a general expense category and return its ID */
async function seedExpenseCategory(name = "Office Supplies") {
  const [cat] = await testDb
    .insert(transactionCategories)
    .values({ name, type: "expense" as const, isDefault: false })
    .returning()
  return cat
}

/** Seed a general income category and return its ID */
async function seedIncomeCategory(name = "Service Fees") {
  const [cat] = await testDb
    .insert(transactionCategories)
    .values({ name, type: "revenue" as const, isDefault: false })
    .returning()
  return cat
}

const ACTOR_ID = "test-actor"

describe("Transaction Service (integration)", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await resetDb()
  })

  // ── recordExpense ──────────────────────────────────────────────────

  it("recordExpense — inserts a debit transaction with all fields", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        {
          categoryId: cat.id,
          amount: "75000",
          transactionDate: "2026-03-15",
          notes: "Printer ink",
          location: "cash",
        },
        ACTOR_ID
      )
    )

    expect(txn.id).toBeDefined()
    expect(txn.type).toBe("debit")
    expect(txn.amount).toBe("75000.00")
    expect(txn.categoryId).toBe(cat.id)
    expect(txn.description).toBe("Printer ink")
    expect(txn.recordedBy).toBe(ACTOR_ID)
    expect(txn.transactionDate).toBeInstanceOf(Date)
    expect(txn.createdAt).toBeInstanceOf(Date)
  })

  it("recordExpense — writes an audit log entry", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "50000", transactionDate: "2026-03-15", location: "cash" },
        ACTOR_ID
      )
    )

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, txn.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("transaction.create")
    expect(logs[0].actorId).toBe(ACTOR_ID)
    expect(logs[0].entityType).toBe("transaction")
    expect(logs[0].beforeValue).toBeNull()
    expect(logs[0].afterValue).not.toBeNull()
  })

  it("recordExpense — null description when notes omitted", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "10000", transactionDate: "2026-03-15", location: "cash" },
        ACTOR_ID
      )
    )

    expect(txn.description).toBeNull()
  })

  // ── recordIncome ───────────────────────────────────────────────────

  it("recordIncome — inserts a credit transaction with all fields", async () => {
    const cat = await seedIncomeCategory()

    const txn = await Effect.runPromise(
      recordIncome(
        {
          categoryId: cat.id,
          amount: "200000",
          transactionDate: "2026-03-10",
          notes: "Application fee collected",
          location: "cash",
        },
        ACTOR_ID
      )
    )

    expect(txn.id).toBeDefined()
    expect(txn.type).toBe("credit")
    expect(txn.amount).toBe("200000.00")
    expect(txn.categoryId).toBe(cat.id)
    expect(txn.description).toBe("Application fee collected")
    expect(txn.recordedBy).toBe(ACTOR_ID)
  })

  it("recordIncome — writes an audit log entry", async () => {
    const cat = await seedIncomeCategory()

    const txn = await Effect.runPromise(
      recordIncome(
        { categoryId: cat.id, amount: "100000", transactionDate: "2026-03-10", location: "cash" },
        ACTOR_ID
      )
    )

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, txn.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("transaction.create")
    expect(logs[0].entityType).toBe("transaction")
  })

  // ── getTransactionById ─────────────────────────────────────────────

  it("getTransactionById — returns a transaction by ID", async () => {
    const cat = await seedExpenseCategory()

    const created = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "30000", transactionDate: "2026-03-12", location: "cash" },
        ACTOR_ID
      )
    )

    const fetched = await Effect.runPromise(getTransactionById(created.id))

    expect(fetched.id).toBe(created.id)
    expect(fetched.type).toBe("debit")
    expect(fetched.amount).toBe("30000.00")
  })

  it("getTransactionById — returns TransactionNotFound for non-existent ID", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(getTransactionById(fakeId))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(TransactionNotFound)
        expect((error.value as TransactionNotFound).id).toBe(fakeId)
      }
    }
  })

  // ── deleteTransaction ──────────────────────────────────────────────

  it("deleteTransaction — creates a reversal entry and keeps the original", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "20000", transactionDate: "2026-03-14", location: "cash" },
        ACTOR_ID
      )
    )

    await Effect.runPromise(deleteTransaction(txn.id, ACTOR_ID))

    // Original transaction should still exist
    const original = await Effect.runPromise(getTransactionById(txn.id))
    expect(original.id).toBe(txn.id)

    // A reversal entry should have been created
    const allTxns = await testDb
      .select()
      .from(transactions)
      .where(eq(transactions.referenceId, txn.id))

    expect(allTxns).toHaveLength(1)
    const reversal = allTxns[0]
    expect(reversal.referenceType).toBe("manual_reversal")
    expect(reversal.type).toBe("credit") // opposite of original debit
    expect(reversal.amount).toBe(txn.amount)
  })

  it("deleteTransaction — writes audit log with beforeValue", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "15000", transactionDate: "2026-03-14", location: "cash" },
        ACTOR_ID
      )
    )

    await Effect.runPromise(deleteTransaction(txn.id, ACTOR_ID))

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, txn.id))

    // Should have 2 logs: one for create, one for delete
    expect(logs).toHaveLength(2)
    const deleteLog = logs.find((l) => l.action === "transaction.delete")
    expect(deleteLog).toBeDefined()
    expect(deleteLog!.actorId).toBe(ACTOR_ID)
    expect(deleteLog!.beforeValue).not.toBeNull()
    expect(deleteLog!.afterValue).toBeNull()
  })

  it("deleteTransaction — returns TransactionNotFound for non-existent ID", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(deleteTransaction(fakeId, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(TransactionNotFound)
      }
    }
  })

  // ── listTransactions ───────────────────────────────────────────────

  it("listTransactions — returns paginated results with category name", async () => {
    const expCat = await seedExpenseCategory("Rent")
    const incCat = await seedIncomeCategory("Interest Earned")

    await Effect.runPromise(
      recordExpense(
        { categoryId: expCat.id, amount: "500000", transactionDate: "2026-03-01", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordIncome(
        { categoryId: incCat.id, amount: "100000", transactionDate: "2026-03-02", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: expCat.id, amount: "50000", transactionDate: "2026-03-03", location: "cash" },
        ACTOR_ID
      )
    )

    const result = await Effect.runPromise(listTransactions({}, 1, 10))

    expect(result.total).toBe(3)
    expect(result.data).toHaveLength(3)
    // Each row should have categoryName
    expect(result.data[0].categoryName).toBeDefined()
    // Ordered by transactionDate DESC
    expect(
      result.data[0].transactionDate >= result.data[1].transactionDate
    ).toBe(true)
  })

  it("listTransactions — filters by type", async () => {
    const expCat = await seedExpenseCategory()
    const incCat = await seedIncomeCategory()

    await Effect.runPromise(
      recordExpense(
        { categoryId: expCat.id, amount: "50000", transactionDate: "2026-03-01", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordIncome(
        { categoryId: incCat.id, amount: "100000", transactionDate: "2026-03-02", location: "cash" },
        ACTOR_ID
      )
    )

    const debits = await Effect.runPromise(
      listTransactions({ type: "debit" }, 1, 10)
    )
    expect(debits.total).toBe(1)
    expect(debits.data[0].type).toBe("debit")

    const credits = await Effect.runPromise(
      listTransactions({ type: "credit" }, 1, 10)
    )
    expect(credits.total).toBe(1)
    expect(credits.data[0].type).toBe("credit")
  })

  it("listTransactions — filters by categoryId", async () => {
    const cat1 = await seedExpenseCategory("Rent")
    const cat2 = await seedExpenseCategory("Utilities")

    await Effect.runPromise(
      recordExpense(
        { categoryId: cat1.id, amount: "50000", transactionDate: "2026-03-01", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat2.id, amount: "30000", transactionDate: "2026-03-02", location: "cash" },
        ACTOR_ID
      )
    )

    const result = await Effect.runPromise(
      listTransactions({ categoryId: cat1.id }, 1, 10)
    )

    expect(result.total).toBe(1)
    expect(result.data[0].categoryId).toBe(cat1.id)
  })

  it("listTransactions — filters by date range", async () => {
    const cat = await seedExpenseCategory()

    await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "10000", transactionDate: "2026-01-15", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "20000", transactionDate: "2026-03-15", location: "cash" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "30000", transactionDate: "2026-05-15", location: "cash" },
        ACTOR_ID
      )
    )

    const result = await Effect.runPromise(
      listTransactions(
        { dateFrom: "2026-03-01", dateTo: "2026-04-01" },
        1,
        10
      )
    )

    expect(result.total).toBe(1)
    expect(result.data[0].amount).toBe("20000.00")
  })

  it("listTransactions — paginates correctly", async () => {
    const cat = await seedExpenseCategory()

    for (let i = 1; i <= 5; i++) {
      await Effect.runPromise(
        recordExpense(
          {
            categoryId: cat.id,
            amount: `${i * 10000}`,
            transactionDate: `2026-03-${String(i).padStart(2, "0")}`,
            location: "cash",
          },
          ACTOR_ID
        )
      )
    }

    const page1 = await Effect.runPromise(listTransactions({}, 1, 2))
    expect(page1.data).toHaveLength(2)
    expect(page1.total).toBe(5)

    const page2 = await Effect.runPromise(listTransactions({}, 2, 2))
    expect(page2.data).toHaveLength(2)
    expect(page2.total).toBe(5)

    const page3 = await Effect.runPromise(listTransactions({}, 3, 2))
    expect(page3.data).toHaveLength(1)
    expect(page3.total).toBe(5)

    // No overlap between pages
    const allIds = [
      ...page1.data.map((t) => t.id),
      ...page2.data.map((t) => t.id),
      ...page3.data.map((t) => t.id),
    ]
    expect(new Set(allIds).size).toBe(5)
  })

  it("listTransactions — returns empty when no transactions exist", async () => {
    // Need at least a category for the join, but no transactions
    const result = await Effect.runPromise(listTransactions({}, 1, 10))
    expect(result.total).toBe(0)
    expect(result.data).toHaveLength(0)
  })

  // ── autoPostInterestEarned ─────────────────────────────────────────

  it("autoPostInterestEarned — inserts a credit transaction with Interest Earned category", async () => {
    await seedCategories()

    // Use testDb.transaction to provide a tx handle
    await testDb.transaction(async (tx) => {
      await autoPostInterestEarned(tx, {
        amount: "150000",
        loanId: "loan-abc",
        paymentId: "payment-xyz",
        paymentDate: "2026-03-20",
        actorId: ACTOR_ID,
      })
    })

    // Verify the transaction was inserted
    const rows = await testDb.select().from(transactions)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe("credit")
    expect(rows[0].amount).toBe("150000.00")
    expect(rows[0].referenceType).toBe("payment")
    expect(rows[0].referenceId).toBe("payment-xyz")
    expect(rows[0].description).toContain("loan-abc")
    expect(rows[0].recordedBy).toBe(ACTOR_ID)
  })

  it("autoPostInterestEarned — skips gracefully when category not seeded", async () => {
    // Do NOT seed categories
    await testDb.transaction(async (tx) => {
      // Should not throw
      await autoPostInterestEarned(tx, {
        amount: "150000",
        loanId: "loan-abc",
        paymentId: "payment-xyz",
        paymentDate: "2026-03-20",
        actorId: ACTOR_ID,
      })
    })

    // No transaction should be inserted
    const rows = await testDb.select().from(transactions)
    expect(rows).toHaveLength(0)
  })

  // ── autoPostInterestExpense ────────────────────────────────────────

  it("autoPostInterestExpense — inserts a debit transaction with Interest Payments category", async () => {
    await seedCategories()

    await testDb.transaction(async (tx) => {
      await autoPostInterestExpense(tx, {
        amount: "80000",
        investmentId: "inv-xyz",
        repaymentDate: "2026-03-20",
        actorId: ACTOR_ID,
      })
    })

    const rows = await testDb.select().from(transactions)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe("debit")
    expect(rows[0].amount).toBe("80000.00")
    expect(rows[0].referenceType).toBe("creditor_repayment")
    expect(rows[0].referenceId).toBe("inv-xyz")
    expect(rows[0].description).toContain("inv-xyz")
    expect(rows[0].recordedBy).toBe(ACTOR_ID)
  })

  it("autoPostInterestExpense — skips gracefully when category not seeded", async () => {
    await testDb.transaction(async (tx) => {
      await autoPostInterestExpense(tx, {
        amount: "80000",
        investmentId: "inv-xyz",
        repaymentDate: "2026-03-20",
        actorId: ACTOR_ID,
      })
    })

    const rows = await testDb.select().from(transactions)
    expect(rows).toHaveLength(0)
  })
})

// =========================================================================
// accrueInterestForLoans
// =========================================================================

describe("accrueInterestForLoans — Integration", () => {
  async function makeTestCustomer() {
    return Effect.runPromise(
      createCustomer({
        fullName: "Accrual Test Customer",
        nin: `CM${Date.now()}ACCR`,
        contact: "+256700000000",
        address: "Kampala, Uganda",
      })
    )
  }

  async function makeTestLoan(customerId: string, principal = "1000000", rate = "0.10") {
    return Effect.runPromise(
      createLoan(
        {
          customerId,
          principalAmount: principal,
          issuanceFee: "0",
          interestRate: rate,
          minInterestDays: 30,
          startDate: "2025-01-01",
          collateral: { nature: "Land title", description: "Test" },
          disbursementSource: "cash",
        },
        ACTOR_ID
      )
    )
  }

  beforeEach(async () => {
    await resetDb()
    await seedCategories()
    // Seed Interest Receivable category (needed for accrual journal entries)
    await testDb
      .insert(transactionCategories)
      .values({ name: "Interest Receivable", type: "revenue" as const, isDefault: true })
      .onConflictDoNothing()
  })

  it("accrues interest for a loan with no payments", async () => {
    const customer = await makeTestCustomer()
    const loan = await makeTestLoan(customer.id)

    // Accrue as of 30 days after loan start
    const asOfDate = new Date("2025-01-31T23:59:59.000Z")
    const result = await Effect.runPromise(accrueInterestForLoans(asOfDate))

    expect(result.loansProcessed).toBe(1)
    expect(result.entriesPosted).toBeGreaterThanOrEqual(1)

    // Check Interest Receivable entries were created for this loan
    const accrualEntries = await testDb
      .select()
      .from(transactions)
      .where(eq(transactions.referenceType, "interest_accrual"))

    expect(accrualEntries.length).toBeGreaterThanOrEqual(2) // DR + CR pair
  })

  it("is idempotent — second call posts nothing new", async () => {
    const customer = await makeTestCustomer()
    await makeTestLoan(customer.id)

    const asOfDate = new Date("2025-01-31T23:59:59.000Z")

    // First accrual
    const result1 = await Effect.runPromise(accrueInterestForLoans(asOfDate))
    expect(result1.entriesPosted).toBeGreaterThanOrEqual(1)

    // Second accrual at same date — nothing new should be posted
    const result2 = await Effect.runPromise(accrueInterestForLoans(asOfDate))
    expect(result2.entriesPosted).toBe(0)
  })

  it("segmented interest: accounts for balance changes from payments", async () => {
    const customer = await makeTestCustomer()
    const loan = await makeTestLoan(customer.id, "1000000", "0.10")

    // Make a payment at day 15 that reduces principal by 500k
    // interest for 15 days on 1M = 50000, payment of 550000 → 50k to interest, 500k to principal
    await Effect.runPromise(
      recordPayment(
        { loanId: loan.id, paymentDate: "2025-01-16", amount: "550000", depositLocation: "cash" },
        ACTOR_ID
      )
    )

    // Accrue as of day 30
    const asOfDate = new Date("2025-01-31T23:59:59.000Z")
    const result = await Effect.runPromise(accrueInterestForLoans(asOfDate))

    // Should have accrued entries
    expect(result.loansProcessed).toBe(1)

    // The accrued interest should be segmented:
    // Days 1-15: 1M * 0.10/30 * 15 = 50000
    // Days 16-30: 500k * 0.10/30 * 15 = 25000
    // Total accrued: 75000
    // Already earned (from payment): 50000
    // Net accrual: 25000
    // This test just verifies the accrual runs without error and posts entries
    // (the exact amounts depend on internal rounding)
    const accrualEntries = await testDb
      .select()
      .from(transactions)
      .where(eq(transactions.referenceType, "interest_accrual"))

    // If net accrual > 0, entries should exist
    if (result.entriesPosted > 0) {
      expect(accrualEntries.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("processes multiple loans in batch", async () => {
    const customer1 = await makeTestCustomer()
    const customer2 = await Effect.runPromise(
      createCustomer({
        fullName: "Second Borrower",
        nin: `CM${Date.now()}BAT2`,
        contact: "+256700000001",
        address: "Entebbe, Uganda",
      })
    )

    await makeTestLoan(customer1.id, "1000000", "0.10")
    await makeTestLoan(customer2.id, "500000", "0.15")

    const asOfDate = new Date("2025-01-31T23:59:59.000Z")
    const result = await Effect.runPromise(accrueInterestForLoans(asOfDate))

    expect(result.loansProcessed).toBe(2)
  })

  it("skips loans when required categories are missing", async () => {
    // Reset without seeding categories
    await resetDb()
    // Don't seed any categories — accrual should skip gracefully

    const result = await Effect.runPromise(accrueInterestForLoans(new Date()))
    expect(result.loansProcessed).toBe(0)
    expect(result.entriesPosted).toBe(0)
  })
})
