import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import BigNumber from "bignumber.js"
import type { DrizzleTx, TransactionCallback } from "./_test-helpers"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/transaction.service", () => ({
  postJournalEntry: vi.fn().mockResolvedValue("mock-journal-group-id"),
  reverseInterestAccrual: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/auto-post.service", () => ({
  autoPostPrincipalDisbursement: vi.fn().mockResolvedValue(undefined),
  autoPostRolloverPrincipalTransfer: vi.fn().mockResolvedValue(undefined),
  autoPostInterestEarned: vi.fn().mockResolvedValue(undefined),
  autoPostPrincipalRepayment: vi.fn().mockResolvedValue(undefined),
  autoPostCapitalInjection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getPaymentPortionsFromLedger: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

// ── Shared fixtures ────────────────────────────────────────────────────────

const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000.00",
  issuanceFee: "50000.00",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: new Date("2026-03-19T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
  disbursementSource: "cash",
  loanType: "perpetual",
  termMonths: null,
  penaltyWaived: false,
  penaltyMultiplier: null,
  penaltyWaivedBy: null,
  penaltyWaivedAt: null,
  rolledOverFrom: null,
  rolloverAmount: null,
  backdatedFrom: null,
  backdatedBy: null,
  backdatedAt: null,
  backdateNote: null,
  createdAt: new Date("2026-03-19T00:00:00.000Z"),
  updatedAt: new Date("2026-03-19T00:00:00.000Z"),
  deletedAt: null,
}

// ── Bug 1: Fee reversal query must not match disbursement credit ────────────

describe("Bug 1: updateLoan fee reversal query must identify only the issuance fee transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reverses only the Issuance Fees credit, not the disbursement credit, when both exist", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { postJournalEntry } = await import("@/services/transaction.service")

    // Existing loan lookup
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    const updatedLoan = { ...mockLoan, issuanceFee: "75000.00" }

    // The issuance fee credit (Issuance Fees category) -- this is what we want
    const issuanceFeeTx = {
      id: "tx-fee-1",
      amount: "50000.00",
      transactionDate: new Date("2026-03-19"),
      depositLocation: null,
      journalGroupId: "jg-fee-1",
    }

    // The updateLoan function queries with:
    //   tx.select({...}).from(transactions)
    //     .innerJoin(transactionCategories, ...)
    //     .where(and(
    //       eq(transactions.referenceType, "loan"),
    //       eq(transactions.referenceId, input.loanId),
    //       eq(transactions.type, "credit"),
    //       eq(transactionCategories.name, "Issuance Fees")  <-- KEY FILTER
    //     ))
    //
    // Bug scenario: Without the category filter, both fee and disbursement credits
    // match referenceType='loan' + type='credit'. The query would return the first
    // one (potentially the disbursement), causing wrong amount reversed.

    let selectCallCount = 0
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedLoan]),
          }),
        })),
      })),
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Fee transaction lookup: uses innerJoin with category filter.
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([issuanceFeeTx]),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: TransactionCallback) => callback(mockTx as unknown as DrizzleTx)
    )

    const { updateLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      updateLoan({ loanId: "loan-1", issuanceFee: "75000.00", reason: "Fee adjustment" }, "actor-1")
    )

    // Verify the query uses innerJoin (category join to filter by "Issuance Fees")
    expect(mockTx.select).toHaveBeenCalled()
    const selectResult = mockTx.select.mock.results[0].value
    expect(selectResult.from).toHaveBeenCalled()
    const fromResult = selectResult.from.mock.results[0].value
    expect(fromResult.innerJoin).toHaveBeenCalled()

    // Verify the reversal uses the fee amount (50000.00), NOT the disbursement amount (500000.00)
    expect(postJournalEntry).toHaveBeenCalledTimes(2)
    const reversalCall = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(reversalCall[1].amount).toBe("50000.00")
    expect(reversalCall[1].referenceType).toBe("loan_reversal")

    // Verify the new fee is posted with the correct new amount
    const newFeeCall = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(newFeeCall[1].amount).toBe("75000.00")
    expect(newFeeCall[1].referenceType).toBe("loan")
  })

  it("does NOT reverse when no Issuance Fees category match (category filter is essential)", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { postJournalEntry } = await import("@/services/transaction.service")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    const updatedLoan = { ...mockLoan, issuanceFee: "75000.00" }

    // Simulate: category filter returns no matches (e.g., fee was never posted)
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedLoan]),
          }),
        })),
      })),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: TransactionCallback) => callback(mockTx as unknown as DrizzleTx)
    )

    const { updateLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      updateLoan({ loanId: "loan-1", issuanceFee: "75000.00", reason: "Fee adjustment" }, "actor-1")
    )

    // No reversal posted (no old fee found), only the new fee
    expect(postJournalEntry).toHaveBeenCalledTimes(1)
    const newFeeCall = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(newFeeCall[1].amount).toBe("75000.00")
    expect(newFeeCall[1].referenceType).toBe("loan")
  })

  it("would reverse wrong amount if query matched disbursement instead of fee", () => {
    // Pure logic test demonstrating the bug scenario.
    // If the fee reversal logic selected a disbursement credit (500k) instead of
    // the issuance fee credit (50k), the reversal amount would be wrong.

    const feeCredit = { amount: "50000.00", type: "credit", referenceType: "loan", categoryName: "Issuance Fees" }
    const disbursementCredit = { amount: "500000.00", type: "credit", referenceType: "loan", categoryName: "Cash" }

    // Both match referenceType='loan' + type='credit'
    const allCredits = [feeCredit, disbursementCredit]

    // Correct filter: must also match categoryName = "Issuance Fees"
    const correctMatch = allCredits.find((tx) => tx.categoryName === "Issuance Fees")

    expect(correctMatch).toBeDefined()
    expect(correctMatch!.amount).toBe("50000.00")

    // Without category filter, if the disbursement credit came first, we'd reverse 500k
    // instead of 50k -- a 10x error in the ledger
    expect(disbursementCredit.amount).not.toBe(feeCredit.amount)
    expect(new BigNumber(disbursementCredit.amount).dividedBy(feeCredit.amount).toNumber()).toBe(10)
  })
})

// ── Bug 2: Pure logic tests for accrual reversal ─────────────────────────────
// (The mocked-DB integration tests for reverseInterestAccrual are in
//  reverse-interest-accrual.service.test.ts since they need the real function)

describe("Bug 2: reverseInterestAccrual ignores penalty accruals (pure logic)", () => {
  it("if only interest_accrual queried (bug), penalty accruals are left unreversed", () => {
    // Pure logic test demonstrating the financial impact of the bug.
    // When a payment arrives, we must reverse ALL outstanding accruals to avoid
    // double-counting interest (accrual-basis + cash-basis).

    const normalAccruals = [
      { amount: "10000.00", type: "debit", referenceType: "interest_accrual" },
    ]
    const penaltyAccruals = [
      { amount: "5000.00", type: "debit", referenceType: "penalty_interest_accrual" },
    ]

    // Bug: only summing interest_accrual entries
    const buggyTotal = normalAccruals.reduce(
      (sum, row) => sum.plus(row.type === "debit" ? row.amount : new BigNumber(row.amount).negated()),
      new BigNumber(0)
    )

    // Fix: summing both interest_accrual AND penalty_interest_accrual entries
    const allAccruals = [...normalAccruals, ...penaltyAccruals]
    const correctTotal = allAccruals.reduce(
      (sum, row) => sum.plus(row.type === "debit" ? row.amount : new BigNumber(row.amount).negated()),
      new BigNumber(0)
    )

    // Buggy reversal: only 10000, leaving 5000 of penalty accrual unreversed
    expect(buggyTotal.toFixed(2)).toBe("10000.00")
    // Correct reversal: 15000, reversing everything
    expect(correctTotal.toFixed(2)).toBe("15000.00")

    // The difference is the penalty accrual left dangling in the ledger
    const unreversed = correctTotal.minus(buggyTotal)
    expect(unreversed.toFixed(2)).toBe("5000.00")
    expect(unreversed.isGreaterThan(0)).toBe(true)
  })

  it("net accrual calculation must include both reference types for correct reversal amount", () => {
    // Simulate the net calculation the function performs internally.
    // The function walks all accrual rows and sums debits minus credits.
    // With only interest_accrual, the penalty portion is silently lost.

    const accrualRows = [
      { amount: "20000.00", type: "debit", referenceType: "interest_accrual" },
      { amount: "5000.00", type: "credit", referenceType: "interest_accrual" },
      { amount: "8000.00", type: "debit", referenceType: "penalty_interest_accrual" },
      { amount: "2000.00", type: "credit", referenceType: "penalty_interest_accrual" },
    ]

    // Bug: only count interest_accrual rows
    const buggyRows = accrualRows.filter((r) => r.referenceType === "interest_accrual")
    const buggyNet = buggyRows.reduce(
      (sum, row) => row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
      new BigNumber(0)
    )

    // Fix: count both reference types
    const correctNet = accrualRows.reduce(
      (sum, row) => row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
      new BigNumber(0)
    )

    // Bug: net = 20000 - 5000 = 15000 (misses penalty accrual)
    expect(buggyNet.toFixed(2)).toBe("15000.00")
    // Correct: net = (20000 - 5000) + (8000 - 2000) = 21000
    expect(correctNet.toFixed(2)).toBe("21000.00")

    // Penalty accrual contribution = 6000 would be left unreversed
    const unreversed = correctNet.minus(buggyNet)
    expect(unreversed.toFixed(2)).toBe("6000.00")
  })
})
