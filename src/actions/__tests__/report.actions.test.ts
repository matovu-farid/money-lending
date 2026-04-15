import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/with-action", () => ({
  withAction: (opts: any) => {
    return async (input?: any) => {
      const session = { user: { id: "test-user", role: "admin" } }
      if (opts.effect) {
        const eff = opts.effect(session, input ?? {})
        const result = await Effect.runPromise(eff)
        return { data: result }
      }
      if (opts.action) {
        return opts.action(session, input ?? {})
      }
    }
  },
}))

vi.mock("@/services/report.service", () => ({
  getPortfolioData: vi.fn(),
  getPnlData: vi.fn(),
  getBalanceSheetData: vi.fn(),
  getRetainedEarningsData: vi.fn(),
}))

vi.mock("@/services/transaction.service", () => ({
  listTransactions: vi.fn(),
}))

vi.mock("@/lib/utils", () => ({
  getCurrentMonth: vi.fn().mockReturnValue("2026-04"),
}))

// ---------- Imports ----------

import {
  getPortfolioData,
  getPnlData,
  getBalanceSheetData,
  getRetainedEarningsData,
} from "@/services/report.service"
import { listTransactions } from "@/services/transaction.service"
import { getCurrentMonth } from "@/lib/utils"

import {
  getPortfolioReportAction,
  getPnlReportAction,
  getBalanceSheetReportAction,
  getRetainedEarningsReportAction,
  getTransactionReportDataAction,
} from "../report.actions"

const mockGetPortfolioData = vi.mocked(getPortfolioData)
const mockGetPnlData = vi.mocked(getPnlData)
const mockGetBalanceSheetData = vi.mocked(getBalanceSheetData)
const mockGetRetainedEarningsData = vi.mocked(getRetainedEarningsData)
const mockListTransactions = vi.mocked(listTransactions)
const mockGetCurrentMonth = vi.mocked(getCurrentMonth)

// ---------- Tests ----------

describe("Report Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentMonth.mockReturnValue("2026-04")
  })

  // ===== getPortfolioReportAction =====
  describe("getPortfolioReportAction", () => {
    it("calls getPortfolioData and returns data", async () => {
      const portfolioData = [
        { customerName: "Alice", loanId: "l1", principal: "1000000" },
      ]
      mockGetPortfolioData.mockReturnValue(Effect.succeed(portfolioData) as any)

      const result = await getPortfolioReportAction()
      expect(result).toEqual({ data: portfolioData })
      expect(mockGetPortfolioData).toHaveBeenCalledTimes(1)
    })
  })

  // ===== getPnlReportAction =====
  describe("getPnlReportAction", () => {
    it("passes period to getPnlData", async () => {
      const pnlData = { revenue: "500000", expenses: "200000" }
      mockGetPnlData.mockReturnValue(Effect.succeed(pnlData) as any)

      const result = await getPnlReportAction({ period: "2026-03" })
      expect(result).toEqual({ data: pnlData })
      expect(mockGetPnlData).toHaveBeenCalledWith("2026-03")
    })

    it("uses getCurrentMonth when period is empty", async () => {
      const pnlData = { revenue: "100000", expenses: "50000" }
      mockGetPnlData.mockReturnValue(Effect.succeed(pnlData) as any)

      const result = await getPnlReportAction({ period: "" })
      expect(result).toEqual({ data: pnlData })
      expect(mockGetPnlData).toHaveBeenCalledWith("2026-04")
      expect(mockGetCurrentMonth).toHaveBeenCalled()
    })
  })

  // ===== getBalanceSheetReportAction =====
  describe("getBalanceSheetReportAction", () => {
    it("passes period to getBalanceSheetData", async () => {
      const bsData = { assets: "1000000", liabilities: "500000" }
      mockGetBalanceSheetData.mockReturnValue(Effect.succeed(bsData) as any)

      const result = await getBalanceSheetReportAction({ period: "2026-02" })
      expect(result).toEqual({ data: bsData })
      expect(mockGetBalanceSheetData).toHaveBeenCalledWith("2026-02")
    })

    it("uses getCurrentMonth when period is empty", async () => {
      const bsData = { assets: "800000", liabilities: "400000" }
      mockGetBalanceSheetData.mockReturnValue(Effect.succeed(bsData) as any)

      const result = await getBalanceSheetReportAction({ period: "" })
      expect(mockGetBalanceSheetData).toHaveBeenCalledWith("2026-04")
    })
  })

  // ===== getRetainedEarningsReportAction =====
  describe("getRetainedEarningsReportAction", () => {
    it("passes period to getRetainedEarningsData", async () => {
      const reData = { retainedEarnings: "300000" }
      mockGetRetainedEarningsData.mockReturnValue(Effect.succeed(reData) as any)

      const result = await getRetainedEarningsReportAction({ period: "2026-01" })
      expect(result).toEqual({ data: reData })
      expect(mockGetRetainedEarningsData).toHaveBeenCalledWith("2026-01")
    })

    it("uses getCurrentMonth when period is empty", async () => {
      const reData = { retainedEarnings: "250000" }
      mockGetRetainedEarningsData.mockReturnValue(Effect.succeed(reData) as any)

      const result = await getRetainedEarningsReportAction({ period: "" })
      expect(mockGetRetainedEarningsData).toHaveBeenCalledWith("2026-04")
    })
  })

  // ===== getTransactionReportDataAction =====
  describe("getTransactionReportDataAction", () => {
    it("deduplicates categories from transactions", async () => {
      const transactions = [
        { id: "t1", categoryName: "Interest", type: "income", amount: "100" },
        { id: "t2", categoryName: "Rent", type: "expense", amount: "200" },
        { id: "t3", categoryName: "Interest", type: "income", amount: "150" },
      ]
      mockListTransactions.mockReturnValue(
        Effect.succeed({ data: transactions, total: 3 }) as any,
      )

      const result = await getTransactionReportDataAction()
      expect(result).toEqual({
        data: {
          transactions,
          categories: [
            ["Interest", "Interest"],
            ["Rent", "Rent"],
          ],
        },
      })
      expect(mockListTransactions).toHaveBeenCalledWith({}, 1, 10000)
    })

    it("returns empty categories when no transactions", async () => {
      mockListTransactions.mockReturnValue(
        Effect.succeed({ data: [], total: 0 }) as any,
      )

      const result = await getTransactionReportDataAction()
      expect(result).toEqual({
        data: {
          transactions: [],
          categories: [],
        },
      })
    })
  })
})
