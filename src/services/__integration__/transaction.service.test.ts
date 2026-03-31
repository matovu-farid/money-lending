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
} from "@/services/transaction.service"
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
    .values({ name, type: "expense", isDefault: false })
    .returning()
  return cat
}

/** Seed a general income category and return its ID */
async function seedIncomeCategory(name = "Service Fees") {
  const [cat] = await testDb
    .insert(transactionCategories)
    .values({ name, type: "income", isDefault: false })
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
        { categoryId: cat.id, amount: "50000", transactionDate: "2026-03-15" },
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
        { categoryId: cat.id, amount: "10000", transactionDate: "2026-03-15" },
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
        { categoryId: cat.id, amount: "100000", transactionDate: "2026-03-10" },
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
        { categoryId: cat.id, amount: "30000", transactionDate: "2026-03-12" },
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

  it("deleteTransaction — removes the transaction from the database", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "20000", transactionDate: "2026-03-14" },
        ACTOR_ID
      )
    )

    await Effect.runPromise(deleteTransaction(txn.id, ACTOR_ID))

    // Verify it's gone
    const exit = await Effect.runPromiseExit(getTransactionById(txn.id))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("deleteTransaction — writes audit log with beforeValue", async () => {
    const cat = await seedExpenseCategory()

    const txn = await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "15000", transactionDate: "2026-03-14" },
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
        { categoryId: expCat.id, amount: "500000", transactionDate: "2026-03-01" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordIncome(
        { categoryId: incCat.id, amount: "100000", transactionDate: "2026-03-02" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: expCat.id, amount: "50000", transactionDate: "2026-03-03" },
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
        { categoryId: expCat.id, amount: "50000", transactionDate: "2026-03-01" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordIncome(
        { categoryId: incCat.id, amount: "100000", transactionDate: "2026-03-02" },
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
        { categoryId: cat1.id, amount: "50000", transactionDate: "2026-03-01" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat2.id, amount: "30000", transactionDate: "2026-03-02" },
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
        { categoryId: cat.id, amount: "10000", transactionDate: "2026-01-15" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "20000", transactionDate: "2026-03-15" },
        ACTOR_ID
      )
    )
    await Effect.runPromise(
      recordExpense(
        { categoryId: cat.id, amount: "30000", transactionDate: "2026-05-15" },
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
