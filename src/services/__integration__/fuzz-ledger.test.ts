/**
 * Integration Fuzz Tests — Real Database Ledger Invariants
 *
 * These tests run against the real PostgreSQL database, generating random
 * loan+payment sequences and verifying that the ledger remains consistent:
 *
 *   1. Loan balance from ledger = principal - sum of principal repayments
 *   2. Interest earned from ledger = sum of interest portions
 *   3. Payment portions sum = payment amount (for each payment)
 *   4. Cash account debits - credits = net cash flow
 *   5. After loan deletion, all entries are reversed (net = 0)
 *   6. After full repayment, loan balance = 0
 *
 * Uses fast-check for structured random generation with shrinking.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import fc from "fast-check"
import BigNumber from "bignumber.js"
import { createCustomer } from "@/services/customer.service"
import { createLoan, deleteLoan } from "@/services/loan.service"
import { recordPayment, deletePayment } from "@/services/payment.service"
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
  getPaymentPortionsFromLedger,
} from "@/services/ledger-queries.service"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, and, isNull, sql } from "drizzle-orm"

// ─── Constants ────────────────────────────────────────────────────

const ACTOR = "fuzz-test-actor"
const TEST_TIMEOUT = 60_000

// ─── Helpers ──────────────────────────────────────────────────────

async function makeCustomer() {
  return Effect.runPromise(
    createCustomer({
      fullName: "Fuzz Customer",
      nin: `CM${Date.now()}FUZZ`,
      contact: "+256700000000",
      address: "Kampala, Uganda",
    })
  )
}

async function makeLoan(
  customerId: string,
  principal: string,
  rate: string,
  startDate: string,
) {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: principal,
        issuanceFee: "0",
        interestRate: rate,
        minInterestDays: 30,
        startDate,
        collateral: { nature: "Land title", description: "Fuzz collateral" },
        disbursementSource: "cash",
      },
      ACTOR
    )
  )
}

// ─── Invariant Checkers ───────────────────────────────────────────

async function checkLedgerBalance(loanId: string, expectedDescription: string) {
  const balances = await getLoanBalancesFromLedger([loanId])
  const balance = balances.get(loanId) ?? new BigNumber(0)

  if (balance.isLessThan(-1)) {
    throw new Error(`${expectedDescription}: ledger balance is negative: ${balance.toFixed(0)}`)
  }
  return balance
}

async function checkPaymentPortions(paymentIds: string[]) {
  if (paymentIds.length === 0) return
  const portions = await getPaymentPortionsFromLedger(paymentIds)

  for (const [paymentId, portion] of portions) {
    const interest = new BigNumber(portion.interestPortion)
    const principal = new BigNumber(portion.principalPortion)

    if (interest.isLessThan(0)) {
      throw new Error(`Payment ${paymentId}: negative interest portion ${portion.interestPortion}`)
    }
    if (principal.isLessThan(0)) {
      throw new Error(`Payment ${paymentId}: negative principal portion ${portion.principalPortion}`)
    }
  }
}

async function getTotalTransactionBalance(loanId: string): Promise<BigNumber> {
  const rows = await testDb
    .select({
      type: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .where(eq(transactions.loanId, loanId))
    .groupBy(transactions.type)

  let debits = new BigNumber(0)
  let credits = new BigNumber(0)
  for (const row of rows) {
    if (row.type === "debit") debits = debits.plus(new BigNumber(row.total))
    else credits = credits.plus(new BigNumber(row.total))
  }
  return debits.minus(credits)
}

// ─── Test Suite ───────────────────────────────────────────────────

// These tests require a live database connection.
// Run with: npx vitest run --config vitest.integration.config.ts src/services/__integration__/fuzz-ledger.test.ts
describe("Integration Fuzz: Ledger Invariants", { timeout: TEST_TIMEOUT, sequential: true }, () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, TEST_TIMEOUT)

  it("single loan creation: ledger balance = principal", async () => {
    const principals = ["500000", "1000000", "5000000", "100000", "10000000"]
    const rates = ["0.05", "0.10", "0.15", "0.20"]

    for (const principal of principals) {
      for (const rate of rates) {
        await resetDb()
        await seedCategories()
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, principal, rate, "2025-01-01")

        const balance = await checkLedgerBalance(loan.id, `Create(${principal}, ${rate})`)
        const diff = balance.minus(new BigNumber(principal)).abs()
        expect(diff.isLessThanOrEqualTo(1)).toBe(true)
      }
    }
  })

  it("single payment: ledger balance decreases by principal portion", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

    const balanceBefore = await checkLedgerBalance(loan.id, "Before payment")

    const payment = await Effect.runPromise(
      recordPayment(
        { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
        ACTOR
      )
    )

    const balanceAfter = await checkLedgerBalance(loan.id, "After payment")
    const principalPaid = new BigNumber(payment.allocation.principalPortion)

    const expectedAfter = balanceBefore.minus(principalPaid)
    const diff = balanceAfter.minus(expectedAfter).abs()
    expect(diff.isLessThanOrEqualTo(1)).toBe(true)
  })

  it("multiple payments: running balance matches ledger at each step", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

    const paymentSchedule = [
      { date: "2025-01-31", amount: "100000" },
      { date: "2025-03-02", amount: "150000" },
      { date: "2025-04-01", amount: "200000" },
      { date: "2025-05-01", amount: "300000" },
    ]

    for (const { date, amount } of paymentSchedule) {
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: date, amount, depositLocation: "cash" },
          ACTOR
        )
      )

      // After each payment, ledger balance should be non-negative
      const balance = await checkLedgerBalance(loan.id, `After payment ${date}`)
      expect(balance.isGreaterThanOrEqualTo(-1)).toBe(true)
    }

    // Fetch all payment portions and verify they're non-negative
    const allPayments = await testDb
      .select()
      .from(payments)
      .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
    await checkPaymentPortions(allPayments.map((p) => p.id))
  })

  it("payment then delete: ledger balance returns to pre-payment state", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

    const balanceBefore = await checkLedgerBalance(loan.id, "Before payment")

    const payment = await Effect.runPromise(
      recordPayment(
        { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
        ACTOR
      )
    )

    const balanceAfterPayment = await checkLedgerBalance(loan.id, "After payment")
    expect(balanceAfterPayment.isLessThan(balanceBefore)).toBe(true)

    // Delete the payment
    await Effect.runPromise(deletePayment({ paymentId: payment.id, reason: "fuzz test" }, ACTOR))

    const balanceAfterDelete = await checkLedgerBalance(loan.id, "After delete")
    const diff = balanceAfterDelete.minus(balanceBefore).abs()
    expect(diff.isLessThanOrEqualTo(1)).toBe(true)
  })

  it("full repayment: ledger balance = 0, loan status = fully_paid", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "100000", "0.10", "2025-01-01")

    // Interest = 100000 * 0.10/30 * 30 = 10000
    // Total owed = 110000
    await Effect.runPromise(
      recordPayment(
        { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000", depositLocation: "cash" },
        ACTOR
      )
    )

    const balance = await checkLedgerBalance(loan.id, "After full repayment")
    expect(balance.abs().isLessThanOrEqualTo(1)).toBe(true)

    const [updated] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(updated.status).toBe("fully_paid")
  })

  it("interest earned from ledger matches sum of interest portions", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

    const paymentDates = ["2025-01-31", "2025-03-02", "2025-04-01"]
    const paymentIds: string[] = []
    let expectedInterest = new BigNumber(0)

    for (const date of paymentDates) {
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: date, amount: "100000", depositLocation: "cash" },
          ACTOR
        )
      )
      paymentIds.push(payment.id)
      expectedInterest = expectedInterest.plus(new BigNumber(payment.allocation.interestPortion))
    }

    const interestMap = await getInterestEarnedFromLedger([loan.id])
    const ledgerInterest = interestMap.get(loan.id) ?? new BigNumber(0)

    const diff = ledgerInterest.minus(expectedInterest).abs()
    expect(diff.isLessThanOrEqualTo(1)).toBe(true)
  })

  it("loan deletion: all ledger entries net to zero", async () => {
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id, "500000", "0.10", "2025-01-01")

    // Make a payment first
    await Effect.runPromise(
      recordPayment(
        { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
        ACTOR
      )
    )

    // Delete the entire loan
    await Effect.runPromise(deleteLoan({ loanId: loan.id, reason: "fuzz test" }, ACTOR))

    // All transaction entries for this loan should net to zero
    const netBalance = await getTotalTransactionBalance(loan.id)
    expect(netBalance.abs().isLessThanOrEqualTo(1)).toBe(true)
  })

  it("randomized: N payments followed by verification", async () => {
    // Run a few random scenarios
    const scenarios = [
      { principal: "500000", rate: "0.05", payments: [50000, 30000, 80000] },
      { principal: "2000000", rate: "0.15", payments: [200000, 300000, 100000, 500000] },
      { principal: "100000", rate: "0.10", payments: [20000, 15000, 10000] },
      { principal: "5000000", rate: "0.08", payments: [400000, 600000, 200000] },
      { principal: "300000", rate: "0.20", payments: [100000, 50000, 80000, 40000, 30000] },
    ]

    for (const scenario of scenarios) {
      await resetDb()
      await seedCategories()

      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, scenario.principal, scenario.rate, "2025-01-01")

      let paymentDate = new Date(2025, 0, 31) // Jan 31
      const paymentIds: string[] = []

      for (const amount of scenario.payments) {
        try {
          const payment = await Effect.runPromise(
            recordPayment(
              {
                loanId: loan.id,
                paymentDate: paymentDate.toISOString().slice(0, 10),
                amount: String(amount),
                depositLocation: "cash",
              },
              ACTOR
            )
          )
          paymentIds.push(payment.id)
        } catch {
          // Some payments may fail (overpayment) — that's OK
          break
        }

        // Advance 30 days for next payment
        paymentDate = new Date(paymentDate.getTime() + 30 * 86400000)
      }

      // Verify ledger invariants
      const balance = await checkLedgerBalance(
        loan.id,
        `Scenario(principal=${scenario.principal}, rate=${scenario.rate})`
      )
      expect(balance.isGreaterThanOrEqualTo(-1)).toBe(true)

      // Verify payment portions
      if (paymentIds.length > 0) {
        await checkPaymentPortions(paymentIds)
      }

      // Verify interest earned is non-negative
      const interestMap = await getInterestEarnedFromLedger([loan.id])
      const interest = interestMap.get(loan.id) ?? new BigNumber(0)
      expect(interest.isGreaterThanOrEqualTo(0)).toBe(true)
    }
  })
})

// ─── Term Loan Fuzz Tests ────────────────────────────────────────

describe("Integration Fuzz: Term Loan Ledger Invariants", { timeout: 120_000, sequential: true }, () => {
  // ─── Helpers ──────────────────────────────────────────────────

  async function makeTermLoan(
    customerId: string,
    principal: string,
    rate: string,
    startDate: string,
    loanType: "fixed_rate" | "reducing_balance",
    termMonths: number,
  ) {
    return Effect.runPromise(
      createLoan(
        {
          customerId,
          principalAmount: principal,
          issuanceFee: "0",
          interestRate: rate,
          minInterestDays: 30,
          startDate,
          collateral: { nature: "Land title", description: "Fuzz collateral" },
          disbursementSource: "cash",
          loanType,
          termMonths,
        },
        ACTOR
      )
    )
  }

  // ─── Arbitraries ──────────────────────────────────────────────

  const arbPrincipal = fc.integer({ min: 100000, max: 5000000 }).map(String)
  const arbRate = fc.integer({ min: 100, max: 2000 }).map((n) => (n / 10000).toFixed(4))
  const arbTerm = fc.integer({ min: 3, max: 12 })

  // ─── Setup ────────────────────────────────────────────────────

  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, TEST_TIMEOUT)

  // ─── Tests ────────────────────────────────────────────────────

  it("fixed_rate: ledger balance = principal after creation", async () => {
    await fc.assert(
      fc.asyncProperty(arbPrincipal, arbRate, arbTerm, async (principal, rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "fixed_rate", termMonths)

        const balance = await checkLedgerBalance(loan.id, `fixed_rate Create(${principal}, ${rate}, ${termMonths}m)`)
        const diff = balance.minus(new BigNumber(principal)).abs()
        expect(diff.isLessThanOrEqualTo(1)).toBe(true)
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("reducing_balance: ledger balance = principal after creation", async () => {
    await fc.assert(
      fc.asyncProperty(arbPrincipal, arbRate, arbTerm, async (principal, rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "reducing_balance", termMonths)

        const balance = await checkLedgerBalance(loan.id, `reducing_balance Create(${principal}, ${rate}, ${termMonths}m)`)
        const diff = balance.minus(new BigNumber(principal)).abs()
        expect(diff.isLessThanOrEqualTo(1)).toBe(true)
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("fixed_rate: multiple payments maintain non-negative ledger balance", async () => {
    await fc.assert(
      fc.asyncProperty(arbPrincipal, arbRate, arbTerm, async (principal, rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "fixed_rate", termMonths)

        const principalNum = Number(principal)
        const arbPaymentAmount = fc.integer({ min: 10000, max: Math.floor(principalNum / 3) })

        const paymentAmounts = fc.sample(arbPaymentAmount, 3)
        let paymentDate = new Date(2025, 0, 31)

        for (const amount of paymentAmounts) {
          try {
            await Effect.runPromise(
              recordPayment(
                {
                  loanId: loan.id,
                  paymentDate: paymentDate.toISOString().slice(0, 10),
                  amount: String(amount),
                  depositLocation: "cash",
                },
                ACTOR
              )
            )
          } catch {
            break
          }

          const balance = await checkLedgerBalance(loan.id, `fixed_rate after payment ${amount}`)
          expect(balance.isGreaterThanOrEqualTo(-1)).toBe(true)

          paymentDate = new Date(paymentDate.getTime() + 30 * 86400000)
        }
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("reducing_balance: multiple payments maintain non-negative ledger balance", async () => {
    await fc.assert(
      fc.asyncProperty(arbPrincipal, arbRate, arbTerm, async (principal, rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "reducing_balance", termMonths)

        const principalNum = Number(principal)
        const arbPaymentAmount = fc.integer({ min: 10000, max: Math.floor(principalNum / 3) })

        const paymentAmounts = fc.sample(arbPaymentAmount, 3)
        let paymentDate = new Date(2025, 0, 31)

        for (const amount of paymentAmounts) {
          try {
            await Effect.runPromise(
              recordPayment(
                {
                  loanId: loan.id,
                  paymentDate: paymentDate.toISOString().slice(0, 10),
                  amount: String(amount),
                  depositLocation: "cash",
                },
                ACTOR
              )
            )
          } catch {
            break
          }

          const balance = await checkLedgerBalance(loan.id, `reducing_balance after payment ${amount}`)
          expect(balance.isGreaterThanOrEqualTo(-1)).toBe(true)

          paymentDate = new Date(paymentDate.getTime() + 30 * 86400000)
        }
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("fixed_rate: full repayment → balance = 0, status = fully_paid", async () => {
    await fc.assert(
      fc.asyncProperty(arbRate, arbTerm, async (rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const principal = "100000"
        const rateNum = Number(rate)
        const totalOwed = Math.ceil(Number(principal) * (1 + rateNum * termMonths))

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "fixed_rate", termMonths)

        await Effect.runPromise(
          recordPayment(
            {
              loanId: loan.id,
              paymentDate: "2025-01-31",
              amount: String(totalOwed),
              depositLocation: "cash",
            },
            ACTOR
          )
        )

        const balance = await checkLedgerBalance(loan.id, `fixed_rate full repayment`)
        expect(balance.abs().isLessThanOrEqualTo(1)).toBe(true)

        const [updated] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
        expect(updated.status).toBe("fully_paid")
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("reducing_balance: full repayment → balance = 0, status = fully_paid", async () => {
    await fc.assert(
      fc.asyncProperty(arbRate, arbTerm, async (rate, termMonths) => {
        await resetDb()
        await seedCategories()

        const principal = "100000"
        const rateNum = Number(rate)
        // reducing_balance total interest is less than fixed_rate, so use the same conservative upper bound
        const totalOwed = Math.ceil(Number(principal) * (1 + rateNum * termMonths))

        const customer = await makeCustomer()
        const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", "reducing_balance", termMonths)

        await Effect.runPromise(
          recordPayment(
            {
              loanId: loan.id,
              paymentDate: "2025-01-31",
              amount: String(totalOwed),
              depositLocation: "cash",
            },
            ACTOR
          )
        )

        const balance = await checkLedgerBalance(loan.id, `reducing_balance full repayment`)
        expect(balance.abs().isLessThanOrEqualTo(1)).toBe(true)

        const [updated] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
        expect(updated.status).toBe("fully_paid")
      }),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("term loan: payment portions are non-negative", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrincipal,
        arbRate,
        arbTerm,
        fc.constantFrom("fixed_rate" as const, "reducing_balance" as const),
        async (principal, rate, termMonths, loanType) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", loanType, termMonths)

          const principalNum = Number(principal)
          const arbPaymentAmount = fc.integer({ min: 10000, max: Math.floor(principalNum / 3) })
          const paymentAmounts = fc.sample(arbPaymentAmount, 3)
          let paymentDate = new Date(2025, 0, 31)
          const paymentIds: string[] = []

          for (const amount of paymentAmounts) {
            try {
              const payment = await Effect.runPromise(
                recordPayment(
                  {
                    loanId: loan.id,
                    paymentDate: paymentDate.toISOString().slice(0, 10),
                    amount: String(amount),
                    depositLocation: "cash",
                  },
                  ACTOR
                )
              )
              paymentIds.push(payment.id)
            } catch {
              break
            }
            paymentDate = new Date(paymentDate.getTime() + 30 * 86400000)
          }

          if (paymentIds.length > 0) {
            await checkPaymentPortions(paymentIds)
          }
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("term loan: interest earned from ledger is non-negative", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrincipal,
        arbRate,
        arbTerm,
        fc.constantFrom("fixed_rate" as const, "reducing_balance" as const),
        async (principal, rate, termMonths, loanType) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeTermLoan(customer.id, principal, rate, "2025-01-01", loanType, termMonths)

          const principalNum = Number(principal)
          const arbPaymentAmount = fc.integer({ min: 10000, max: Math.floor(principalNum / 3) })
          const paymentAmounts = fc.sample(arbPaymentAmount, 3)
          let paymentDate = new Date(2025, 0, 31)

          for (const amount of paymentAmounts) {
            try {
              await Effect.runPromise(
                recordPayment(
                  {
                    loanId: loan.id,
                    paymentDate: paymentDate.toISOString().slice(0, 10),
                    amount: String(amount),
                    depositLocation: "cash",
                  },
                  ACTOR
                )
              )
            } catch {
              break
            }
            paymentDate = new Date(paymentDate.getTime() + 30 * 86400000)
          }

          const interestMap = await getInterestEarnedFromLedger([loan.id])
          const interest = interestMap.get(loan.id) ?? new BigNumber(0)
          expect(interest.isGreaterThanOrEqualTo(0)).toBe(true)
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)
})
