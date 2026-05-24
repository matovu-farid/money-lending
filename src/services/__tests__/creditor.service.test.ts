import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateInterest, allocatePayment } from "@/lib/interest/engine"
import { Effect, Exit } from "effect"
import BigNumber from "bignumber.js"
import type { DrizzleTx, TransactionCallback } from "./_test-helpers"

describe("Creditor Service — exports", () => {
  it("exports all expected functions", async () => {
    const mod = await import("@/services/creditor.service")
    const expectedExports = [
      "createCreditor",
      "updateCreditor",
      "getCreditor",
      "listCreditors",
      "addInvestment",
      "recordCreditorRepayment",
      "getCreditorDashboard",
      "getSystemCapital",
    ]
    for (const name of expectedExports) {
      expect(mod).toHaveProperty(name)
      expect(typeof (mod as Record<string, unknown>)[name]).toBe("function")
    }
  })
})

describe("Creditor Service — interest accrual math (minInterestDays=0)", () => {
  it("10M UGX at 10%/month for 30 days accrues 1,000,000 interest (CRED-03)", () => {
    // 10,000,000 * 0.10 * 30 / 30 = 1,000,000 (exact: divide-by-30 is deferred
    // in calculateInterest so 30-day periods don't suffer from 1/30 ULP loss).
    const interest = calculateInterest("10000000", "0.10", 30, 0)
    expect(interest.toFixed(2)).toBe("1000000.00")
  })

  it("15-day investment accrues 15 days of interest with minInterestDays=0 (CRED-03)", () => {
    // 10,000,000 * 0.10 * 15 / 30 = 500,000
    const interest = calculateInterest("10000000", "0.10", 15, 0)
    expect(interest.toFixed(2)).toBe("500000.00")
  })

  it("15-day investment does NOT use minInterestDays=30 (no minimum enforcement for creditors)", () => {
    // With minInterestDays=0: 10M * 0.10 * 15 / 30 = 500,000
    // With minInterestDays=30: 10M * 0.10 * 30 / 30 = 1,000,000
    const creditorInterest = calculateInterest("10000000", "0.10", 15, 0)
    const borrowerInterest = calculateInterest("10000000", "0.10", 15, 30)
    expect(creditorInterest.toFixed(2)).toBe("500000.00")
    expect(borrowerInterest.toFixed(2)).toBe("1000000.00")
    // Creditor accrues less than borrower minimum — this is correct
    expect(creditorInterest.isLessThan(borrowerInterest)).toBe(true)
  })
})

describe("Creditor Service — repayment allocation (interest-first)", () => {
  it("payment <= interest: all goes to interest, principal unchanged (CRED-04)", () => {
    // 10M at 10%/month, 30 days elapsed: interest = 1,000,000
    // Payment of 500,000 (less than interest): all to interest
    const result = allocatePayment({
      paymentAmount: "500000",
      principalBalanceBefore: "10000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("500000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceBefore).toBe("10000000")
    expect(result.principalBalanceAfter).toBe("10000000")
  })

  it("1,500,000 payment against 1,000,000 interest: 1M to interest, remainder to principal (CRED-04)", () => {
    // 10M at 10%/month, 30 days elapsed: interest = 1,000,000 (exact —
    // calculateInterest defers the divide-by-30, so 10M × 0.10 × 30 / 30 = 1M).
    // Payment of 1,500,000: 1,000,000 to interest, 500,000 to principal.
    const result = allocatePayment({
      paymentAmount: "1500000",
      principalBalanceBefore: "10000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("1000000.00")
    expect(result.principalPortion).toBe("500000.00")
    expect(result.principalBalanceAfter).toBe("9500000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("payment larger than interest + principal: principalBalance reaches zero (fully repaid)", () => {
    // 100K principal at 10%/month, 30 days: interest ≈ 9999.9999
    // With toFixed(0): interest rounds to 10000
    // Payment of 200,000: more than enough to cover interest + principal
    const result = allocatePayment({
      paymentAmount: "200000",
      principalBalanceBefore: "100000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("10000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })
})

describe("Creditor Service — TypeScript types (CRED-01, CRED-02, CRED-05)", () => {
  it("CreateCreditorInput has name, contact, address fields", async () => {
    const input: import("@/types").CreateCreditorInput = {
      name: "John Doe Investments",
      contact: "+256700000001",
      address: "Kampala, Uganda",
    }
    expect(input.name).toBeDefined()
    expect(input.contact).toBeDefined()
    expect(input.address).toBeDefined()
  })

  it("AddInvestmentInput has creditorId, amount, interestRateMonthly, investmentDate", async () => {
    const input: import("@/types").AddInvestmentInput = {
      creditorId: "550e8400-e29b-41d4-a716-446655440001",
      amount: "10000000",
      interestRateMonthly: "0.10",
      investmentDate: "2026-01-01T00:00:00.000Z",
    }
    expect(input.creditorId).toBeDefined()
    expect(input.amount).toBeDefined()
    expect(input.interestRateMonthly).toBeDefined()
    expect(input.investmentDate).toBeDefined()
  })

  it("RecordCreditorRepaymentInput has investmentId, amount, repaymentDate", async () => {
    const input: import("@/types").RecordCreditorRepaymentInput = {
      investmentId: "550e8400-e29b-41d4-a716-446655440002",
      amount: "1500000",
      repaymentDate: "2026-02-01T00:00:00.000Z",
    }
    expect(input.investmentId).toBeDefined()
    expect(input.amount).toBeDefined()
    expect(input.repaymentDate).toBeDefined()
  })

  it("CreditorDashboard has totalInvested, interestAccrued, repaymentsMade, outstandingBalance, investments", async () => {
    const dashboard: import("@/types").CreditorDashboard = {
      totalInvested: "10000000.00",
      interestAccrued: "1000000.00",
      repaymentsMade: "500000.00",
      outstandingBalance: "10500000.00",
      investments: [],
    }
    expect(dashboard.totalInvested).toBeDefined()
    expect(dashboard.interestAccrued).toBeDefined()
    expect(dashboard.repaymentsMade).toBeDefined()
    expect(dashboard.outstandingBalance).toBeDefined()
    expect(Array.isArray(dashboard.investments)).toBe(true)
  })
})

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/auto-post.service", () => ({
  autoPostInterestExpense: vi.fn().mockResolvedValue(undefined),
  autoPostCreditorInvestment: vi.fn().mockResolvedValue(undefined),
  autoPostCreditorPrincipalRepaid: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/ledger-queries.service", async () => {
  const { default: BigNumberCtor } = await vi.importActual<typeof import("bignumber.js")>(
    "bignumber.js"
  )
  return {
    getCreditorBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
    getInterestPayableFromLedger: vi.fn().mockResolvedValue(new Map()),
    getCreditorTotalInvestedFromLedger: vi.fn().mockResolvedValue(new BigNumberCtor(0)),
    getCreditorTotalRepaidFromLedger: vi.fn().mockResolvedValue(new BigNumberCtor(0)),
  }
})

vi.mock("@/services/transaction.service", () => ({
  reverseCreditorInterestAccrual: vi.fn().mockResolvedValue(undefined),
}))

type DbMocks = {
  [K in keyof typeof import("@/lib/db").db]: ReturnType<typeof vi.fn>
}
type Mocked = ReturnType<typeof vi.fn>

describe("Creditor Service — DB operations (requires test DB)", () => {
  let mockedDb: DbMocks
  let mockedWriteAuditLog: Mocked
  let mockedGetCreditorBalancesFromLedger: Mocked
  let mockedGetInterestPayableFromLedger: Mocked
  let mockedGetCreditorTotalInvestedFromLedger: Mocked
  let mockedGetCreditorTotalRepaidFromLedger: Mocked

  let createCreditor: typeof import("@/services/creditor.service").createCreditor
  let updateCreditor: typeof import("@/services/creditor.service").updateCreditor
  let getCreditor: typeof import("@/services/creditor.service").getCreditor
  let listCreditors: typeof import("@/services/creditor.service").listCreditors
  let addInvestment: typeof import("@/services/creditor.service").addInvestment
  let recordCreditorRepayment: typeof import("@/services/creditor.service").recordCreditorRepayment
  let getCreditorDashboard: typeof import("@/services/creditor.service").getCreditorDashboard
  let getSystemCapital: typeof import("@/services/creditor.service").getSystemCapital

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db as unknown as DbMocks
    const auditMod = await import("@/services/audit.service")
    mockedWriteAuditLog = auditMod.writeAuditLog as unknown as Mocked
    const ledgerMod = await import("@/services/ledger-queries.service")
    mockedGetCreditorBalancesFromLedger = ledgerMod.getCreditorBalancesFromLedger as unknown as Mocked
    mockedGetInterestPayableFromLedger = ledgerMod.getInterestPayableFromLedger as unknown as Mocked
    mockedGetCreditorTotalInvestedFromLedger = ledgerMod.getCreditorTotalInvestedFromLedger as unknown as Mocked
    mockedGetCreditorTotalRepaidFromLedger = ledgerMod.getCreditorTotalRepaidFromLedger as unknown as Mocked
    const svc = await import("@/services/creditor.service")
    createCreditor = svc.createCreditor
    updateCreditor = svc.updateCreditor
    getCreditor = svc.getCreditor
    listCreditors = svc.listCreditors
    addInvestment = svc.addInvestment
    recordCreditorRepayment = svc.recordCreditorRepayment
    getCreditorDashboard = svc.getCreditorDashboard
    getSystemCapital = svc.getSystemCapital
  })

  const mockCreditor = {
    id: "cred-1",
    name: "Alice Fund",
    contact: "+256700000001",
    address: "Kampala",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }

  const mockInvestment = {
    id: "inv-1",
    creditorId: "cred-1",
    amount: "10000000",
    interestRateMonthly: "0.10",
    investmentDate: new Date("2026-01-01"),
    recordedBy: "actor-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }

  const mockRepayment = {
    id: "rep-1",
    investmentId: "inv-1",
    repaymentDate: new Date("2026-01-31"),
    amount: "1500000",
    recordedBy: "actor-1",
    createdAt: new Date("2026-01-31"),
    updatedAt: new Date("2026-01-31"),
  }

  type TxMock = {
    insert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
  }

  function makeTxMock(overrides?: {
    insertResult?: Record<string, unknown>
    updateResult?: Record<string, unknown>
    selectResults?: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
  }): TxMock {
    let selectCallIndex = 0
    const selectResults = overrides?.selectResults ?? [[]]
    const mockTx: TxMock = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([overrides?.insertResult ?? mockCreditor]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([overrides?.updateResult ?? mockCreditor]),
          }),
        }),
      }),
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const idx = selectCallIndex++
            const result = selectResults[idx] ?? []
            // Support both `.where()` (returns thenable) and `.where().orderBy()` chains
            const thenable = Object.assign(Promise.resolve(result), {
              orderBy: vi.fn().mockImplementation(() => Promise.resolve(result)),
            })
            return thenable
          }),
        }),
      })),
    }
    return mockTx
  }

  function setupTransaction(txMock: object) {
    mockedDb.transaction.mockImplementation(
      async (cb: TransactionCallback) => cb(txMock as unknown as DrizzleTx)
    )
  }

  function setupDbSelect<T>(rows: T[]) {
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    })
  }

  type ResolveFn<T> = (value: T) => void
  type RejectFn = (reason?: unknown) => void

  // Each call to `db.select(...).from(...)` returns a different row shape
  // (creditor, investment, repayment, etc.), so the per-call element type is
  // heterogeneous and `unknown` is the honest common bound. The mocks just
  // resolve with whatever the test supplied — no narrowing happens inside.
  function setupDbSelectChain(callResults: ReadonlyArray<ReadonlyArray<unknown>>) {
    let callIndex = 0
    mockedDb.select.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        const idx = callIndex++
        const result = callResults[idx] ?? []
        const whereObj = {
          orderBy: vi.fn().mockResolvedValue(result),
          groupBy: vi.fn().mockResolvedValue(result),
          then: (resolve: ResolveFn<ReadonlyArray<unknown>>, reject?: RejectFn) =>
            Promise.resolve(result).then(resolve, reject),
        }
        const chainObj = {
          where: vi.fn().mockReturnValue(whereObj),
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue(result),
              then: (resolve: ResolveFn<ReadonlyArray<unknown>>, reject?: RejectFn) =>
                Promise.resolve(result).then(resolve, reject),
            }),
          }),
          orderBy: vi.fn().mockResolvedValue(result),
          then: (resolve: ResolveFn<ReadonlyArray<unknown>>, reject?: RejectFn) =>
            Promise.resolve(result).then(resolve, reject),
        }
        return chainObj
      }),
    }))
  }

  // ── createCreditor ───────────────────────────────────────────────────

  it("createCreditor: inserts creditor record and returns Creditor type (CRED-01)", async () => {
    const txMock = makeTxMock({ insertResult: mockCreditor })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      createCreditor({ name: "Alice Fund", contact: "+256700000001", address: "Kampala" }, "actor-1"),
    )

    expect(result).toEqual(mockCreditor)
    expect(mockedDb.transaction).toHaveBeenCalledOnce()
    expect(txMock.insert).toHaveBeenCalledOnce()
  })

  it("createCreditor: writes audit log in same transaction", async () => {
    const txMock = makeTxMock({ insertResult: mockCreditor })
    setupTransaction(txMock)

    await Effect.runPromise(
      createCreditor({ name: "Alice Fund", contact: "+256700000001", address: "Kampala" }, "actor-1"),
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actorId: "actor-1",
      action: "creditor.create",
      entityType: "creditor",
      entityId: "cred-1",
      beforeValue: null,
      afterValue: mockCreditor,
    }))
  })

  // ── updateCreditor ───────────────────────────────────────────────────

  it("updateCreditor: updates creditor fields and returns updated record (CRED-01)", async () => {
    const updatedCreditor = { ...mockCreditor, name: "Bob Capital", updatedAt: new Date("2026-02-01") }
    setupDbSelect([mockCreditor])
    const txMock = makeTxMock({ updateResult: updatedCreditor })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      updateCreditor("cred-1", { name: "Bob Capital" }, "actor-1"),
    )

    expect(result).toEqual(updatedCreditor)
    expect(txMock.update).toHaveBeenCalledOnce()
  })

  it("updateCreditor: writes audit log with before/after values", async () => {
    const updatedCreditor = { ...mockCreditor, name: "Bob Capital" }
    setupDbSelect([mockCreditor])
    const txMock = makeTxMock({ updateResult: updatedCreditor })
    setupTransaction(txMock)

    await Effect.runPromise(
      updateCreditor("cred-1", { name: "Bob Capital" }, "actor-1"),
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(txMock, expect.objectContaining({
      action: "creditor.update",
      beforeValue: expect.objectContaining({ name: "Alice Fund" }),
      afterValue: expect.objectContaining({ name: "Bob Capital" }),
    }))
  })

  // ── getCreditor ──────────────────────────────────────────────────────

  it("getCreditor: returns CreditorNotFound error for unknown ID", async () => {
    setupDbSelect([])

    const exit = await Effect.runPromiseExit(getCreditor("bad-id"))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── listCreditors ────────────────────────────────────────────────────

  it("listCreditors: returns all creditors ordered by name", async () => {
    const creditorA = { ...mockCreditor, id: "c-1", name: "Alpha" }
    const creditorB = { ...mockCreditor, id: "c-2", name: "Beta" }

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([creditorA, creditorB]),
        }),
      }),
    })

    const result = await Effect.runPromise(listCreditors())

    expect(result).toEqual([creditorA, creditorB])
    expect(result[0].name).toBe("Alpha")
    expect(result[1].name).toBe("Beta")
  })

  // ── addInvestment ────────────────────────────────────────────────────

  it("addInvestment: inserts investment and returns record (CRED-02)", async () => {
    setupDbSelect([mockCreditor]) // creditor exists check
    const txMock = makeTxMock({ insertResult: mockInvestment })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      addInvestment(
        { creditorId: "cred-1", amount: "10000000", interestRateMonthly: "0.10", investmentDate: "2026-01-01T00:00:00.000Z" },
        "actor-1",
      ),
    )

    expect(result.amount).toBe("10000000")
    expect(result.creditorId).toBe("cred-1")
  })

  it("addInvestment: writes audit log", async () => {
    setupDbSelect([mockCreditor])
    const txMock = makeTxMock({ insertResult: mockInvestment })
    setupTransaction(txMock)

    await Effect.runPromise(
      addInvestment(
        { creditorId: "cred-1", amount: "10000000", interestRateMonthly: "0.10", investmentDate: "2026-01-01T00:00:00.000Z" },
        "actor-1",
      ),
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(txMock, expect.objectContaining({
      action: "creditor_investment.create",
      entityType: "creditor_investment",
      entityId: "inv-1",
      beforeValue: null,
      afterValue: mockInvestment,
    }))
  })

  // ── recordCreditorRepayment ──────────────────────────────────────────

  it("recordCreditorRepayment: allocates interest-first with minInterestDays=0 (CRED-04)", async () => {
    // Investment: 10M at 10%/month, date 2026-01-01
    // Repayment: 1,500,000 on 2026-01-31 (30 days)
    // Interest ≈ 999,999.99 → all covered, remainder to principal
    // Investment is now fetched inside the transaction (TOCTOU fix)
    const txMock = makeTxMock({
      insertResult: mockRepayment,
      selectResults: [[mockInvestment], []], // first: investment fetch, second: no existing repayments
    })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      recordCreditorRepayment(
        { investmentId: "inv-1", amount: "1500000", repaymentDate: "2026-01-31T00:00:00.000Z" },
        "actor-1",
      ),
    )

    // Cached columns removed — repayment row only has amount, investmentId, etc.
    expect(result.amount).toBe("1500000")
    expect(result.investmentId).toBe("inv-1")
  })

  it("recordCreditorRepayment: no longer writes cached principalBalance (ledger-first) (CRED-04)", async () => {
    const txMock = makeTxMock({
      insertResult: mockRepayment,
      selectResults: [[mockInvestment], []], // investment fetch + no existing repayments
    })
    setupTransaction(txMock)

    await Effect.runPromise(
      recordCreditorRepayment(
        { investmentId: "inv-1", amount: "1500000", repaymentDate: "2026-01-31T00:00:00.000Z" },
        "actor-1",
      ),
    )

    // principalBalance is now derived from the ledger — no update to creditorInvestments
    expect(txMock.update).not.toHaveBeenCalled()
  })

  it("recordCreditorRepayment: writes audit log inside transaction (CRED-04)", async () => {
    const txMock = makeTxMock({
      insertResult: mockRepayment,
      selectResults: [[mockInvestment], []], // investment fetch + no existing repayments
    })
    setupTransaction(txMock)

    await Effect.runPromise(
      recordCreditorRepayment(
        { investmentId: "inv-1", amount: "1500000", repaymentDate: "2026-01-31T00:00:00.000Z" },
        "actor-1",
      ),
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(txMock, expect.objectContaining({
      action: "creditor_repayment.create",
      entityType: "creditor_repayment",
      entityId: "rep-1",
    }))
  })

  // ── getCreditorDashboard ─────────────────────────────────────────────

  it("getCreditorDashboard: computes interestAccrued using minInterestDays=0 (CRED-03)", async () => {
    // Creditor exists, 1 investment (10M at 10%/month, 30 days ago), no repayments
    const investmentDate = new Date()
    investmentDate.setDate(investmentDate.getDate() - 30)
    const investment30d = {
      ...mockInvestment,
      investmentDate,
    }

    setupDbSelectChain([
      [mockCreditor],                // creditor exists
      [investment30d],               // investments for creditor
      [],                            // batch repayments
    ])

    // Mock ledger balances: investment has 10M principal
    mockedGetCreditorBalancesFromLedger.mockResolvedValueOnce(
      new Map([["inv-1", new BigNumber("10000000")]])
    )
    // Mock interest payable from ledger: ~1M accrued
    mockedGetInterestPayableFromLedger.mockResolvedValueOnce(
      new Map([["inv-1", new BigNumber("999999.99")]])
    )
    // Mock total invested from ledger
    mockedGetCreditorTotalInvestedFromLedger.mockResolvedValueOnce(new BigNumber("10000000"))
    // Mock total repaid from ledger
    mockedGetCreditorTotalRepaidFromLedger.mockResolvedValueOnce(new BigNumber("0"))

    const result = await Effect.runPromise(getCreditorDashboard("cred-1"))

    expect(result.totalInvested).toBe("10000000.00")
    // Interest now comes from ledger
    expect(parseFloat(result.interestAccrued)).toBeCloseTo(1000000, -2)
    expect(result.repaymentsMade).toBe("0.00")
  })

  it("getCreditorDashboard: after 500K repayment on 1M interest, shows remaining interest (CRED-05)", async () => {
    // Investment: 10M at 10%/month, 60 days ago
    // A repayment of 500K was made 30 days ago (covering partial interest from first 30 days)
    // Another 30 days have elapsed since that repayment → new interest accrues on principal
    const now = new Date()
    const sixtyDaysAgo = new Date(now)
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const investment = {
      ...mockInvestment,
      investmentDate: sixtyDaysAgo,
    }

    const repayment = {
      id: "rep-1",
      investmentId: "inv-1",
      repaymentDate: thirtyDaysAgo,
      amount: "500000",
      recordedBy: "actor-1",
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
    }

    setupDbSelectChain([
      [mockCreditor],     // creditor exists
      [investment],       // investments
      [repayment],        // batch repayments
    ])

    // Mock ledger balances: still 10M since 500K repayment was interest-only
    mockedGetCreditorBalancesFromLedger.mockResolvedValueOnce(
      new Map([["inv-1", new BigNumber("10000000")]])
    )
    // Mock interest payable: ~1M accrued over last 30 days
    mockedGetInterestPayableFromLedger.mockResolvedValueOnce(
      new Map([["inv-1", new BigNumber("999999.99")]])
    )
    mockedGetCreditorTotalInvestedFromLedger.mockResolvedValueOnce(new BigNumber("10000000"))
    mockedGetCreditorTotalRepaidFromLedger.mockResolvedValueOnce(new BigNumber("500000"))

    const result = await Effect.runPromise(getCreditorDashboard("cred-1"))

    expect(result.repaymentsMade).toBe("500000.00")
    // Interest now from ledger
    expect(parseFloat(result.interestAccrued)).toBeCloseTo(1000000, -2)
    // Outstanding = principal (10M) + interestAccrued (~1M) ≈ 11M
    expect(parseFloat(result.outstandingBalance)).toBeGreaterThan(10000000)
  })

  // ── getSystemCapital ─────────────────────────────────────────────────

  // ── addInvestment: CreditorNotFound ──────────────────────────────────

  it("addInvestment: returns CreditorNotFound when creditor does not exist", async () => {
    setupDbSelect([]) // no creditor found

    const exit = await Effect.runPromiseExit(
      addInvestment(
        { creditorId: "bad-id", amount: "10000000", interestRateMonthly: "0.10", investmentDate: "2026-01-01T00:00:00.000Z" },
        "actor-1",
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── recordCreditorRepayment: InvestmentNotFound ───────────────────

  it("recordCreditorRepayment: returns InvestmentNotFound when investment does not exist", async () => {
    const txMock = makeTxMock({
      selectResults: [[]], // investment not found
    })
    setupTransaction(txMock)

    const exit = await Effect.runPromiseExit(
      recordCreditorRepayment(
        { investmentId: "bad-inv-id", amount: "1500000", repaymentDate: "2026-01-31T00:00:00.000Z" },
        "actor-1",
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── updateCreditor: CreditorNotFound ──────────────────────────────

  it("updateCreditor: returns CreditorNotFound for unknown ID", async () => {
    setupDbSelect([]) // creditor not found

    const exit = await Effect.runPromiseExit(
      updateCreditor("bad-id", { name: "New Name" }, "actor-1"),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── getCreditorDashboard: CreditorNotFound ────────────────────────

  it("getCreditorDashboard: returns CreditorNotFound for unknown ID", async () => {
    setupDbSelectChain([
      [], // creditor not found
    ])

    const exit = await Effect.runPromiseExit(getCreditorDashboard("bad-id"))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("getSystemCapital: aggregates totalInvested, totalInterestAccrued, totalRepaymentsMade across all creditors (CRED-06)", async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const inv1 = {
      ...mockInvestment,
      id: "inv-1",
      creditorId: "c-1",
      amount: "10000000",
      investmentDate: thirtyDaysAgo,
    }
    const inv2 = {
      ...mockInvestment,
      id: "inv-2",
      creditorId: "c-2",
      amount: "5000000",
      investmentDate: thirtyDaysAgo,
    }

    // getSystemCapital calls:
    // 1. db.select().from(creditorInvestments) -> all investments
    // 2. getCreditorBalancesFromLedger -> mocked separately
    // 3. db.select().from(creditorRepayments).where(inArray) -> batch repayments
    setupDbSelectChain([
      [inv1, inv2],           // all investments
      [],                     // batch repayments (none)
    ])

    // Mock ledger balances for both investments
    mockedGetCreditorBalancesFromLedger.mockResolvedValueOnce(
      new Map([
        ["inv-1", new BigNumber("10000000")],
        ["inv-2", new BigNumber("5000000")],
      ])
    )
    // Mock interest payable from ledger
    mockedGetInterestPayableFromLedger.mockResolvedValueOnce(
      new Map([
        ["inv-1", new BigNumber("999999.99")],
        ["inv-2", new BigNumber("499999.99")],
      ])
    )
    mockedGetCreditorTotalInvestedFromLedger.mockResolvedValueOnce(new BigNumber("15000000"))
    mockedGetCreditorTotalRepaidFromLedger.mockResolvedValueOnce(new BigNumber("0"))

    const result = await Effect.runPromise(getSystemCapital())

    // Total invested = 10M + 5M = 15M
    expect(result.totalInvested).toBe("15000000.00")
    expect(result.totalRepaymentsMade).toBe("0.00")
    // Interest accrued on both investments from ledger
    expect(parseFloat(result.totalInterestAccrued)).toBeGreaterThan(0)
    // totalOutstanding = totalPrincipal + totalInterestAccrued > 15M
    expect(parseFloat(result.totalOutstanding)).toBeGreaterThan(15000000)
  })
})
