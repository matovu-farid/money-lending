import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: vi.fn().mockReturnValue(undefined),
}))

vi.mock("@/lib/ip-allowlist", () => ({
  isIpAllowlistEnabled: vi.fn().mockResolvedValue(false),
  isIpAllowed: vi.fn().mockResolvedValue(true),
  recordBlock: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue(null),
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getCreditorRepaymentPortionsFromLedger: vi.fn().mockResolvedValue(new Map()),
}))

// Schema tables are mocked as distinct sentinel objects so the db mock can
// dispatch rows by table identity (order-independent).
vi.mock("@/lib/db/schema/transactions", () => ({ transactions: { __table: "transactions" } }))
vi.mock("@/lib/db/schema/creditors", () => ({ creditors: { __table: "creditors" } }))
vi.mock("@/lib/db/schema/creditor-investments", () => ({ creditorInvestments: { __table: "creditorInvestments" } }))
vi.mock("@/lib/db/schema/creditor-repayments", () => ({ creditorRepayments: { __table: "creditorRepayments" } }))
vi.mock("@/lib/db/schema/fund-transfers", () => ({ fundTransfers: { __table: "fundTransfers" } }))
vi.mock("@/lib/db/schema/bank-accounts", () => ({ bankAccounts: { __table: "bankAccounts" } }))
vi.mock("@/lib/db/schema/loans", () => ({ loans: { __table: "loans" } }))
vi.mock("@/lib/db/schema/customers", () => ({ customers: { __table: "customers" } }))
vi.mock("@/lib/db/schema/auth", () => ({ user: { __table: "user" } }))

vi.mock("drizzle-orm", () => ({ eq: vi.fn((...args: unknown[]) => args) }))

// Table-keyed db mock: db.select(...).from(table).where(...) resolves to the
// rows registered for that table in `rowsByTable`.
const rowsByTable = new Map<unknown, unknown[]>()
vi.mock("@/lib/db", () => {
  const makeChain = () => {
    let currentTable: unknown
    return {
      from: (table: unknown) => {
        currentTable = table
        return { where: () => Promise.resolve(rowsByTable.get(currentTable) ?? []) }
      },
    }
  }
  return { db: { select: () => makeChain() } }
})

// ---------- Imports ----------

import { getSession, checkPermission } from "@/lib/action-utils"
import { getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service"
import { transactions } from "@/lib/db/schema/transactions"
import { creditors } from "@/lib/db/schema/creditors"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { bankAccounts } from "@/lib/db/schema/bank-accounts"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import type { TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import type { Equals, Expect } from "@/test-utils/type-assert"

import { getTransactionReceiptDataAction } from "../receipt.actions"
import { fakeSession } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockCheckPermission = vi.mocked(checkPermission)
const mockPortions = vi.mocked(getCreditorRepaymentPortionsFromLedger)

// ---------- Type snapshot (protect the action→service refactor) ----------
export type ReceiptActionTypeSnapshots = [
  Expect<
    Equals<
      Awaited<ReturnType<typeof getTransactionReceiptDataAction>>,
      { data: TransactionReceiptData } | { error: string }
    >
  >,
]

const DATE = new Date("2026-01-15T10:00:00Z")

// ---------- Tests ----------

describe("getTransactionReceiptDataAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rowsByTable.clear()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(null)
    mockPortions.mockResolvedValue(new Map())
  })

  it("returns Unauthorized when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await getTransactionReceiptDataAction({ kind: "expense", transactionId: "t1" })
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns the baseline-permission error when loan:read is denied", async () => {
    mockCheckPermission.mockResolvedValueOnce("Forbidden")
    const result = await getTransactionReceiptDataAction({ kind: "expense", transactionId: "t1" })
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("enforces the kind-specific permission (creditor receipts are admin-only)", async () => {
    // First check (loan:read baseline) passes, second (creditor:read) fails.
    mockCheckPermission.mockResolvedValueOnce(null).mockResolvedValueOnce("Insufficient permissions")
    const result = await getTransactionReceiptDataAction({
      kind: "creditor_investment",
      investmentId: "inv1",
    })
    expect(result).toEqual({ error: "Insufficient permissions" })
  })

  describe("expense receipts", () => {
    it("returns an error when the transaction is missing", async () => {
      rowsByTable.set(transactions, [])
      const result = await getTransactionReceiptDataAction({ kind: "expense", transactionId: "t1" })
      expect(result).toEqual({ error: "Transaction not found" })
    })

    it("builds an expense receipt", async () => {
      rowsByTable.set(transactions, [
        {
          id: "t1",
          transactionDate: DATE,
          category: "Rent",
          amount: "500",
          recordedBy: "u1",
          subLocationId: null,
          depositLocation: "cash",
          description: "Office rent",
        },
      ])
      rowsByTable.set(user, [{ name: "Jane" }])
      const result = await getTransactionReceiptDataAction({ kind: "expense", transactionId: "t1" })
      expect(result).toMatchObject({
        data: {
          headerTitle: "Expense",
          amount: "500",
          actorName: "Jane",
          subtitle: "Rent",
          notes: "Office rent",
        },
      })
      expect("data" in result && result.data.receiptNumber).toMatch(/^EXP-/)
    })
  })

  describe("income receipts", () => {
    it("builds an income receipt", async () => {
      rowsByTable.set(transactions, [
        {
          id: "t2",
          transactionDate: DATE,
          category: "Interest",
          amount: "100",
          recordedBy: null,
          subLocationId: null,
          depositLocation: null,
          description: null,
        },
      ])
      const result = await getTransactionReceiptDataAction({ kind: "income", transactionId: "t2" })
      expect(result).toMatchObject({ data: { headerTitle: "Income", amount: "100", actorName: "Officer" } })
      expect("data" in result && result.data.receiptNumber).toMatch(/^INC-/)
    })
  })

  describe("creditor investment receipts", () => {
    it("builds an investment receipt with creditor details", async () => {
      mockCheckPermission.mockResolvedValue(null)
      rowsByTable.set(creditorInvestments, [
        {
          id: "inv1",
          creditorId: "c1",
          amount: "10000",
          investmentDate: DATE,
          interestRateMonthly: "0.05",
          recordedBy: "u1",
        },
      ])
      rowsByTable.set(creditors, [{ id: "c1", name: "Acme", contact: "0700" }])
      rowsByTable.set(user, [{ name: "Jane" }])
      const result = await getTransactionReceiptDataAction({ kind: "creditor_investment", investmentId: "inv1" })
      expect(result).toMatchObject({
        data: {
          headerTitle: "Creditor Investment Received",
          amount: "10000",
          counterpartyName: "Acme",
          counterpartyContact: "0700",
        },
      })
    })

    it("returns an error when the investment is missing", async () => {
      rowsByTable.set(creditorInvestments, [])
      const result = await getTransactionReceiptDataAction({ kind: "creditor_investment", investmentId: "inv1" })
      expect(result).toEqual({ error: "Investment not found" })
    })
  })

  describe("creditor repayment receipts", () => {
    it("builds a repayment receipt with a ledger split breakdown", async () => {
      rowsByTable.set(creditorRepayments, [
        { id: "rep1", investmentId: "inv1", amount: "2000", repaymentDate: DATE, recordedBy: "u1" },
      ])
      rowsByTable.set(creditorInvestments, [{ id: "inv1", creditorId: "c1" }])
      rowsByTable.set(creditors, [{ id: "c1", name: "Acme", contact: "0700" }])
      rowsByTable.set(user, [{ name: "Jane" }])
      mockPortions.mockResolvedValue(
        new Map([["rep1", { interestPortion: "500", principalPortion: "1500" }]]),
      )
      const result = await getTransactionReceiptDataAction({ kind: "creditor_repayment", repaymentId: "rep1" })
      expect(result).toMatchObject({
        data: {
          headerTitle: "Creditor Repayment",
          amount: "2000",
          breakdownLines: [
            { label: "Interest", value: "500" },
            { label: "Principal", value: "1500" },
          ],
        },
      })
    })
  })

  describe("fund transfer receipts", () => {
    it("builds a fund transfer receipt", async () => {
      rowsByTable.set(fundTransfers, [
        {
          id: "ft1",
          amount: "3000",
          createdAt: DATE,
          transferredAt: DATE,
          transferType: "transfer",
          transferredBy: "u1",
          fromSubLocationId: null,
          toSubLocationId: null,
          fromLocation: "cash",
          toLocation: "bank",
          note: "Move funds",
          backdateNote: null,
        },
      ])
      rowsByTable.set(user, [{ name: "Jane" }])
      rowsByTable.set(bankAccounts, [{ name: "Stanbic" }])
      const result = await getTransactionReceiptDataAction({ kind: "fund_transfer", transferId: "ft1" })
      expect(result).toMatchObject({ data: { headerTitle: "Fund Transfer", amount: "3000", notes: "Move funds" } })
      expect("data" in result && result.data.receiptNumber).toMatch(/^FT-/)
    })

    it("labels capital injections", async () => {
      rowsByTable.set(fundTransfers, [
        {
          id: "ft2",
          amount: "5000",
          createdAt: DATE,
          transferredAt: DATE,
          transferType: "capital_injection",
          transferredBy: null,
          fromSubLocationId: null,
          toSubLocationId: null,
          fromLocation: null,
          toLocation: null,
          note: null,
          backdateNote: null,
        },
      ])
      const result = await getTransactionReceiptDataAction({ kind: "fund_transfer", transferId: "ft2" })
      expect(result).toMatchObject({ data: { headerTitle: "Capital Injection" } })
      expect("data" in result && result.data.receiptNumber).toMatch(/^INJ-/)
    })
  })

  describe("collateral settlement receipts", () => {
    it("builds a settlement receipt", async () => {
      rowsByTable.set(loans, [{ id: "l1", customerId: "cust1", issuedBy: "u1" }])
      rowsByTable.set(customers, [{ id: "cust1", fullName: "John Doe", contact: "0711" }])
      rowsByTable.set(transactions, [
        {
          id: "stl-tx",
          referenceId: "l1",
          referenceType: "collateral_settlement",
          transactionDate: DATE,
          amount: "8000",
          description: "Settled",
        },
      ])
      const result = await getTransactionReceiptDataAction({ kind: "collateral_settlement", loanId: "l1" })
      expect(result).toMatchObject({
        data: { headerTitle: "Collateral Settlement", amount: "8000", counterpartyName: "John Doe" },
      })
    })

    it("returns an error when no settlement transaction exists", async () => {
      rowsByTable.set(loans, [{ id: "l1", customerId: "cust1", issuedBy: "u1" }])
      rowsByTable.set(customers, [{ id: "cust1", fullName: "John Doe", contact: "0711" }])
      rowsByTable.set(transactions, [
        { id: "other", referenceId: "l1", referenceType: "disbursement", transactionDate: DATE, amount: "1" },
      ])
      const result = await getTransactionReceiptDataAction({ kind: "collateral_settlement", loanId: "l1" })
      expect(result).toEqual({ error: "Settlement record not found" })
    })
  })
})
