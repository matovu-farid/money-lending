import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import {
  getPnlData,
  getBalanceSheetData,
  getRetainedEarningsData,
  getPortfolioData,
  generateMonthlySnapshot,
} from "@/services/report.service"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import { createCreditor, addInvestment } from "@/services/creditor.service"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"

const ACTOR = "integration-test-actor"

async function makeCustomer(overrides = {}) {
  return Effect.runPromise(
    createCustomer({
      fullName: "Report Test Customer",
      nin: "C0000000000000",
      contact: "+256700000000",
      address: "Kampala, Uganda",
      ...overrides,
    })
  )
}

function baseLoanInput(customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    customerId,
    principalAmount: "1000000.00",
    issuanceFee: "50000.00",

    interestRate: "0.10",
    minInterestDays: 30,
    startDate: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
    disbursementSource: "cash" as const,
    ...overrides,
  }
}

/** Look up seeded categories by name */
async function getCategories() {
  const cats = await testDb.select().from(transactionCategories)
  return {
    interestEarned: cats.find((c) => c.name === "Interest Earned")!,
    interestPayments: cats.find((c) => c.name === "Interest Payments")!,
    shareCapital: cats.find((c) => c.name === "Share Capital")!,
  }
}

/**
 * Insert transaction via db (same pool as services).
 */
async function insertTransaction(
  type: "credit" | "debit",
  amount: string,
  categoryId: string,
  transactionDate: Date
) {
  await testDb.insert(transactions).values({
    type,
    amount,
    categoryId,
    transactionDate,
    recordedBy: ACTOR,
  })
}

describe("Report Service — Integration", () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  })

  // =================================================================
  // P&L Tests
  // =================================================================

  describe("getPnlData", () => {
    it("returns correct income, expenses, and netProfit for a period with transactions", async () => {
      const cats = await getCategories()

      // 1 revenue income + 1 expense in Jan 2025 (Share Capital is equity, not revenue — excluded from P&L)
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      await insertTransaction("debit", "30000.00", cats.interestPayments.id, new Date("2025-01-25T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      expect(result.period).toBe("2025-01")

      // Income — formatAmount returns toFixed(0) (UGX has no subunits)
      expect(result.income).toEqual(
        expect.arrayContaining([
          { category: "Interest Earned", amount: "50000" },
        ])
      )
      expect(result.totalIncome).toBe("50000")

      // Expenses
      expect(result.expenses).toEqual(
        expect.arrayContaining([
          { category: "Interest Payments", amount: "30000" },
        ])
      )
      expect(result.totalExpenses).toBe("30000")

      // Net profit
      expect(result.netProfit).toBe("20000")
    })

    it("returns all zeros for an empty period", async () => {
      // No transactions inserted — query Feb 2025
      const result = await Effect.runPromise(getPnlData("2025-02"))

      expect(result.period).toBe("2025-02")
      expect(result.income).toHaveLength(0)
      expect(result.expenses).toHaveLength(0)
      expect(result.totalIncome).toBe("0")
      expect(result.totalExpenses).toBe("0")
      expect(result.netProfit).toBe("0")
    })

    it("excludes transactions from other months", async () => {
      const cats = await getCategories()

      // Jan transaction
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      // Feb transaction — should NOT appear in Jan query
      await insertTransaction("credit", "99999.00", cats.interestEarned.id, new Date("2025-02-10T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      expect(result.totalIncome).toBe("50000")
      expect(result.income).toHaveLength(1)
      expect(result.income[0].amount).toBe("50000")
    })
  })

  // =================================================================
  // Portfolio Tests
  // =================================================================

  describe("getPortfolioData", () => {
    it("returns active loan with correct fields after a payment activates it", async () => {
      const customer = await makeCustomer()
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR)
      )

      // Record a payment to activate the loan
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: new Date("2025-01-31T00:00:00.000Z").toISOString(),
            amount: "100000.00",
            depositLocation: "cash",
          },
          ACTOR
        )
      )

      const portfolio = await Effect.runPromise(getPortfolioData())

      expect(portfolio).toHaveLength(1)
      const entry = portfolio[0]
      expect(entry.loanId).toBe(loan.id)
      expect(entry.customerName).toBe("Report Test Customer")
      expect(entry.principalAmount).toBe("1000000.00")
      expect(entry.status).toBe("active")
      // Payment of 100k on a 1M loan at 10%/month after 30 days covers
      // exactly the interest (100k), so principal remains unchanged at 1M.
      expect(Number(entry.outstandingBalance)).toBeLessThanOrEqual(1000000)
    })

    it("flags riskFlag=true for a loan overdue 60+ days", async () => {
      // Start date 90 days ago to ensure at least 60 days overdue
      const now = new Date()
      const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

      const customer = await makeCustomer({ contact: "+256700000001" })
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, {
            startDate: startDate.toISOString(),
          }),
          ACTOR
        )
      )

      // Record a minimal payment to activate the loan, then let interest accrue
      const paymentDate = new Date(startDate.getTime() + 1 * 24 * 60 * 60 * 1000)
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: paymentDate.toISOString(),
            amount: "1.00", // minimal payment — just to activate
            depositLocation: "cash",
          },
          ACTOR
        )
      )

      const portfolio = await Effect.runPromise(getPortfolioData())

      expect(portfolio).toHaveLength(1)
      expect(portfolio[0].riskFlag).toBe(true)
      expect(Number(portfolio[0].daysOverdue)).toBeGreaterThanOrEqual(30)
    })

    it("excludes fully_paid loans from portfolio", async () => {
      const customer = await makeCustomer({ contact: "+256700000002" })
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, {
            principalAmount: "100000.00",
          }),
          ACTOR
        )
      )

      // Pay the full amount plus enough to cover interest — this should fully pay it
      // For a 100k loan at 10%/month with min 30 days, interest = 10k
      // Overpay generously to ensure fully_paid status
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: new Date("2025-02-15T00:00:00.000Z").toISOString(),
            amount: "200000.00", // well above principal + interest
            depositLocation: "cash",
          },
          ACTOR
        )
      )

      const portfolio = await Effect.runPromise(getPortfolioData())

      // Should be empty — fully_paid loans excluded
      expect(portfolio).toHaveLength(0)
    })
  })

  // =================================================================
  // Balance Sheet Tests
  // =================================================================

  describe("getBalanceSheetData", () => {
    it("returns correct assets, liabilities, and equity", async () => {
      const cats = await getCategories()

      // --- Active loan (asset) ---
      const customer = await makeCustomer({ contact: "+256700000003" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR)
      )

      // Activate with a partial payment
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: new Date("2025-01-31T00:00:00.000Z").toISOString(),
            amount: "100000.00",
            depositLocation: "cash",
          },
          ACTOR
        )
      )

      // --- Creditor with investment (liability) ---
      const creditor = await Effect.runPromise(
        createCreditor(
          { name: "Test Creditor", contact: "+256700000099", address: "Entebbe" },
          ACTOR
        )
      )
      await Effect.runPromise(
        addInvestment(
          {
            creditorId: creditor.id,
            amount: "500000.00",
            interestRateMonthly: "0.05",
            investmentDate: new Date("2025-01-01T00:00:00.000Z").toISOString(),
          },
          ACTOR
        )
      )

      // --- Share capital transaction (equity) ---
      await insertTransaction("credit", "200000.00", cats.shareCapital.id, new Date("2025-01-05T00:00:00.000Z"))

      const result = await Effect.runPromise(getBalanceSheetData("2025-01"))

      expect(result.asOf).toBe("2025-01")

      // Assets: remaining loan balance after partial payment
      expect(Number(result.assets.totalLoansOutstanding)).toBeGreaterThan(0)

      // Liabilities: creditor investment outstanding
      expect(Number(result.liabilities.totalCreditorBalances)).toBeGreaterThan(0)

      // Equity: share capital should reflect the 200k we inserted
      // (there may be additional auto-posted transactions from the payment flow)
      expect(Number(result.equity.shareCapital)).toBeGreaterThanOrEqual(200000)
    })
  })

  // =================================================================
  // Snapshot Tests
  // =================================================================

  describe("generateMonthlySnapshot", () => {
    it("creates 2 rows (pnl + balance_sheet) in financial_snapshots", async () => {
      const cats = await getCategories()
      await insertTransaction("credit", "10000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))

      await Effect.runPromise(generateMonthlySnapshot("2025-01", ACTOR))

      const rows = await testDb.select().from(financialSnapshots)

      expect(rows).toHaveLength(2)
      const types = rows.map((r) => r.type).sort()
      expect(types).toEqual(["balance_sheet", "pnl"])
      expect(rows[0].generatedBy).toBe(ACTOR)
      expect(rows[1].generatedBy).toBe(ACTOR)

      // Verify snapshot data is a valid object (jsonb is already parsed)
      for (const row of rows) {
        expect(row.data).toBeTruthy()
        expect(typeof row.data).toBe("object")
      }
    })

    it("is idempotent — calling twice for same period creates only 2 rows", async () => {
      const cats = await getCategories()
      await insertTransaction("credit", "10000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))

      // Generate twice
      await Effect.runPromise(generateMonthlySnapshot("2025-01", ACTOR))
      await Effect.runPromise(generateMonthlySnapshot("2025-01", ACTOR))

      const rows = await testDb.select().from(financialSnapshots)

      // Still only 2 rows, not 4
      expect(rows).toHaveLength(2)
      const types = rows.map((r) => r.type).sort()
      expect(types).toEqual(["balance_sheet", "pnl"])
    })
  })

  // =================================================================
  // Retained Earnings Tests
  // =================================================================

  describe("getRetainedEarningsData", () => {
    it("computes beginning balance from prior periods and net income for current period", async () => {
      const cats = await getCategories()

      // Dec 2024: income of 200k (becomes beginning balance for Jan 2025)
      await insertTransaction("credit", "200000.00", cats.interestEarned.id, new Date("2024-12-15T00:00:00.000Z"))

      // Jan 2025: income of 50k, expense of 30k → net income 20k
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      await insertTransaction("debit", "30000.00", cats.interestPayments.id, new Date("2025-01-20T00:00:00.000Z"))

      const result = await Effect.runPromise(getRetainedEarningsData("2025-01"))

      expect(result.period).toBe("2025-01")
      // Beginning balance = prior credits - prior debits = 200000 - 0 = 200000
      expect(result.beginningBalance).toBe("200000")
      // Net income = current credits - current debits = 50000 - 30000 = 20000
      expect(result.netIncome).toBe("20000")
      // Ending = 200000 + 20000 = 220000
      expect(result.endingBalance).toBe("220000")
    })

    it("returns zeros for first period with no prior transactions", async () => {
      const cats = await getCategories()

      // Only one income transaction in Jan 2025
      await insertTransaction("credit", "100000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))

      const result = await Effect.runPromise(getRetainedEarningsData("2025-01"))

      expect(result.beginningBalance).toBe("0")
      expect(result.netIncome).toBe("100000")
      expect(result.endingBalance).toBe("100000")
    })
  })

  // =================================================================
  // P&L Reversal Handling
  // =================================================================

  describe("getPnlData — reversal handling", () => {
    it("DR to revenue category subtracts from income (not treated as expense)", async () => {
      const cats = await getCategories()

      // Original interest earned
      await insertTransaction("credit", "100000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      // Reversal — a debit to revenue should reduce income, not add expense
      await insertTransaction("debit", "20000.00", cats.interestEarned.id, new Date("2025-01-16T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      // Net income should be 80k (not 100k income + 20k expense)
      expect(result.totalIncome).toBe("80000")
      expect(result.totalExpenses).toBe("0")
      expect(result.netProfit).toBe("80000")
      // Should still be one income category, not two
      expect(result.income).toHaveLength(1)
      expect(result.income[0].category).toBe("Interest Earned")
      expect(result.income[0].amount).toBe("80000")
    })

    it("CR to expense category subtracts from expenses (not treated as income)", async () => {
      const cats = await getCategories()

      // Original expense
      await insertTransaction("debit", "50000.00", cats.interestPayments.id, new Date("2025-01-10T00:00:00.000Z"))
      // Reversal — credit to expense should reduce expense, not add income
      await insertTransaction("credit", "10000.00", cats.interestPayments.id, new Date("2025-01-11T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      expect(result.totalIncome).toBe("0")
      expect(result.totalExpenses).toBe("40000")
      expect(result.netProfit).toBe("-40000")
    })
  })

  // =================================================================
  // Balance Sheet Identity: Assets = Liabilities + Equity
  // =================================================================

  describe("getBalanceSheetData — identity assertion", () => {
    it("Assets = Liabilities + Equity after loan creation + payment", async () => {
      const customer = await makeCustomer({ contact: "+256700000099" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR)
      )

      // Record a payment
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: new Date("2025-01-31T00:00:00.000Z").toISOString(),
            amount: "200000.00",
            depositLocation: "cash",
          },
          ACTOR
        )
      )

      const result = await Effect.runPromise(getBalanceSheetData("2025-01"))

      const totalAssets = Number(result.assets.totalAssets)
      const totalLiabilities = Number(result.liabilities.totalCreditorBalances)
        + Number(result.liabilities.interestPayable)
      const totalEquity = Number(result.equity.totalEquity)

      // The fundamental accounting identity
      const diff = Math.abs(totalAssets - (totalLiabilities + totalEquity))
      expect(diff).toBeLessThanOrEqual(1) // rounding tolerance
    })
  })

  // =================================================================
  // Month-Boundary Period Tests
  // =================================================================

  describe("getPnlData — period boundary precision", () => {
    it("transaction at first millisecond of month is included", async () => {
      const cats = await getCategories()

      // Transaction at exactly midnight UTC on Jan 1
      await insertTransaction("credit", "100000.00", cats.interestEarned.id, new Date("2025-01-01T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))
      expect(result.totalIncome).toBe("100000")
    })

    it("transaction at last moment of month is included", async () => {
      const cats = await getCategories()

      // Transaction at 23:59:59 UTC on Jan 31
      await insertTransaction("credit", "100000.00", cats.interestEarned.id, new Date("2025-01-31T23:59:59.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))
      expect(result.totalIncome).toBe("100000")
    })

    it("transaction at first millisecond of next month is NOT included", async () => {
      const cats = await getCategories()

      // Transaction at midnight Feb 1 — should NOT appear in Jan
      await insertTransaction("credit", "100000.00", cats.interestEarned.id, new Date("2025-02-01T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))
      expect(result.totalIncome).toBe("0")
    })

    it("Feb boundary in leap year includes Feb 29", async () => {
      const cats = await getCategories()

      // Transaction on Feb 29 2024 (leap year)
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2024-02-29T12:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2024-02"))
      expect(result.totalIncome).toBe("50000")
    })
  })
})
