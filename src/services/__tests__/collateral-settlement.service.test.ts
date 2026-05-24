import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import BigNumber from "bignumber.js"
import type { Loan } from "@/types"
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
  autoPostPrincipalRecovery: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/ledger-queries.service", async () => {
  const BigNumberMod = await import("bignumber.js")
  const BigNumberCtor = BigNumberMod.default
  return {
    getLoanBalancesFromLedger: vi.fn().mockImplementation(async () => {
      const map = new Map()
      map.set("loan-1", new BigNumberCtor("400000"))
      return map
    }),
  }
})

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn().mockReturnValue("0.10"),
}))

vi.mock("@/lib/interest/engine", () => ({
  calculateInterest: vi.fn().mockReturnValue(new BigNumber("15000")),
  formatAmount: vi.fn().mockImplementation((v: BigNumber) => v.toFixed(0)),
}))

vi.mock("@/lib/db/utils", () => ({
  daysBetween: vi.fn().mockReturnValue(30),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000",
  interestRate: "0.10",
  interestRateOverride: null,
  status: "active",
  startDate: new Date("2026-03-01"),
  minInterestDays: 30,
  minPeriodOverride: null,
  loanType: "perpetual",
  termMonths: null,
  deletedAt: null,
}

describe("Collateral Settlement Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── settleWithCollateral: markedWrong filter ──────────────────────
  it("activePayments query excludes markedWrong payments during collateral settlement", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // Mock initial loan lookup (outside transaction)
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    // Capture the where clause argument from the payments query inside the transaction
    let capturedWhereArg: unknown = null
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: TransactionCallback) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation((whereArg: unknown) => {
                capturedWhereArg = whereArg
                return {
                  orderBy: vi.fn().mockResolvedValue([]),
                }
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ ...mockLoan, status: "settled_with_collateral" }]),
              }),
            }),
          }),
        }
        return callback(mockTx as unknown as DrizzleTx)
      }
    )

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    await Effect.runPromise(
      settleWithCollateral({ loanId: "loan-1", reason: "Defaulted" }, "actor-1")
    )

    // The where clause must include a markedWrong filter (marked_wrong column).
    // Use depth 7 to see direct column references without traversing into
    // the parent table's full column list (which would appear at depth >= 8).
    expect(capturedWhereArg).not.toBeNull()
    const { inspect } = await import("util")
    const serialized = inspect(capturedWhereArg, { depth: 7 })
    expect(serialized).toContain("marked_wrong")
  })

  // ── settleWithCollateral: happy path ──────────────────────────────

  it("settles a loan with collateral: posts interest, principal recovery, seizes collateral, updates status", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { postJournalEntry, reverseInterestAccrual } = await import("@/services/transaction.service")
    const { autoPostPrincipalRecovery } = await import("@/services/auto-post.service")

    // Mock initial loan lookup (outside transaction)
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    // Mock transaction
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: TransactionCallback) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),  // no active payments
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ ...mockLoan, status: "settled_with_collateral" }]),
              }),
            }),
          }),
        }
        return callback(mockTx as unknown as DrizzleTx)
      }
    )

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    const result = await Effect.runPromise(
      settleWithCollateral({ loanId: "loan-1", reason: "Defaulted" }, "actor-1")
    )

    expect(result.loan.status).toBe("settled_with_collateral")
    expect(typeof result.txid).toBe("number")

    // Should reverse interest accrual (accruedInterest > 0)
    expect(reverseInterestAccrual).toHaveBeenCalledOnce()

    // Should post accrued interest journal entry
    expect(postJournalEntry).toHaveBeenCalledOnce()

    // Should post principal recovery
    expect(autoPostPrincipalRecovery).toHaveBeenCalledOnce()

    // Should write audit log
    expect(writeAuditLog).toHaveBeenCalledOnce()
  })

  // ── settleWithCollateral: loan not found ──────────────────────────

  it("returns LoanNotFound when loan does not exist", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    const exit = await Effect.runPromiseExit(
      settleWithCollateral({ loanId: "nonexistent", reason: "Defaulted" }, "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("LoanNotFound")
      }
    }
  })

  // ── settleWithCollateral: loan not active ─────────────────────────

  it("returns ValidationError when loan is not active", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const paidLoan = { ...mockLoan, status: "fully_paid" }
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([paidLoan]),
      }),
    })

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    const exit = await Effect.runPromiseExit(
      settleWithCollateral({ loanId: "loan-1", reason: "Defaulted" }, "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("ValidationError")
        expect(error.value.message).toContain("must be active")
      }
    }
  })

  // ── settleWithCollateral: already settled ─────────────────────────

  it("returns ValidationError when loan is already settled with collateral", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const settledLoan = { ...mockLoan, status: "settled_with_collateral" }
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([settledLoan]),
      }),
    })

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    const exit = await Effect.runPromiseExit(
      settleWithCollateral({ loanId: "loan-1", reason: "Defaulted again" }, "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("ValidationError")
        expect(error.value.message).toContain("must be active")
      }
    }
  })

  // ── settleWithCollateral: database error ──────────────────────────

  it("returns DatabaseError when transaction fails", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Transaction failed")
    )

    const { settleWithCollateral } = await import("@/services/collateral-settlement.service")
    const exit = await Effect.runPromiseExit(
      settleWithCollateral({ loanId: "loan-1", reason: "Defaulted" }, "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("DatabaseError")
      }
    }
  })

  // ── computeAccruedInterest ────────────────────────────────────────

  it("computeAccruedInterest returns interest for perpetual loan with no payments", async () => {
    const { computeAccruedInterest } = await import("@/services/collateral-settlement.service")
    const { calculateInterest } = await import("@/lib/interest/engine")

    const result = computeAccruedInterest(
      mockLoan as unknown as Loan,
      [],
      new BigNumber("400000")
    )

    expect(calculateInterest).toHaveBeenCalled()
    expect(result).toBeInstanceOf(BigNumber)
  })

  it("computeAccruedInterest uses last payment date when payments exist", async () => {
    const { computeAccruedInterest } = await import("@/services/collateral-settlement.service")

    const activePayments = [
      { paymentDate: new Date("2026-03-15") },
      { paymentDate: new Date("2026-04-01") },
    ]

    const result = computeAccruedInterest(
      mockLoan as unknown as Loan,
      activePayments,
      new BigNumber("300000")
    )

    expect(result).toBeInstanceOf(BigNumber)
  })

  it("computeAccruedInterest handles fixed_rate loan type", async () => {
    const { computeAccruedInterest } = await import("@/services/collateral-settlement.service")

    const fixedRateLoan = { ...mockLoan, loanType: "fixed_rate" }

    const result = computeAccruedInterest(
      fixedRateLoan as unknown as Loan,
      [],
      new BigNumber("500000")
    )

    expect(result).toBeInstanceOf(BigNumber)
  })

  it("computeAccruedInterest handles reducing_balance loan type", async () => {
    const { computeAccruedInterest } = await import("@/services/collateral-settlement.service")

    const reducingLoan = { ...mockLoan, loanType: "reducing_balance" }

    const result = computeAccruedInterest(
      reducingLoan as unknown as Loan,
      [],
      new BigNumber("300000")
    )

    expect(result).toBeInstanceOf(BigNumber)
  })

  // ── getCustomerActiveLoan ─────────────────────────────────────────

  it("getCustomerActiveLoan returns null when no active loan exists", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })

    const { getCustomerActiveLoan } = await import("@/services/collateral-settlement.service")
    const result = await getCustomerActiveLoan("cust-1")

    expect(result).toBeNull()
  })

  it("getCustomerActiveLoan returns loan with computed figures when active loan exists", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // First call: select loan + customer join
    let selectCallCount = 0
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      if (selectCallCount === 1) {
        // loan + customer join
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ loan: mockLoan, customerName: "Jane Doe" }]),
              }),
            }),
          }),
        }
      }
      // Second call: payments
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }
    })

    const { getCustomerActiveLoan } = await import("@/services/collateral-settlement.service")
    const result = await getCustomerActiveLoan("cust-1")

    expect(result).not.toBeNull()
    expect(result!.customerName).toBe("Jane Doe")
    expect(result!.loan.id).toBe("loan-1")
    expect(result!.outstandingPrincipal).toBeDefined()
    expect(result!.accruedInterest).toBeDefined()
  })
})
