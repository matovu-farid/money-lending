import { describe, it, expect, vi, beforeEach } from "vitest"
import BigNumber from "bignumber.js"
import { PgDialect } from "drizzle-orm/pg-core"

const mockFindMany = vi.fn()
const mockSelect = vi.fn()
const mockGetRemainingPrincipalFromLedger = vi.fn()
const mockGetLoanBalancesFromLedger = vi.fn()
const mockGetInterestEarnedFromLedger = vi.fn()
const mockGetPaymentPortionsFromLedger = vi.fn()
const mockGetWaiverPortionsFromLedger = vi.fn()
const mockGetRolloverInterestSettledFromLedger = vi.fn()
const mockGetLastSettlementEventsForLoans = vi.fn()
const mockComputeLoanOverdueInfo = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      loans: {
        findMany: mockFindMany,
      },
    },
    select: mockSelect,
  },
}))

vi.mock("@/lib/db/schema", () => ({
  loans: { id: "id", deletedAt: "deletedAt", createdAt: "createdAt" },
  payments: {
    loanId: "loanId",
    deletedAt: "deletedAt",
    markedWrong: "markedWrong",
    paymentDate: "paymentDate",
    createdAt: "createdAt",
  },
  loanWaivers: {
    loanId: "loanId",
    deletedAt: "deletedAt",
    waiverDate: "waiverDate",
  },
  auditLog: {
    entityId: "entityId",
    entityType: "entityType",
    action: "action",
    afterValue: "afterValue",
  },
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getRemainingPrincipalFromLedger: mockGetRemainingPrincipalFromLedger,
  getLoanBalancesFromLedger: mockGetLoanBalancesFromLedger,
  getInterestEarnedFromLedger: mockGetInterestEarnedFromLedger,
  getPaymentPortionsFromLedger: mockGetPaymentPortionsFromLedger,
  getRolloverInterestSettledFromLedger:
    mockGetRolloverInterestSettledFromLedger,
  getWaiverPortionsFromLedger: mockGetWaiverPortionsFromLedger,
}))

vi.mock("@/services/settlement.service", () => ({
  getLastSettlementEventsForLoans: mockGetLastSettlementEventsForLoans,
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: mockComputeLoanOverdueInfo,
}))

describe("loanBalanceData", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const loanRow = {
      id: "loan-1",
      status: "active",
      principalAmount: "1000000",
      interestRate: "0.10",
      interestRateOverride: null,
      loanType: "perpetual",
      termMonths: null,
      penaltyWaived: false,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    }

    const paymentQuery = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            { id: "payment-1", loanId: "loan-1" },
            { id: "payment-2", loanId: "loan-1" },
          ]),
        }),
      }),
    }
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([loanRow]),
        }),
      })
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValue(paymentQuery)

    mockGetRemainingPrincipalFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("650000")]]),
    )
    mockGetLoanBalancesFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("1200000")]]),
    )
    mockGetInterestEarnedFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("150000")]]),
    )
    mockGetPaymentPortionsFromLedger.mockResolvedValue(new Map())
    mockGetRolloverInterestSettledFromLedger.mockResolvedValue(new Map())
    mockGetWaiverPortionsFromLedger.mockResolvedValue(new Map())
    mockGetLastSettlementEventsForLoans.mockResolvedValue(
      new Map([
        [
          "loan-1",
          {
            kind: "payment",
            date: new Date("2026-02-01T00:00:00.000Z"),
          },
        ],
      ]),
    )
    mockComputeLoanOverdueInfo.mockReturnValue({
      daysOverdue: 12,
      dailyRate: "4000",
      unpaidInterest: "30000",
      penaltyActive: false,
      effectiveRate: "0.10",
    })
  })

  it("computeSingleLoanBalanceData returns ledger-backed balance and overdue data", async () => {
    const { computeSingleLoanBalanceData } = await import("../loanBalanceData")

    const asOf = new Date("2026-03-01T00:00:00.000Z")
    const result = await computeSingleLoanBalanceData("loan-1", asOf)

    expect(result.loanId).toBe("loan-1")
    expect(result.totalBalanceOwed).toBe("1200000")
    expect(result.remainingPrincipalAmount).toBe("650000.00")
    expect(result.lastPaymentDate.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    )
    expect(result.daysOverdue).toBe(12)
    expect(result.unpaidInterest).toBe("30000")
    expect(mockGetRemainingPrincipalFromLedger).toHaveBeenCalledWith(
      ["loan-1"],
      asOf,
      expect.anything(),
    )
    expect(mockGetLoanBalancesFromLedger).toHaveBeenCalledWith(
      ["loan-1"],
      asOf,
      expect.anything(),
    )
    expect(mockGetInterestEarnedFromLedger).toHaveBeenCalledWith(
      ["loan-1"],
      asOf,
      expect.anything(),
    )
    expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        principalAmount: "1000000",
        baseRate: "0.10",
        totalInterestPaid: "150000.00",
        paymentCount: 2,
        totalBalanceOwed: "1200000",
        penaltyWaived: false,
        lastPaymentDate: new Date("2026-02-01T00:00:00.000Z"),
        asOf,
      }),
    )
  })

  it("excludes capitalized rollover interest from interest settled on the successor", async () => {
    const { computeSingleLoanBalanceData } = await import("../loanBalanceData")
    const asOf = new Date("2026-01-09T00:00:00.000Z")
    mockGetInterestEarnedFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("308500")]]),
    )
    mockGetRolloverInterestSettledFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("308500")]]),
    )

    await computeSingleLoanBalanceData("loan-1", asOf)

    expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
      expect.objectContaining({ totalInterestPaid: "0.00" }),
    )
  })

  it("passes cumulative accrued interest into overdue calculation instead of only the latest-payment period", async () => {
    mockSelect.mockReset()

    const loanRow = {
      id: "loan-production-repro",
      status: "active",
      principalAmount: "6000000.00",
      interestRate: "0.1000",
      interestRateOverride: null,
      penaltyMultiplier: "0.1000",
      penaltyWaived: false,
      penaltyWaivedAt: null,
      penaltyWaivedBy: null,
      minInterestDays: 30,
      issuanceFee: "50000.00",
      loanType: "perpetual",
      termMonths: null,
      startDate: new Date("2025-01-22T00:00:00.000Z"),
      createdAt: new Date("2026-08-03T14:52:46.486Z"),
    }
    const payments = [
      ["p1", "2025-02-28", "600000", "600000", "0"],
      ["p2", "2025-03-29", "600000", "580000", "20000"],
      ["p3", "2025-04-17", "600000", "378733", "221267"],
      ["p4", "2025-07-05", "600000", "600000", "0"],
      ["p5", "2025-09-30", "500000", "500000", "0"],
      ["p6", "2025-10-23", "500000", "500000", "0"],
      ["p7", "2026-02-20", "500000", "500000", "0"],
      ["p8", "2026-03-06", "500000", "268740.87", "231259.13"],
      ["p9", "2026-04-20", "500000", "500000", "0"],
      ["p10", "2026-05-08", "500000", "331648", "168352"],
      ["p11", "2026-05-24", "400000", "285819.83", "114180.17"],
      ["p12", "2026-05-30", "500000", "104898.83", "395101.17"],
    ].map(([id, date, amount, interest, principal]) => ({
      id,
      loanId: loanRow.id,
      paymentDate: new Date(`${date}T12:00:00.000Z`),
      amount: `${amount}.00`,
      createdAt: new Date(`${date}T12:00:00.000Z`),
      interest,
      principal,
    }))

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([loanRow]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(payments),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
    mockGetRemainingPrincipalFromLedger.mockResolvedValue(
      new Map([[loanRow.id, new BigNumber("4849841")]]),
    )
    mockGetLoanBalancesFromLedger.mockResolvedValue(
      new Map([[loanRow.id, new BigNumber("4849841")]]),
    )
    mockGetInterestEarnedFromLedger.mockResolvedValue(
      new Map([[loanRow.id, new BigNumber("5149840.83")]]),
    )
    mockGetPaymentPortionsFromLedger.mockResolvedValue(
      new Map(
        payments.map((payment) => [
          payment.id,
          {
            interestPortion: payment.interest,
            principalPortion: payment.principal,
          },
        ]),
      ),
    )
    mockGetWaiverPortionsFromLedger.mockResolvedValue(new Map())
    mockGetLastSettlementEventsForLoans.mockResolvedValue(
      new Map([[loanRow.id, { kind: "payment", date: payments[11].paymentDate }]]),
    )

    const { computeSingleLoanBalanceData } = await import("../loanBalanceData")
    const asOf = new Date("2026-08-03T12:00:00.000Z")
    await computeSingleLoanBalanceData(loanRow.id, asOf)

    expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        // Use the sum of payment allocations, not Interest Earned revenue.
        totalInterestPaid: "5149840.53",
        // Principal reductions take effect after interest through each payment date.
        totalInterestAccrued: "11279771",
      }),
    )
  })

  it.each(["fixed_rate", "reducing_balance"] as const)(
    "uses the statement's penalty-aware accrued interest for corrected %s loans",
    async (loanType) => {
      mockSelect.mockReset()
      let auditWhereParams: unknown[] = []
      const loanRow = {
        id: "loan-1",
        status: "active",
        principalAmount: "1000000.00",
        interestRate: "0.1000",
        interestRateOverride: "0.0800",
        penaltyMultiplier: "0.1000",
        penaltyWaived: false,
        penaltyWaivedAt: null,
        penaltyWaivedBy: null,
        minInterestDays: 30,
        minPeriodOverride: null,
        rolledOverFrom: null,
        issuanceFee: "0.00",
        loanType,
        termMonths: 6,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }
      mockSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([loanRow]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((condition) => {
              auditWhereParams = new PgDialect().sqlToQuery(condition).params
              return Promise.resolve([{
                entityId: loanRow.id,
                action: "historical_rate_corrected_by_agent",
                afterValue: JSON.stringify({ rateSemantics: "correction", effectiveFrom: loanRow.startDate.toISOString() }),
              }])
            }),
          }),
        })
      mockGetLastSettlementEventsForLoans.mockResolvedValue(new Map())
      mockGetPaymentPortionsFromLedger.mockResolvedValue(new Map())
      mockGetWaiverPortionsFromLedger.mockResolvedValue(new Map())
      const asOf = new Date("2026-04-15T00:00:00.000Z")
      const { buildLoanStatement } = await import("@/lib/loan-statement")
      const statement = buildLoanStatement({ loan: loanRow, payments: [], today: asOf })
      const { computeSingleLoanBalanceData } = await import("../loanBalanceData")

      await computeSingleLoanBalanceData(loanRow.id, asOf)

      expect(auditWhereParams).toContain("historical_rate_corrected_by_agent")
      expect(statement.finalState.penaltyActive).toBe(true)
      expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          loanType,
          totalInterestAccrued: statement.finalState.cumulativeInterestAccrued,
        }),
      )
    },
  )

  it.each([
    { description: "without a correction marker", afterValue: { interestRateOverride: "0.0800" } },
    { description: "with a correction marker after loan start", afterValue: {
      interestRateOverride: "0.0800", rateSemantics: "correction", effectiveFrom: "2026-02-01T00:00:00.000Z",
    } },
  ])("preserves the legacy fixed-loan balance calculation $description", async ({ afterValue }) => {
    mockSelect.mockReset()
    const loanRow = {
      id: "loan-1", status: "active", principalAmount: "1000000.00",
      interestRate: "0.1000", interestRateOverride: "0.0800",
      penaltyMultiplier: "0.1000", penaltyWaived: false,
      loanType: "fixed_rate", termMonths: 6,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }
    mockSelect
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([loanRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{
        entityId: loanRow.id,
        afterValue: JSON.stringify(afterValue),
      }]) }) })
    const { computeSingleLoanBalanceData } = await import("../loanBalanceData")
    await computeSingleLoanBalanceData(loanRow.id, new Date("2026-04-15T00:00:00.000Z"))
    expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
      expect.objectContaining({ totalInterestAccrued: undefined }),
    )
  })
})
