import { describe, it, expect, vi, beforeEach } from "vitest"
import type { db } from "@/lib/db"

type LedgerQueryDb = Pick<typeof db, "select">

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn() }
  return { db: mockDb }
})

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a chained mock for select().from().innerJoin().where().groupBy() */
function ledgerQuery<T>(rows: T[]) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  }
}

/** Create a mock queryDb object that resolves the given rows */
function mockQueryDb<T>(rows: T[]): LedgerQueryDb {
  return { select: vi.fn().mockReturnValue(ledgerQuery(rows)) } as unknown as LedgerQueryDb
}

/** Shorthand to set up db.select to return the given rows through the chain */
function setupDbLedger<T>(mockedDb: { select: ReturnType<typeof vi.fn> }, rows: T[]) {
  mockedDb.select.mockReturnValue(ledgerQuery(rows))
}

describe("ledger-queries.service", () => {
  let mockedDb: { select: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db as unknown as { select: ReturnType<typeof vi.fn> }
  })

  // ── getLoanBalancesFromLedger ────────────────────────────────────────

  describe("getLoanBalancesFromLedger", () => {
    it("returns empty Map for empty loanIds array", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getLoanBalancesFromLedger([])
      expect(result).toEqual(new Map())
      expect(mockedDb.select).not.toHaveBeenCalled()
    })

    it("debit adds and credit subtracts for asset account", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { loanId: "loan-1", txType: "debit", total: "500000" },
        { loanId: "loan-1", txType: "credit", total: "100000" },
      ])
      const result = await getLoanBalancesFromLedger(
        ["loan-1"],
        undefined,
        qdb
      )
      expect(result.get("loan-1")!.toFixed(0)).toBe("400000")
    })

    it("handles multiple loans independently", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { loanId: "loan-1", txType: "debit", total: "1000000" },
        { loanId: "loan-1", txType: "credit", total: "200000" },
        { loanId: "loan-2", txType: "debit", total: "500000" },
      ])
      const result = await getLoanBalancesFromLedger(
        ["loan-1", "loan-2"],
        undefined,
        qdb
      )
      expect(result.get("loan-1")!.toFixed(0)).toBe("800000")
      expect(result.get("loan-2")!.toFixed(0)).toBe("500000")
    })

    it("skips rows with null loanId", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { loanId: null, txType: "debit", total: "100000" },
        { loanId: "loan-1", txType: "debit", total: "300000" },
      ])
      const result = await getLoanBalancesFromLedger(
        ["loan-1"],
        undefined,
        qdb
      )
      expect(result.size).toBe(1)
      expect(result.get("loan-1")!.toFixed(0)).toBe("300000")
    })

    it("accepts asOf date parameter", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { loanId: "loan-1", txType: "debit", total: "500000" },
      ])
      const result = await getLoanBalancesFromLedger(
        ["loan-1"],
        new Date("2026-01-01"),
        qdb
      )
      expect(result.get("loan-1")!.toFixed(0)).toBe("500000")
    })

    it("uses default db when no queryDb provided", async () => {
      const { getLoanBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { loanId: "loan-1", txType: "debit", total: "250000" },
      ])
      const result = await getLoanBalancesFromLedger(["loan-1"])
      expect(mockedDb.select).toHaveBeenCalled()
      expect(result.get("loan-1")!.toFixed(0)).toBe("250000")
    })
  })

  // ── getLoanBalanceFromLedger ─────────────────────────────────────────

  describe("getLoanBalanceFromLedger", () => {
    it("returns the balance for a single loan", async () => {
      const { getLoanBalanceFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { loanId: "loan-1", txType: "debit", total: "700000" },
        { loanId: "loan-1", txType: "credit", total: "200000" },
      ])
      const result = await getLoanBalanceFromLedger(
        "loan-1",
        undefined,
        qdb
      )
      expect(result.toFixed(0)).toBe("500000")
    })

    it("returns BigNumber(0) for a missing loan", async () => {
      const { getLoanBalanceFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([])
      const result = await getLoanBalanceFromLedger(
        "nonexistent",
        undefined,
        qdb
      )
      expect(result.toFixed(0)).toBe("0")
    })

    it("passes asOf date through to batch function", async () => {
      const { getLoanBalanceFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const asOf = new Date("2026-06-15")
      const qdb = mockQueryDb([
        { loanId: "loan-1", txType: "debit", total: "100000" },
      ])
      const result = await getLoanBalanceFromLedger(
        "loan-1",
        asOf,
        qdb
      )
      expect(result.toFixed(0)).toBe("100000")
    })
  })

  // ── getInterestEarnedFromLedger ─────────────────────────────────────

  describe("getInterestEarnedFromLedger", () => {
    it("returns empty Map for empty loanIds", async () => {
      const { getInterestEarnedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getInterestEarnedFromLedger([])
      expect(result).toEqual(new Map())
      expect(mockedDb.select).not.toHaveBeenCalled()
    })

    it("credit adds for revenue account", async () => {
      const { getInterestEarnedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { loanId: "loan-1", txType: "credit", total: "50000" },
      ])
      const result = await getInterestEarnedFromLedger(["loan-1"])
      expect(result.get("loan-1")!.toFixed(0)).toBe("50000")
    })

    it("debit subtracts for revenue account", async () => {
      const { getInterestEarnedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { loanId: "loan-1", txType: "credit", total: "80000" },
        { loanId: "loan-1", txType: "debit", total: "20000" },
      ])
      const result = await getInterestEarnedFromLedger(["loan-1"])
      expect(result.get("loan-1")!.toFixed(0)).toBe("60000")
    })

    it("skips rows with null loanId", async () => {
      const { getInterestEarnedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { loanId: null, txType: "credit", total: "50000" },
      ])
      const result = await getInterestEarnedFromLedger(["loan-1"])
      expect(result.size).toBe(0)
    })
  })

  // ── getInterestPayableFromLedger ────────────────────────────────────

  describe("getInterestPayableFromLedger", () => {
    it("returns empty Map for empty investmentIds", async () => {
      const { getInterestPayableFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getInterestPayableFromLedger([])
      expect(result).toEqual(new Map())
    })

    it("credit adds for liability account", async () => {
      const { getInterestPayableFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { referenceId: "inv-1", txType: "credit", total: "30000" },
      ])
      const result = await getInterestPayableFromLedger(["inv-1"])
      expect(result.get("inv-1")!.toFixed(0)).toBe("30000")
    })

    it("debit subtracts for liability account", async () => {
      const { getInterestPayableFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { referenceId: "inv-1", txType: "credit", total: "50000" },
        { referenceId: "inv-1", txType: "debit", total: "15000" },
      ])
      const result = await getInterestPayableFromLedger(["inv-1"])
      expect(result.get("inv-1")!.toFixed(0)).toBe("35000")
    })

    it("skips rows with null referenceId", async () => {
      const { getInterestPayableFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { referenceId: null, txType: "credit", total: "10000" },
      ])
      const result = await getInterestPayableFromLedger(["inv-1"])
      expect(result.size).toBe(0)
    })

    it("handles multiple investments", async () => {
      const { getInterestPayableFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { referenceId: "inv-1", txType: "credit", total: "40000" },
        { referenceId: "inv-2", txType: "credit", total: "60000" },
        { referenceId: "inv-2", txType: "debit", total: "10000" },
      ])
      const result = await getInterestPayableFromLedger(["inv-1", "inv-2"])
      expect(result.get("inv-1")!.toFixed(0)).toBe("40000")
      expect(result.get("inv-2")!.toFixed(0)).toBe("50000")
    })
  })

  // ── getCreditorBalancesFromLedger ───────────────────────────────────

  describe("getCreditorBalancesFromLedger", () => {
    it("returns empty Map for empty investmentIds", async () => {
      const { getCreditorBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getCreditorBalancesFromLedger([])
      expect(result).toEqual(new Map())
    })

    it("credit adds for liability account (Creditor Investment)", async () => {
      const { getCreditorBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { referenceId: "inv-1", txType: "credit", total: "1000000" },
      ])
      const result = await getCreditorBalancesFromLedger(
        ["inv-1"],
        qdb
      )
      expect(result.get("inv-1")!.toFixed(0)).toBe("1000000")
    })

    it("debit subtracts for liability account (principal repaid)", async () => {
      const { getCreditorBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { referenceId: "inv-1", txType: "credit", total: "1000000" },
        { referenceId: "inv-1", txType: "debit", total: "300000" },
      ])
      const result = await getCreditorBalancesFromLedger(
        ["inv-1"],
        qdb
      )
      expect(result.get("inv-1")!.toFixed(0)).toBe("700000")
    })

    it("skips rows with null referenceId", async () => {
      const { getCreditorBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        { referenceId: null, txType: "credit", total: "500000" },
      ])
      const result = await getCreditorBalancesFromLedger(
        ["inv-1"],
        qdb
      )
      expect(result.size).toBe(0)
    })

    it("uses default db when no queryDb provided", async () => {
      const { getCreditorBalancesFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { referenceId: "inv-1", txType: "credit", total: "200000" },
      ])
      const result = await getCreditorBalancesFromLedger(["inv-1"])
      expect(mockedDb.select).toHaveBeenCalled()
      expect(result.get("inv-1")!.toFixed(0)).toBe("200000")
    })
  })

  // ── getPaymentPortionsFromLedger ────────────────────────────────────

  describe("getPaymentPortionsFromLedger", () => {
    it("returns empty Map for empty paymentIds", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getPaymentPortionsFromLedger([])
      expect(result).toEqual(new Map())
    })

    it("maps Interest Earned CR to interest portion", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Interest Earned",
          txType: "credit",
          total: "25000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      const portions = result.get("pay-1")!
      expect(portions.interestPortion).toBe("25000.00")
      expect(portions.principalPortion).toBe("0.00")
    })

    it("maps Loans Receivable CR to principal portion", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Loans Receivable",
          txType: "credit",
          total: "75000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      const portions = result.get("pay-1")!
      expect(portions.interestPortion).toBe("0.00")
      expect(portions.principalPortion).toBe("75000.00")
    })

    it("combines both interest and principal portions for a payment", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Interest Earned",
          txType: "credit",
          total: "20000",
        },
        {
          referenceId: "pay-1",
          categoryName: "Loans Receivable",
          txType: "credit",
          total: "80000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      const portions = result.get("pay-1")!
      expect(portions.interestPortion).toBe("20000.00")
      expect(portions.principalPortion).toBe("80000.00")
    })

    it("Interest Earned DR subtracts from interest portion (reversal)", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Interest Earned",
          txType: "credit",
          total: "30000",
        },
        {
          referenceId: "pay-1",
          categoryName: "Interest Earned",
          txType: "debit",
          total: "10000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      expect(result.get("pay-1")!.interestPortion).toBe("20000.00")
    })

    it("Loans Receivable DR subtracts from principal portion (reversal)", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Loans Receivable",
          txType: "credit",
          total: "50000",
        },
        {
          referenceId: "pay-1",
          categoryName: "Loans Receivable",
          txType: "debit",
          total: "10000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      expect(result.get("pay-1")!.principalPortion).toBe("40000.00")
    })

    it("skips rows with null referenceId", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: null,
          categoryName: "Interest Earned",
          txType: "credit",
          total: "10000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1"],
        qdb
      )
      expect(result.size).toBe(0)
    })

    it("handles multiple payments independently", async () => {
      const { getPaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const qdb = mockQueryDb([
        {
          referenceId: "pay-1",
          categoryName: "Interest Earned",
          txType: "credit",
          total: "10000",
        },
        {
          referenceId: "pay-1",
          categoryName: "Loans Receivable",
          txType: "credit",
          total: "40000",
        },
        {
          referenceId: "pay-2",
          categoryName: "Interest Earned",
          txType: "credit",
          total: "15000",
        },
        {
          referenceId: "pay-2",
          categoryName: "Loans Receivable",
          txType: "credit",
          total: "85000",
        },
      ])
      const result = await getPaymentPortionsFromLedger(
        ["pay-1", "pay-2"],
        qdb
      )
      expect(result.get("pay-1")!.interestPortion).toBe("10000.00")
      expect(result.get("pay-1")!.principalPortion).toBe("40000.00")
      expect(result.get("pay-2")!.interestPortion).toBe("15000.00")
      expect(result.get("pay-2")!.principalPortion).toBe("85000.00")
    })
  })

  // ── getCreditorRepaymentPortionsFromLedger ──────────────────────────

  describe("getCreditorRepaymentPortionsFromLedger", () => {
    it("returns empty Map for empty repaymentIds", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getCreditorRepaymentPortionsFromLedger([])
      expect(result).toEqual(new Map())
    })

    it("Interest Payments DR maps to interest portion", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: "rep-1",
          categoryName: "Interest Payments",
          txType: "debit",
          total: "15000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.get("rep-1")!.interestPortion).toBe("15000.00")
      expect(result.get("rep-1")!.principalPortion).toBe("0.00")
    })

    it("Creditor Investment DR maps to principal portion", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: "rep-1",
          categoryName: "Creditor Investment",
          txType: "debit",
          total: "100000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.get("rep-1")!.interestPortion).toBe("0.00")
      expect(result.get("rep-1")!.principalPortion).toBe("100000.00")
    })

    it("Interest Payments CR subtracts from interest portion", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: "rep-1",
          categoryName: "Interest Payments",
          txType: "debit",
          total: "20000",
        },
        {
          referenceId: "rep-1",
          categoryName: "Interest Payments",
          txType: "credit",
          total: "5000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.get("rep-1")!.interestPortion).toBe("15000.00")
    })

    it("Creditor Investment CR subtracts from principal portion", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: "rep-1",
          categoryName: "Creditor Investment",
          txType: "debit",
          total: "80000",
        },
        {
          referenceId: "rep-1",
          categoryName: "Creditor Investment",
          txType: "credit",
          total: "20000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.get("rep-1")!.principalPortion).toBe("60000.00")
    })

    it("combines both interest and principal for a repayment", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: "rep-1",
          categoryName: "Interest Payments",
          txType: "debit",
          total: "10000",
        },
        {
          referenceId: "rep-1",
          categoryName: "Creditor Investment",
          txType: "debit",
          total: "90000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.get("rep-1")!.interestPortion).toBe("10000.00")
      expect(result.get("rep-1")!.principalPortion).toBe("90000.00")
    })

    it("skips rows with null referenceId", async () => {
      const { getCreditorRepaymentPortionsFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          referenceId: null,
          categoryName: "Interest Payments",
          txType: "debit",
          total: "10000",
        },
      ])
      const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
      expect(result.size).toBe(0)
    })
  })

  // ── getCreditorTotalInvestedFromLedger ──────────────────────────────

  describe("getCreditorTotalInvestedFromLedger", () => {
    it("returns BigNumber(0) for empty investmentIds", async () => {
      const { getCreditorTotalInvestedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getCreditorTotalInvestedFromLedger([])
      expect(result.toFixed(0)).toBe("0")
    })

    it("sums only CR entries (investment received)", async () => {
      const { getCreditorTotalInvestedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { txType: "credit", total: "500000" },
        { txType: "credit", total: "300000" },
      ])
      const result = await getCreditorTotalInvestedFromLedger([
        "inv-1",
        "inv-2",
      ])
      expect(result.toFixed(0)).toBe("800000")
    })

    it("ignores DR entries", async () => {
      const { getCreditorTotalInvestedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { txType: "credit", total: "500000" },
        { txType: "debit", total: "200000" },
      ])
      const result = await getCreditorTotalInvestedFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("500000")
    })

    it("returns zero when no CR entries exist", async () => {
      const { getCreditorTotalInvestedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        { txType: "debit", total: "100000" },
      ])
      const result = await getCreditorTotalInvestedFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("0")
    })

    it("returns zero when query returns empty rows", async () => {
      const { getCreditorTotalInvestedFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [])
      const result = await getCreditorTotalInvestedFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("0")
    })
  })

  // ── getCreditorTotalRepaidFromLedger ────────────────────────────────

  describe("getCreditorTotalRepaidFromLedger", () => {
    it("returns BigNumber(0) for empty investmentIds", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      const result = await getCreditorTotalRepaidFromLedger([])
      expect(result.toFixed(0)).toBe("0")
    })

    it("sums Creditor Investment DR entries (principal repaid)", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          txType: "debit",
          categoryName: "Creditor Investment",
          total: "300000",
        },
      ])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("300000")
    })

    it("sums Interest Payments DR entries (interest paid)", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          txType: "debit",
          categoryName: "Interest Payments",
          total: "50000",
        },
      ])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("50000")
    })

    it("sums both Creditor Investment DR and Interest Payments DR", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          txType: "debit",
          categoryName: "Creditor Investment",
          total: "200000",
        },
        {
          txType: "debit",
          categoryName: "Interest Payments",
          total: "30000",
        },
      ])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("230000")
    })

    it("ignores CR entries for both categories", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          txType: "debit",
          categoryName: "Creditor Investment",
          total: "200000",
        },
        {
          txType: "credit",
          categoryName: "Creditor Investment",
          total: "500000",
        },
        {
          txType: "debit",
          categoryName: "Interest Payments",
          total: "30000",
        },
        {
          txType: "credit",
          categoryName: "Interest Payments",
          total: "10000",
        },
      ])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("230000")
    })

    it("returns zero when no DR entries exist", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [
        {
          txType: "credit",
          categoryName: "Creditor Investment",
          total: "500000",
        },
      ])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("0")
    })

    it("returns zero when query returns empty rows", async () => {
      const { getCreditorTotalRepaidFromLedger } = await import(
        "@/services/ledger-queries.service"
      )
      setupDbLedger(mockedDb, [])
      const result = await getCreditorTotalRepaidFromLedger(["inv-1"])
      expect(result.toFixed(0)).toBe("0")
    })
  })
})
