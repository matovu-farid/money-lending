import { describe, it, expect, vi, beforeEach } from "vitest"
import type { DrizzleTx } from "./_test-helpers"

type InsertedTransaction = Record<string, unknown>

// Mock ONLY the db module and drizzle-orm -- NOT transaction.service itself,
// because we want to test the real reverseInterestAccrual function.

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn() }
  return { db: mockDb }
})

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("crypto", () => ({
  randomUUID: () => "mock-uuid-1234",
}))

describe("Bug 2: reverseInterestAccrual must include penalty_interest_accrual entries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reversal includes both interest_accrual and penalty_interest_accrual rows in net computation", async () => {
    // The reverseInterestAccrual function should query for BOTH reference types:
    //   inArray(transactions.referenceType, ["interest_accrual", "penalty_interest_accrual"])
    //
    // The bug was that it only queried for "interest_accrual", leaving penalty
    // accrual entries unreversed when a payment arrived.

    const receivableCat = { id: "cat-receivable", name: "Interest Receivable", type: "revenue" }
    const earnedCat = { id: "cat-earned", name: "Interest Earned", type: "revenue" }

    // Both normal interest and penalty interest accrual entries
    const normalAccrual = { amount: "10000.00", type: "debit" }
    const penaltyAccrual = { amount: "5000.00", type: "debit" }

    let selectCallCount = 0
    const insertCalls: InsertedTransaction[] = []
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // First call: lookup Interest Receivable category
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([receivableCat]),
            }),
          }
        } else if (selectCallCount === 2) {
          // Second call: lookup Interest Earned category
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([earnedCat]),
            }),
          }
        } else {
          // Third call: query accrual rows (should return both types)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([normalAccrual, penaltyAccrual]),
            }),
          }
        }
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: InsertedTransaction) => {
          insertCalls.push(vals)
          return Promise.resolve()
        }),
      })),
    }

    const { reverseInterestAccrual } = await import("@/services/transaction.service")
    await reverseInterestAccrual(mockTx as unknown as DrizzleTx, {
      loanId: "loan-1",
      paymentDate: "2026-04-01",
      actorId: "actor-1",
    })

    // The function should compute netAccrual = 10000 + 5000 = 15000
    // and post 2 reversal entries (CR Interest Receivable + DR Interest Earned)
    expect(mockTx.insert).toHaveBeenCalledTimes(2)
    expect(insertCalls).toHaveLength(2)

    // Verify the reversal amount includes BOTH accrual types
    const creditEntry = insertCalls[0]
    expect(creditEntry.amount).toBe("15000.00")
    expect(creditEntry.type).toBe("credit")
    expect(creditEntry.categoryId).toBe("cat-receivable")

    const debitEntry = insertCalls[1]
    expect(debitEntry.amount).toBe("15000.00")
    expect(debitEntry.type).toBe("debit")
    expect(debitEntry.categoryId).toBe("cat-earned")
  })

  it("reversal handles mixed debit/credit accrual rows including penalty entries", async () => {
    // When some accruals have already been partially reversed, the net should
    // still include both reference types correctly.

    const receivableCat = { id: "cat-receivable", name: "Interest Receivable", type: "revenue" }
    const earnedCat = { id: "cat-earned", name: "Interest Earned", type: "revenue" }

    // Mixed scenario: normal accrual DR 20k, penalty accrual DR 8k,
    // prior partial reversal CR 5k
    const accrualRows = [
      { amount: "20000.00", type: "debit" },   // interest_accrual debit
      { amount: "5000.00", type: "credit" },    // interest_accrual credit (prior reversal)
      { amount: "8000.00", type: "debit" },     // penalty_interest_accrual debit
    ]

    let selectCallCount = 0
    const insertCalls: InsertedTransaction[] = []
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([receivableCat]) }) }
        } else if (selectCallCount === 2) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([earnedCat]) }) }
        } else {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(accrualRows) }) }
        }
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: InsertedTransaction) => {
          insertCalls.push(vals)
          return Promise.resolve()
        }),
      })),
    }

    const { reverseInterestAccrual } = await import("@/services/transaction.service")
    await reverseInterestAccrual(mockTx as unknown as DrizzleTx, {
      loanId: "loan-1",
      paymentDate: "2026-04-01",
      actorId: "actor-1",
    })

    // Net accrual = 20000 - 5000 + 8000 = 23000
    expect(insertCalls).toHaveLength(2)
    expect(insertCalls[0].amount).toBe("23000.00")
    expect(insertCalls[1].amount).toBe("23000.00")
  })

  it("does not post reversal when net accrual is zero (all already reversed)", async () => {
    const receivableCat = { id: "cat-receivable", name: "Interest Receivable", type: "revenue" }
    const earnedCat = { id: "cat-earned", name: "Interest Earned", type: "revenue" }

    // Normal accrual of 10k fully reversed + penalty of 5k fully reversed
    const accrualRows = [
      { amount: "10000.00", type: "debit" },
      { amount: "10000.00", type: "credit" },
      { amount: "5000.00", type: "debit" },
      { amount: "5000.00", type: "credit" },
    ]

    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([receivableCat]) }) }
        } else if (selectCallCount === 2) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([earnedCat]) }) }
        } else {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(accrualRows) }) }
        }
      }),
      insert: vi.fn(),
    }

    const { reverseInterestAccrual } = await import("@/services/transaction.service")
    await reverseInterestAccrual(mockTx as unknown as DrizzleTx, {
      loanId: "loan-1",
      paymentDate: "2026-04-01",
      actorId: "actor-1",
    })

    // Net = 0, so no reversal entries should be posted
    expect(mockTx.insert).not.toHaveBeenCalled()
  })

  it("only-penalty accruals are still reversed (not silently skipped)", async () => {
    // Edge case: a loan has ONLY penalty accruals and no normal interest accruals.
    // With the bug, reverseInterestAccrual would find zero rows and do nothing.

    const receivableCat = { id: "cat-receivable", name: "Interest Receivable", type: "revenue" }
    const earnedCat = { id: "cat-earned", name: "Interest Earned", type: "revenue" }

    // Only penalty accrual entries
    const accrualRows = [
      { amount: "12000.00", type: "debit" },  // penalty_interest_accrual
    ]

    let selectCallCount = 0
    const insertCalls: InsertedTransaction[] = []
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([receivableCat]) }) }
        } else if (selectCallCount === 2) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([earnedCat]) }) }
        } else {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(accrualRows) }) }
        }
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: InsertedTransaction) => {
          insertCalls.push(vals)
          return Promise.resolve()
        }),
      })),
    }

    const { reverseInterestAccrual } = await import("@/services/transaction.service")
    await reverseInterestAccrual(mockTx as unknown as DrizzleTx, {
      loanId: "loan-1",
      paymentDate: "2026-04-01",
      actorId: "actor-1",
    })

    // Should post reversal for the 12000 penalty accrual
    expect(insertCalls).toHaveLength(2)
    expect(insertCalls[0].amount).toBe("12000.00")
    expect(insertCalls[0].type).toBe("credit")
    expect(insertCalls[1].amount).toBe("12000.00")
    expect(insertCalls[1].type).toBe("debit")
  })
})
