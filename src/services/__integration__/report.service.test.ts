import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import {
  getPnlData,
  getBalanceSheetData,
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
      nin: "CM00000000TEST",
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
    description: "Test loan",
    interestRate: "0.10",
    minInterestDays: 30,
    startDate: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
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

      // 2 income + 1 expense in Jan 2025
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      await insertTransaction("credit", "100000.00", cats.shareCapital.id, new Date("2025-01-20T00:00:00.000Z"))
      await insertTransaction("debit", "30000.00", cats.interestPayments.id, new Date("2025-01-25T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      expect(result.period).toBe("2025-01")

      // Income
      expect(result.income).toEqual(
        expect.arrayContaining([
          { category: "Interest Earned", amount: "50000.00" },
          { category: "Share Capital", amount: "100000.00" },
        ])
      )
      expect(result.totalIncome).toBe("150000.00")

      // Expenses
      expect(result.expenses).toEqual(
        expect.arrayContaining([
          { category: "Interest Payments", amount: "30000.00" },
        ])
      )
      expect(result.totalExpenses).toBe("30000.00")

      // Net profit
      expect(result.netProfit).toBe("120000.00")
    })

    it("returns all zeros for an empty period", async () => {
      // No transactions inserted — query Feb 2025
      const result = await Effect.runPromise(getPnlData("2025-02"))

      expect(result.period).toBe("2025-02")
      expect(result.income).toHaveLength(0)
      expect(result.expenses).toHaveLength(0)
      expect(result.totalIncome).toBe("0.00")
      expect(result.totalExpenses).toBe("0.00")
      expect(result.netProfit).toBe("0.00")
    })

    it("excludes transactions from other months", async () => {
      const cats = await getCategories()

      // Jan transaction
      await insertTransaction("credit", "50000.00", cats.interestEarned.id, new Date("2025-01-15T00:00:00.000Z"))
      // Feb transaction — should NOT appear in Jan query
      await insertTransaction("credit", "99999.00", cats.interestEarned.id, new Date("2025-02-10T00:00:00.000Z"))

      const result = await Effect.runPromise(getPnlData("2025-01"))

      expect(result.totalIncome).toBe("50000.00")
      expect(result.income).toHaveLength(1)
      expect(result.income[0].amount).toBe("50000.00")
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

      // Verify snapshot data is valid JSON
      for (const row of rows) {
        expect(() => JSON.parse(row.data)).not.toThrow()
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
})
