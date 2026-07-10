import { describe, it, expect, vi, beforeEach } from "vitest"
import BigNumber from "bignumber.js"

const mockFindMany = vi.fn()
const mockSelect = vi.fn()
const mockGetRemainingPrincipalFromLedger = vi.fn()
const mockGetLoanBalancesFromLedger = vi.fn()
const mockGetInterestEarnedFromLedger = vi.fn()
const mockGetLastPaymentDate = vi.fn()
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
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getRemainingPrincipalFromLedger: mockGetRemainingPrincipalFromLedger,
  getLoanBalancesFromLedger: mockGetLoanBalancesFromLedger,
  getInterestEarnedFromLedger: mockGetInterestEarnedFromLedger,
}))

vi.mock("@/services/payment.service", () => ({
  getLastPaymentDate: mockGetLastPaymentDate,
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: mockComputeLoanOverdueInfo,
}))

describe("loanBalanceData", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockFindMany.mockResolvedValue([
      {
        id: "loan-1",
        principalAmount: "1000000",
        interestRate: "0.10",
        interestRateOverride: null,
        loanType: "perpetual",
        termMonths: null,
        penaltyWaived: false,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    ])

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            { id: "payment-1" },
            { id: "payment-2" },
          ]),
        }),
      }),
    })

    mockGetRemainingPrincipalFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("650000")]]),
    )
    mockGetLoanBalancesFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("1200000")]]),
    )
    mockGetInterestEarnedFromLedger.mockResolvedValue(
      new Map([["loan-1", new BigNumber("150000")]]),
    )
    mockGetLastPaymentDate.mockResolvedValue(
      new Date("2026-02-01T00:00:00.000Z"),
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

    const result = await computeSingleLoanBalanceData(
      "loan-1",
      new Date("2026-03-01T00:00:00.000Z"),
    )

    expect(result.loanId).toBe("loan-1")
    expect(result.totalBalanceOwed).toBe("1200000")
    expect(result.remainingPrincipalAmount).toBe("650000.00")
    expect(result.lastPaymentDate.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    )
    expect(result.daysOverdue).toBe(12)
    expect(result.unpaidInterest).toBe("30000")
    expect(mockComputeLoanOverdueInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        principalAmount: "1000000",
        baseRate: "0.10",
        totalInterestPaid: "150000.00",
        paymentCount: 2,
        totalBalanceOwed: "1200000",
        penaltyWaived: false,
        lastPaymentDate: new Date("2026-02-01T00:00:00.000Z"),
        asOf: new Date("2026-03-01T00:00:00.000Z"),
      }),
    )
  })

  it("getTotalInterestPaid formats the ledger total as money", async () => {
    const { getTotalInterestPaid } = await import("../loanBalanceData")
    const result = await getTotalInterestPaid("loan-1")

    expect(result).toBe("150000.00")
    expect(mockGetInterestEarnedFromLedger).toHaveBeenCalledWith(["loan-1"])
  })
})
