import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, seedCategories } from "./setup"
import fc from "fast-check"
import BigNumber from "bignumber.js"
import { Effect } from "effect"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import {
  getPortfolioData,
  getPnlData,
  getBalanceSheetData,
} from "@/services/report.service"
import { getCurrentMonth } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR = "test-actor"

async function makeCustomer(suffix: string) {
  return Effect.runPromise(
    createCustomer({
      fullName: `Fuzz Customer ${suffix}`,
      nin: `CM${Date.now()}${suffix}`.slice(0, 14),
      contact: "+256700000000",
      address: "Kampala",
    })
  )
}

async function makeLoan(customerId: string, principal: string, rate: string) {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: principal,
        issuanceFee: "0",
        interestRate: rate,
        minInterestDays: 30,
        startDate: new Date().toISOString(),
        collateral: { nature: "Land", description: "Fuzz" },
        disbursementSource: "cash",
      },
      ACTOR
    )
  )
}

// ---------------------------------------------------------------------------
// Custom arbitraries
// ---------------------------------------------------------------------------

const arbPrincipal = fc.integer({ min: 100000, max: 5000000 }).map(String)
const arbRate = fc
  .integer({ min: 100, max: 2000 })
  .map((n) => (n / 10000).toFixed(4))
const arbNumLoans = fc.integer({ min: 1, max: 5 })

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Report Service — Fuzz Integration", () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, 30_000)

  // -----------------------------------------------------------------------
  // 1. Portfolio completeness
  // -----------------------------------------------------------------------

  it(
    "portfolio returns one entry per active loan with correct principal",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(arbPrincipal, arbRate), { minLength: 1, maxLength: 5 }),
          async (loanSpecs) => {
            // Reset state for each property iteration
            await resetDb()
            await seedCategories()

            const created: { loanId: string; principal: string }[] = []

            for (let i = 0; i < loanSpecs.length; i++) {
              const [principal, rate] = loanSpecs[i]
              const customer = await makeCustomer(`comp-${i}-${Date.now()}`)
              const loan = await makeLoan(customer.id, principal, rate)

              created.push({ loanId: loan.id, principal })
            }

            const portfolio = await Effect.runPromise(getPortfolioData())

            // Exactly N entries
            expect(portfolio).toHaveLength(loanSpecs.length)

            // Each principal matches
            for (const entry of portfolio) {
              const match = created.find(
                (c) => c.loanId === entry.loanId
              )
              expect(match).toBeDefined()
              expect(new BigNumber(entry.principalAmount).toFixed(2)).toBe(
                new BigNumber(match!.principal).toFixed(2)
              )
            }
          }
        ),
        { numRuns: 3 }
      )
    },
    120_000
  )

  // -----------------------------------------------------------------------
  // 2. Portfolio balance conservation (before payments)
  // -----------------------------------------------------------------------

  it(
    "sum of outstanding balances equals sum of principals before payments",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(arbPrincipal, arbRate), { minLength: 1, maxLength: 3 }),
          async (loanSpecs) => {
            await resetDb()
            await seedCategories()

            let expectedTotal = new BigNumber(0)

            for (let i = 0; i < loanSpecs.length; i++) {
              const [principal, rate] = loanSpecs[i]
              const customer = await makeCustomer(`bal-${i}-${Date.now()}`)
              await makeLoan(customer.id, principal, rate)
              expectedTotal = expectedTotal.plus(new BigNumber(principal))
            }

            const portfolio = await Effect.runPromise(getPortfolioData())
            const actualTotal = portfolio.reduce(
              (sum, e) => sum.plus(new BigNumber(e.outstandingBalance)),
              new BigNumber(0)
            )

            // Outstanding balances should equal principals (no payments made)
            const diff = expectedTotal.minus(actualTotal).abs()
            expect(diff.isLessThanOrEqualTo(1)).toBe(true)
          }
        ),
        { numRuns: 3 }
      )
    },
    120_000
  )

  // -----------------------------------------------------------------------
  // 3. PnL after payments: interest earned >= 0, basic equation
  // -----------------------------------------------------------------------

  it(
    "PnL interest earned >= 0 and net profit = income - expenses",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(
              arbPrincipal,
              arbRate,
              fc.integer({ min: 1000, max: 500000 }).map(String)
            ),
            { minLength: 1, maxLength: 2 }
          ),
          async (specs) => {
            await resetDb()
            await seedCategories()

            for (let i = 0; i < specs.length; i++) {
              const [principal, rate, paymentAmt] = specs[i]
              const customer = await makeCustomer(`pnl-${i}-${Date.now()}`)
              const loan = await makeLoan(customer.id, principal, rate)

              await Effect.runPromise(
                recordPayment(
                  {
                    loanId: loan.id,
                    paymentDate: new Date().toISOString(),
                    amount: paymentAmt,
                    depositLocation: "cash",
                  },
                  ACTOR
                )
              )
            }

            const period = getCurrentMonth()
            const pnl = await Effect.runPromise(getPnlData(period))

            const totalIncome = new BigNumber(pnl.totalIncome)
            const totalExpenses = new BigNumber(pnl.totalExpenses)
            const netProfit = new BigNumber(pnl.netProfit)

            expect(totalIncome.isGreaterThanOrEqualTo(0)).toBe(true)
            expect(totalExpenses.isGreaterThanOrEqualTo(0)).toBe(true)

            const expectedNet = totalIncome.minus(totalExpenses)
            expect(netProfit.isEqualTo(expectedNet)).toBe(true)
          }
        ),
        { numRuns: 3 }
      )
    },
    120_000
  )

  // -----------------------------------------------------------------------
  // 4. Balance sheet equation: Assets = Liabilities + Equity
  // -----------------------------------------------------------------------

  it(
    "balance sheet identity holds: assets = liabilities + equity",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(
              arbPrincipal,
              arbRate,
              fc.integer({ min: 1000, max: 500000 }).map(String)
            ),
            { minLength: 1, maxLength: 2 }
          ),
          async (specs) => {
            await resetDb()
            await seedCategories()

            for (let i = 0; i < specs.length; i++) {
              const [principal, rate, paymentAmt] = specs[i]
              const customer = await makeCustomer(`bs-${i}-${Date.now()}`)
              const loan = await makeLoan(customer.id, principal, rate)

              await Effect.runPromise(
                recordPayment(
                  {
                    loanId: loan.id,
                    paymentDate: new Date().toISOString(),
                    amount: paymentAmt,
                    depositLocation: "cash",
                  },
                  ACTOR
                )
              )
            }

            const period = getCurrentMonth()
            const bs = await Effect.runPromise(getBalanceSheetData(period))

            const totalAssets = new BigNumber(bs.assets.totalAssets)
            const totalLiabilities = new BigNumber(
              bs.liabilities.totalCreditorBalances
            )
              .plus(new BigNumber(bs.liabilities.interestPayable))
            const totalEquity = new BigNumber(bs.equity.totalEquity)

            const diff = totalAssets
              .minus(totalLiabilities.plus(totalEquity))
              .abs()

            expect(diff.isLessThanOrEqualTo(1)).toBe(true)
          }
        ),
        { numRuns: 3 }
      )
    },
    120_000
  )
})
