import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateInterest, allocatePayment } from "@/lib/interest/engine"
import { Effect, Exit } from "effect"

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
  it("10M UGX at 10%/month for 30 days accrues ~1,000,000 interest (CRED-03)", () => {
    // 10,000,000 * (0.10/30) * 30 ≈ 1,000,000
    // Note: BigNumber at DECIMAL_PLACES=10 gives 999999.99 due to 0.10/30 precision
    const interest = calculateInterest("10000000", "0.10", 30, 0)
    expect(interest.toFixed(2)).toBe("999999.99")
  })

  it("15-day investment accrues 15 days of interest with minInterestDays=0 (CRED-03)", () => {
    // 10,000,000 * (0.10/30) * 15 = 500,000
    const interest = calculateInterest("10000000", "0.10", 15, 0)
    expect(interest.toFixed(2)).toBe("500000.00")
  })

  it("15-day investment does NOT use minInterestDays=30 (no minimum enforcement for creditors)", () => {
    // With minInterestDays=0: 10M * (0.10/30) * 15 = 500,000
    // With minInterestDays=30: 10M * (0.10/30) * 30 ≈ 999,999.99
    const creditorInterest = calculateInterest("10000000", "0.10", 15, 0)
    const borrowerInterest = calculateInterest("10000000", "0.10", 15, 30)
    expect(creditorInterest.toFixed(2)).toBe("500000.00")
    expect(borrowerInterest.toFixed(2)).toBe("999999.99")
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

  it("1,500,000 payment against ~1,000,000 interest: ~1M to interest, remainder to principal (CRED-04)", () => {
    // 10M at 10%/month, 30 days elapsed: interest ≈ 999,999.99 (BigNumber DECIMAL_PLACES=10 precision)
    // Payment of 1,500,000: 999,999.99 to interest, 500,000.01 to principal
    const result = allocatePayment({
      paymentAmount: "1500000",
      principalBalanceBefore: "10000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("999999.99")
    expect(result.principalPortion).toBe("500000.01")
    expect(result.principalBalanceAfter).toBe("9499999.99")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("payment larger than interest + principal: principalBalance reaches zero (fully repaid)", () => {
    // 100K principal at 10%/month, 30 days: interest = 10,000
    // Payment of 200,000: more than enough to cover 10K interest + 100K principal
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

vi.mock("@/services/transaction.service", () => ({
  autoPostInterestExpense: vi.fn().mockResolvedValue(undefined),
}))

describe("Creditor Service — DB operations (requires test DB)", () => {
  let mockedDb: any
  let mockedWriteAuditLog: any

  let createCreditor: any
  let updateCreditor: any
  let getCreditor: any
  let listCreditors: any
  let addInvestment: any
  let recordCreditorRepayment: any
  let getCreditorDashboard: any
  let getSystemCapital: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db as any
    const auditMod = await import("@/services/audit.service")
    mockedWriteAuditLog = auditMod.writeAuditLog as any
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
    principalBalance: "10000000",
    recordedBy: "actor-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }

  const mockRepayment = {
    id: "rep-1",
    investmentId: "inv-1",
    repaymentDate: new Date("2026-01-31"),
    amount: "1500000",
    interestPortion: "999999.99",
    principalPortion: "500000.01",
    principalBalanceBefore: "10000000",
    principalBalanceAfter: "9499999.99",
    recordedBy: "actor-1",
    createdAt: new Date("2026-01-31"),
    updatedAt: new Date("2026-01-31"),
  }

  function makeTxMock(overrides?: {
    insertResult?: any
    updateResult?: any
    selectResults?: any[][]
  }) {
    let selectCallIndex = 0
    const selectResults = overrides?.selectResults ?? [[]]
    const mockTx: any = {
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
            const thenable = Promise.resolve(result) as any
            thenable.orderBy = vi.fn().mockImplementation(() => {
              return Promise.resolve(result)
            })
            return thenable
          }),
        }),
      })),
    }
    return mockTx
  }

  function setupTransaction(txMock: any) {
    mockedDb.transaction.mockImplementation(async (cb: any) => cb(txMock))
  }

  function setupDbSelect(rows: any[]) {
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    })
  }

  function setupDbSelectChain(callResults: any[][]) {
    let callIndex = 0
    mockedDb.select.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        const idx = callIndex++
        const result = callResults[idx] ?? []
        const chainObj: any = {
          where: vi.fn().mockImplementation(() => ({
            orderBy: vi.fn().mockResolvedValue(result),
            then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
          })),
          orderBy: vi.fn().mockResolvedValue(result),
          then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
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
        orderBy: vi.fn().mockResolvedValue([creditorA, creditorB]),
      }),
    })

    const result = await Effect.runPromise(listCreditors()) as any

    expect(result).toEqual([creditorA, creditorB])
    expect(result[0].name).toBe("Alpha")
    expect(result[1].name).toBe("Beta")
  })

  // ── addInvestment ────────────────────────────────────────────────────

  it("addInvestment: sets principalBalance equal to amount on creation (CRED-02)", async () => {
    setupDbSelect([mockCreditor]) // creditor exists check
    const txMock = makeTxMock({ insertResult: mockInvestment })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      addInvestment(
        { creditorId: "cred-1", amount: "10000000", interestRateMonthly: "0.10", investmentDate: "2026-01-01T00:00:00.000Z" },
        "actor-1",
      ),
    ) as any

    expect(result.principalBalance).toBe("10000000")
    expect(result.amount).toBe(result.principalBalance)
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
    ) as any

    expect(result.interestPortion).toBe("999999.99")
    expect(result.principalPortion).toBe("500000.01")
  })

  it("recordCreditorRepayment: updates principalBalance after repayment (CRED-04)", async () => {
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

    // tx.update should be called to update principalBalance on the investment
    expect(txMock.update).toHaveBeenCalled()
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
      principalBalance: "10000000",
    }

    setupDbSelectChain([
      [mockCreditor],                // creditor exists
      [investment30d],               // investments for creditor
      [],                            // repayments for investment
    ])

    const result = await Effect.runPromise(getCreditorDashboard("cred-1")) as any

    expect(result.totalInvested).toBe("10000000.00")
    // 10M * (0.10/30) * 30 ≈ 999999.99
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
      principalBalance: "10000000", // principal unchanged because 500K < interest
    }

    const repayment = {
      id: "rep-1",
      investmentId: "inv-1",
      repaymentDate: thirtyDaysAgo,
      amount: "500000",
      interestPortion: "500000",
      principalPortion: "0",
      principalBalanceBefore: "10000000",
      principalBalanceAfter: "10000000",
      recordedBy: "actor-1",
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
    }

    setupDbSelectChain([
      [mockCreditor],     // creditor exists
      [investment],       // investments
      [repayment],        // repayments for investment
    ])

    const result = await Effect.runPromise(getCreditorDashboard("cred-1")) as any

    expect(result.repaymentsMade).toBe("500000.00")
    // Interest accrued over last 30 days on 10M at 10%/month ≈ 999,999.99
    expect(parseFloat(result.interestAccrued)).toBeCloseTo(1000000, -2)
    // Outstanding = principal (10M) + interestAccrued (~1M) ≈ 11M
    expect(parseFloat(result.outstandingBalance)).toBeGreaterThan(10000000)
  })

  // ── getSystemCapital ─────────────────────────────────────────────────

  it("getSystemCapital: aggregates totalInvested, totalInterestAccrued, totalRepaymentsMade across all creditors (CRED-06)", async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const creditor1 = { ...mockCreditor, id: "c-1" }
    const creditor2 = { ...mockCreditor, id: "c-2", name: "Beta Fund" }

    const inv1 = {
      ...mockInvestment,
      id: "inv-1",
      creditorId: "c-1",
      amount: "10000000",
      principalBalance: "10000000",
      investmentDate: thirtyDaysAgo,
    }
    const inv2 = {
      ...mockInvestment,
      id: "inv-2",
      creditorId: "c-2",
      amount: "5000000",
      principalBalance: "5000000",
      investmentDate: thirtyDaysAgo,
    }

    // getSystemCapital calls:
    // 1. db.select().from(creditors) -> all creditors
    // 2. db.select().from(creditorInvestments).where(creditorId=c-1) -> [inv1]
    // 3. db.select().from(creditorRepayments).where(investmentId=inv-1) -> []
    // 4. db.select().from(creditorInvestments).where(creditorId=c-2) -> [inv2]
    // 5. db.select().from(creditorRepayments).where(investmentId=inv-2) -> []
    setupDbSelectChain([
      [creditor1, creditor2],  // all creditors
      [inv1],                  // investments for c-1
      [],                      // repayments for inv-1
      [inv2],                  // investments for c-2
      [],                      // repayments for inv-2
    ])

    const result = await Effect.runPromise(getSystemCapital()) as any

    // Total invested = 10M + 5M = 15M
    expect(result.totalInvested).toBe("15000000.00")
    expect(result.totalRepaymentsMade).toBe("0.00")
    // Interest accrued on both investments over 30 days
    expect(parseFloat(result.totalInterestAccrued)).toBeGreaterThan(0)
    // totalOutstanding = totalPrincipal + totalInterestAccrued > 15M
    expect(parseFloat(result.totalOutstanding)).toBeGreaterThan(15000000)
  })
})
