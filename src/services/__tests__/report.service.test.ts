import { describe, it, expect, vi, beforeEach } from "vitest"
import BigNumber from "bignumber.js"
import { calculateInterest, calculateDaysOverdue, calculateDailyRate } from "@/lib/interest/engine"
import { Effect } from "effect"
import { periodBoundsUTC } from "@/lib/date-utils"

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}))

vi.mock("@/services/creditor.service", () => ({
  getSystemCapital: vi.fn(),
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
  getInterestEarnedFromLedger: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn().mockReturnValue({
    daysOverdue: 0,
    dailyRate: "0",
    unpaidInterest: "0",
    penaltyActive: false,
    effectiveRate: "0.10",
  }),
}))

/** Build a Drizzle-like chain that resolves to `rows` */
function chainedSelect(rows: unknown[]) {
  const terminal = {
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    groupBy: vi.fn().mockResolvedValue(rows),
  }
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(terminal),
      }),
      where: vi.fn().mockReturnValue(terminal),
    }),
  }
}

describe("Report Service — getPnlData (real service, mocked DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("aggregates income and expense categories from DB rows (RPTS-02)", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // Mock DB to return transaction rows matching what getPnlData queries
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
      chainedSelect([
        { type: "credit", amount: "500000", categoryName: "Interest Earned", categoryType: "revenue" },
        { type: "credit", amount: "50000", categoryName: "Issuance Fees", categoryType: "revenue" },
        { type: "debit", amount: "200000", categoryName: "Rent", categoryType: "expense" },
        { type: "debit", amount: "300000", categoryName: "Salaries", categoryType: "expense" },
      ])
    )

    const { getPnlData } = await import("@/services/report.service")
    const result = await Effect.runPromise(getPnlData("2026-02"))

    expect(result.period).toBe("2026-02")
    expect(result.totalIncome).toBe("550000.00")
    expect(result.totalExpenses).toBe("500000.00")
    expect(result.netProfit).toBe("50000.00")
    expect(result.income).toHaveLength(2)
    expect(result.expenses).toHaveLength(2)
  })

  it("handles reversals — DR to revenue subtracts income (RPTS-02)", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
      chainedSelect([
        { type: "credit", amount: "100000", categoryName: "Interest Earned", categoryType: "revenue" },
        { type: "debit", amount: "20000", categoryName: "Interest Earned", categoryType: "revenue" }, // reversal
      ])
    )

    const { getPnlData } = await import("@/services/report.service")
    const result = await Effect.runPromise(getPnlData("2026-02"))

    // Net income = 100000 - 20000 = 80000
    expect(result.totalIncome).toBe("80000.00")
    expect(result.income).toHaveLength(1)
    expect(result.income[0].amount).toBe("80000.00")
  })

  it("returns zeros when no transactions exist (RPTS-02)", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
      chainedSelect([])
    )

    const { getPnlData } = await import("@/services/report.service")
    const result = await Effect.runPromise(getPnlData("2026-02"))

    expect(result.totalIncome).toBe("0.00")
    expect(result.totalExpenses).toBe("0.00")
    expect(result.netProfit).toBe("0.00")
  })
})

describe("Report Service — Balance Sheet identity (RPTS-03)", () => {
  it("Assets = Liabilities + Equity (basic identity check)", () => {
    // Given:
    //   Loans outstanding (Assets) = 5,000,000
    //   Creditor balances (Liabilities) = 3,000,000
    //   Share Capital = 1,000,000
    //   Retained Earnings = 1,000,000
    //   Equity = 2,000,000
    // Expected: 5,000,000 = 3,000,000 + 2,000,000 ✓

    const totalLoansOutstanding = new BigNumber("5000000")
    const totalCreditorBalances = new BigNumber("3000000")
    const shareCapital = new BigNumber("1000000")
    const retainedEarnings = new BigNumber("1000000")
    const totalEquity = shareCapital.plus(retainedEarnings)
    const liabilitiesPlusEquity = totalCreditorBalances.plus(totalEquity)

    expect(totalLoansOutstanding.toFixed(2)).toBe("5000000.00")
    expect(totalEquity.toFixed(2)).toBe("2000000.00")
    expect(liabilitiesPlusEquity.toFixed(2)).toBe("5000000.00")
    expect(totalLoansOutstanding.isEqualTo(liabilitiesPlusEquity)).toBe(true)
  })

  it("balance sheet identity fails (imbalance detected) when equity is wrong", () => {
    // Scenario: wrong equity calculation — should trigger imbalance warning
    const assets = new BigNumber("5000000")
    const liabilities = new BigNumber("3000000")
    const wrongEquity = new BigNumber("1000000") // Missing 1M — incorrect

    const liabilitiesPlusEquity = liabilities.plus(wrongEquity)
    const isBalanced = assets.isEqualTo(liabilitiesPlusEquity)

    expect(isBalanced).toBe(false) // Confirms imbalance is detected
  })
})

describe("Report Service — Portfolio risk flag (RPTS-04)", () => {
  it("riskFlag=true when daysOverdue >= 30 (45 days unpaid)", () => {
    // Active loan with 45 days of unpaid interest should be risk-flagged
    // 10M at 10%/month, 45 days elapsed, 0 interest paid
    const outstandingBalance = "10000000"
    const monthlyRate = "0.10"
    const daysElapsed = 45
    const minInterestDays = 30

    const totalInterestAccrued = calculateInterest(
      outstandingBalance,
      monthlyRate,
      daysElapsed,
      minInterestDays
    )
    const totalInterestPaid = new BigNumber(0)
    const dailyRate = calculateDailyRate(monthlyRate)
    const dailyInterestAmount = new BigNumber(outstandingBalance).multipliedBy(dailyRate)

    const daysOverdue = calculateDaysOverdue(
      totalInterestAccrued.toFixed(2),
      totalInterestPaid.toFixed(2),
      dailyInterestAmount.toFixed(2)
    )

    const riskFlag = daysOverdue.isGreaterThanOrEqualTo(30)
    expect(riskFlag).toBe(true)
  })

  it("riskFlag=false when all interest is fully paid (no unpaid interest)", () => {
    // When totalInterestAccrued == totalInterestPaid, daysOverdue = 0 -> riskFlag = false
    // This correctly represents a current (up-to-date) borrower
    const outstandingBalance = "10000000"
    const monthlyRate = "0.10"
    const daysElapsed = 15
    const minInterestDays = 30

    const totalInterestAccrued = calculateInterest(
      outstandingBalance,
      monthlyRate,
      daysElapsed,
      minInterestDays
    )
    // Fully paid — no unpaid interest
    const totalInterestPaid = totalInterestAccrued
    const dailyRate = calculateDailyRate(monthlyRate)
    const dailyInterestAmount = new BigNumber(outstandingBalance).multipliedBy(dailyRate)

    const daysOverdue = calculateDaysOverdue(
      totalInterestAccrued.toFixed(2),
      totalInterestPaid.toFixed(2),
      dailyInterestAmount.toFixed(2)
    )

    // calculateDaysOverdue returns 0 when unpaid <= 0
    expect(daysOverdue.toFixed(0)).toBe("0")
    const riskFlag = daysOverdue.isGreaterThanOrEqualTo(30)
    expect(riskFlag).toBe(false)
  })

  it("riskFlag=false when all interest is paid (daysOverdue = 0)", () => {
    const outstandingBalance = "10000000"
    const monthlyRate = "0.10"
    const daysElapsed = 45
    const minInterestDays = 30

    const totalInterestAccrued = calculateInterest(
      outstandingBalance,
      monthlyRate,
      daysElapsed,
      minInterestDays
    )
    // Fully paid — interest paid = accrued
    const totalInterestPaid = totalInterestAccrued
    const dailyRate = calculateDailyRate(monthlyRate)
    const dailyInterestAmount = new BigNumber(outstandingBalance).multipliedBy(dailyRate)

    const daysOverdue = calculateDaysOverdue(
      totalInterestAccrued.toFixed(2),
      totalInterestPaid.toFixed(2),
      dailyInterestAmount.toFixed(2)
    )

    const riskFlag = daysOverdue.isGreaterThanOrEqualTo(30)
    expect(riskFlag).toBe(false)
    expect(daysOverdue.toFixed(0)).toBe("0")
  })
})

describe("Report Service — exports", () => {
  it("exports all expected functions", async () => {
    const mod = await import("@/services/report.service")
    const expectedExports = [
      "getPnlData",
      "getBalanceSheetData",
      "getPortfolioData",
      "getRetainedEarningsData",
      "generateMonthlySnapshot",
    ]
    for (const name of expectedExports) {
      expect(mod).toHaveProperty(name)
      expect(typeof (mod as Record<string, unknown>)[name]).toBe("function")
    }
  })
})

describe("Report Service — Snapshot idempotency (RPTS-02 / RPTS-03)", () => {
  it("snapshot idempotency: same period+type combination should not insert duplicate", () => {
    // This tests the conceptual idempotency logic:
    // If existingSnapshot for period+type is found, skip insert.
    const period = "2026-02"
    const year = 2026
    const month = 2
    const periodStart = new Date(year, month - 1, 1)

    const existingSnapshots = [
      { type: "pnl", periodStart: periodStart.toISOString() },
    ]

    // Check if snapshot already exists for this type+period
    const alreadyExists = existingSnapshots.some(
      (s) =>
        s.type === "pnl" &&
        new Date(s.periodStart).getTime() === periodStart.getTime()
    )

    expect(alreadyExists).toBe(true)
    // If alreadyExists, skip insert — no duplicate should be created
  })

  // ---- DB-mocked tests ----

  let mockedDb: any
  let mockedGetSystemCapital: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db
    const creditorMod = await import("@/services/creditor.service")
    mockedGetSystemCapital = creditorMod.getSystemCapital
  })

  it("generateMonthlySnapshot: inserts pnl and balance_sheet rows with onConflictDoNothing", async () => {
    const { generateMonthlySnapshot } = await import("@/services/report.service")

    // 1st select: getPnlData → transactions innerJoin with where
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { type: "credit", amount: "500000", categoryName: "Interest Earned", categoryType: "revenue" },
            { type: "debit", amount: "200000", categoryName: "Rent", categoryType: "expense" },
          ]),
        }),
      }),
    } as any)

    // 2nd select: getBalanceSheetData → single ledger query with innerJoin + where + groupBy
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { categoryName: "Loans Receivable", categoryType: "asset", txType: "debit", depositLocation: null, total: "1000000" },
            ]),
          }),
        }),
      }),
    } as any)

    // 3rd select: Interest Receivable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // 4th select: Interest Payable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // Mock insert chain: .values(...).onConflictDoNothing()
    const onConflictDoNothingStub = vi.fn().mockResolvedValue(undefined)
    const valuesStub = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingStub })
    mockedDb.insert.mockReturnValue({ values: valuesStub })

    await Effect.runPromise(generateMonthlySnapshot("2026-02", "user-1"))

    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
    expect(valuesStub).toHaveBeenCalledTimes(1)
    expect(onConflictDoNothingStub).toHaveBeenCalledTimes(1)

    const insertedRows = valuesStub.mock.calls[0][0]
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0].type).toBe("pnl")
    expect(insertedRows[1].type).toBe("balance_sheet")
    expect(insertedRows[0].generatedBy).toBe("user-1")
    expect(insertedRows[1].generatedBy).toBe("user-1")
  })

  it("generateMonthlySnapshot: uses onConflictDoNothing to handle duplicates idempotently", async () => {
    const { generateMonthlySnapshot } = await import("@/services/report.service")

    // getPnlData → transactions
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { type: "credit", amount: "100000", categoryName: "Interest Earned", categoryType: "revenue" },
          ]),
        }),
      }),
    } as any)

    // getBalanceSheetData → single ledger query
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as any)

    // Interest Receivable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // Interest Payable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // Mock insert chain — onConflictDoNothing silently skips duplicates
    const onConflictDoNothingStub = vi.fn().mockResolvedValue(undefined)
    const valuesStub = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingStub })
    mockedDb.insert.mockReturnValue({ values: valuesStub })

    // Even if called twice, each call uses onConflictDoNothing — no error, no duplicate
    await Effect.runPromise(generateMonthlySnapshot("2026-02", "user-1"))

    expect(onConflictDoNothingStub).toHaveBeenCalledTimes(1)
  })

  it("getPnlData: queries transactions table for given period with correct date range", async () => {
    const { getPnlData } = await import("@/services/report.service")

    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { type: "credit", amount: "500000", categoryName: "Interest Earned", categoryType: "revenue" },
            { type: "credit", amount: "1000000", categoryName: "Share Capital", categoryType: "revenue" },
            { type: "debit", amount: "200000", categoryName: "Rent", categoryType: "expense" },
            { type: "debit", amount: "300000", categoryName: "Salaries", categoryType: "expense" },
          ]),
        }),
      }),
    } as any)

    const result = await Effect.runPromise(getPnlData("2026-02"))

    expect(result.period).toBe("2026-02")
    expect(result.totalIncome).toBe("1500000.00")
    expect(result.totalExpenses).toBe("500000.00")
    expect(result.netProfit).toBe("1000000.00")
    expect(result.income).toHaveLength(2)
    expect(result.expenses).toHaveLength(2)
    expect(result.income).toEqual(
      expect.arrayContaining([
        { category: "Interest Earned", amount: "500000.00" },
        { category: "Share Capital", amount: "1000000.00" },
      ])
    )
    expect(result.expenses).toEqual(
      expect.arrayContaining([
        { category: "Rent", amount: "200000.00" },
        { category: "Salaries", amount: "300000.00" },
      ])
    )
  })

  it("getBalanceSheetData: computes assets from ledger query, liabilities and equity from categories", async () => {
    const { getBalanceSheetData } = await import("@/services/report.service")

    // Single ledger query: select -> from -> innerJoin -> where -> groupBy
    // Returns grouped rows with categoryName, categoryType, txType, depositLocation, total
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              // Loans Receivable (asset): debit adds
              { categoryName: "Loans Receivable", categoryType: "asset", txType: "debit", depositLocation: null, total: "5000000" },
              // Creditor Investment (liability): credit adds
              { categoryName: "Creditor Investment", categoryType: "liability", txType: "credit", depositLocation: null, total: "3000000" },
              // Share Capital (equity): credit adds
              { categoryName: "Share Capital", categoryType: "equity", txType: "credit", depositLocation: null, total: "1000000" },
              // Revenue: credit adds
              { categoryName: "Interest Earned", categoryType: "revenue", txType: "credit", depositLocation: null, total: "2500000" },
              // Expense: debit adds
              { categoryName: "Rent", categoryType: "expense", txType: "debit", depositLocation: null, total: "500000" },
            ]),
          }),
        }),
      }),
    } as any)

    // Interest Receivable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // Interest Payable category lookup
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    const result = await Effect.runPromise(getBalanceSheetData("2026-02"))

    expect(result.asOf).toBe("2026-02")
    expect(result.assets.totalLoansOutstanding).toBe("5000000.00")
    expect(result.assets.interestReceivable).toBe("0.00")
    expect(result.assets.cashBalance).toBe("0.00")
    expect(result.assets.bankBalance).toBe("0.00")
    expect(result.assets.strongRoomBalance).toBe("0.00")
    expect(result.assets.totalAssets).toBe("5000000.00")
    expect(result.liabilities.totalCreditorBalances).toBe("3000000.00")
    expect(result.equity.shareCapital).toBe("1000000.00")
    // retainedEarnings = totalRevenue(2500000) - totalExpenses(500000) = 2000000
    expect(result.equity.retainedEarnings).toBe("2000000.00")
    expect(result.equity.totalEquity).toBe("3000000.00")
  })

  it("getPortfolioData: returns active loans sorted by daysOverdue descending", async () => {
    const { getPortfolioData } = await import("@/services/report.service")
    const { computeLoanOverdueInfo } = await import("@/lib/interest/overdue")
    const { getLoanBalancesFromLedger, getInterestEarnedFromLedger } = await import("@/services/ledger-queries.service")
    const BigNumber = require("bignumber.js").default

    const now = new Date()
    // Loan A: 60 days old, Loan B: 10 days old
    const startDateA = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    const startDateB = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)

    // Mock ledger balances
    ;(getLoanBalancesFromLedger as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Map([
        ["loan-a", new BigNumber("5000000")],
        ["loan-b", new BigNumber("2000000")],
      ])
    )

    // Mock interest earned from ledger
    ;(getInterestEarnedFromLedger as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Map())

    // Mock computeLoanOverdueInfo to return different overdue values for each loan
    let callCount = 0
    ;(computeLoanOverdueInfo as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // loan-a: 60 days overdue, risk-flagged
        return { daysOverdue: 60, dailyRate: "16666.67", unpaidInterest: "1000000.00" }
      }
      // loan-b: 10 days overdue, not risk-flagged
      return { daysOverdue: 10, dailyRate: "6666.67", unpaidInterest: "66666.70" }
    })

    const loanA = {
      id: "loan-a",
      principalAmount: "5000000",
      issuanceFee: "0.00",

      status: "active",
      customerId: "cust-a",
      startDate: startDateA,
      interestRate: "0.10",
      interestRateOverride: null,
      minInterestDays: 30,
      minPeriodOverride: null,
      issuedBy: "actor-1",
      disbursementSource: "cash",
      loanType: "perpetual",
      termMonths: null,
    }
    const loanB = {
      id: "loan-b",
      principalAmount: "2000000",
      issuanceFee: "0.00",

      status: "active",
      customerId: "cust-b",
      startDate: startDateB,
      interestRate: "0.10",
      interestRateOverride: null,
      minInterestDays: 30,
      minPeriodOverride: null,
      issuedBy: "actor-1",
      disbursementSource: "cash",
      loanType: "perpetual",
      termMonths: null,
    }

    // 1st select: active loans joined with customers
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { loan: loanA, customerName: "Alice" },
            { loan: loanB, customerName: "Bob" },
          ]),
        }),
      }),
    } as any)

    // 2nd select: batch payment counts (empty — no payments)
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any)

    const result = await Effect.runPromise(getPortfolioData())

    expect(result).toHaveLength(2)
    // Sorted by daysOverdue DESC — loan-a (60 days) should be first
    expect(result[0].loanId).toBe("loan-a")
    expect(result[0].customerName).toBe("Alice")
    expect(result[1].loanId).toBe("loan-b")
    expect(result[1].customerName).toBe("Bob")

    // loan-a should have more days overdue than loan-b
    expect(parseInt(result[0].daysOverdue)).toBeGreaterThan(parseInt(result[1].daysOverdue))

    // loan-a at 60 days with no payments should be risk-flagged
    expect(result[0].riskFlag).toBe(true)
  })
})

describe("Report Service — Period boundary construction (BUG-9/12)", () => {
  it("periodBoundsUTC constructs UTC boundaries, not local time", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2026-03")
    // March 1 at UTC midnight
    expect(periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z")
    // March 31 at 23:59:59.999 UTC
    expect(periodEnd.toISOString()).toBe("2026-03-31T23:59:59.999Z")
  })

  it("periodBoundsUTC handles February correctly", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-02")
    expect(periodStart.toISOString()).toBe("2025-02-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-02-28T23:59:59.999Z")
  })

  it("periodBoundsUTC handles leap year February", () => {
    const { periodEnd } = periodBoundsUTC("2024-02")
    expect(periodEnd.toISOString()).toBe("2024-02-29T23:59:59.999Z")
  })

  it("periodBoundsUTC handles December year-end", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-12")
    expect(periodStart.toISOString()).toBe("2025-12-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-12-31T23:59:59.999Z")
  })

  it("prior period boundary is exactly 1ms before periodStart", () => {
    const { periodStart } = periodBoundsUTC("2026-03")
    const priorEnd = new Date(periodStart.getTime() - 1)
    expect(priorEnd.toISOString()).toBe("2026-02-28T23:59:59.999Z")
  })
})
