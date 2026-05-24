/**
 * Integration Fuzz Tests — Payment Edit Reversal & Ledger Consistency
 *
 * These tests run against the real PostgreSQL database, using fast-check
 * property-based testing to verify that editPayment properly reverses
 * and re-records journal entries, maintaining ledger consistency:
 *
 *   1. Edit amount: ledger matches delete+re-record equivalent
 *   2. Edit preserves non-negative ledger balance
 *   3. Double edit produces correct state
 *   4. Edit date: ledger remains consistent
 *   5. Delete after edit: ledger returns to pre-payment state
 *   6. Payment portions after edit are non-negative
 *
 * Uses fast-check for structured random generation with shrinking.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import fc from "fast-check"
import BigNumber from "bignumber.js"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import {
  recordPayment,
  editPayment,
  deletePayment,
} from "@/services/payment.service"
import {
  getLoanBalancesFromLedger,
  getPaymentPortionsFromLedger,
} from "@/services/ledger-queries.service"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, isNull } from "drizzle-orm"

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

// ─── Test Suite ───────────────────────────────────────────────────

// These tests require a live database connection.
// Run with: npx vitest run --config vitest.integration.config.ts src/services/__integration__/fuzz-payment-edit.test.ts
describe("Integration Fuzz: Payment Edit Reversal", { timeout: 120_000, sequential: true }, () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, TEST_TIMEOUT)

  it("edit amount: ledger balance matches re-recorded equivalent", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50000, max: 300000 }),
        async (newAmount) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Record initial payment
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Edit payment to new amount
          const edited = await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, amount: String(newAmount), reason: "fuzz edit" },
              ACTOR
            )
          )

          // Capture ledger balance after edit
          const balancesAfterEdit = await getLoanBalancesFromLedger([loan.id])
          const balanceAfterEdit = balancesAfterEdit.get(loan.id) ?? new BigNumber(0)

          // Delete the edited payment
          await Effect.runPromise(
            deletePayment({ paymentId: edited.id, reason: "fuzz delete" }, ACTOR)
          )

          // Re-record a fresh payment with the new amount
          await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: String(newAmount), depositLocation: "cash" },
              ACTOR
            )
          )

          // Capture ledger balance after delete+re-record
          const balancesAfterReRecord = await getLoanBalancesFromLedger([loan.id])
          const balanceAfterReRecord = balancesAfterReRecord.get(loan.id) ?? new BigNumber(0)

          // They should match within tolerance
          const diff = balanceAfterEdit.minus(balanceAfterReRecord).abs()
          expect(diff.isLessThanOrEqualTo(2)).toBe(true)
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("edit preserves non-negative ledger balance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10000, max: 500000 }),
        async (newAmount) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Record initial payment
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Edit with random amount
          await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, amount: String(newAmount), reason: "fuzz edit" },
              ACTOR
            )
          )

          // Verify ledger balance is non-negative
          const balances = await getLoanBalancesFromLedger([loan.id])
          const balance = balances.get(loan.id) ?? new BigNumber(0)
          expect(balance.isGreaterThanOrEqualTo(0)).toBe(true)
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("edit-then-edit: double edit produces correct state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50000, max: 400000 }),
        fc.integer({ min: 50000, max: 400000 }),
        async (amountA, amountB) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Record initial payment
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Edit to amount A
          const editedA = await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, amount: String(amountA), reason: "fuzz edit A" },
              ACTOR
            )
          )

          // Edit to amount B
          await Effect.runPromise(
            editPayment(
              { paymentId: editedA.id, amount: String(amountB), reason: "fuzz edit B" },
              ACTOR
            )
          )

          // Verify ledger balance is non-negative after double edit
          const balances = await getLoanBalancesFromLedger([loan.id])
          const balance = balances.get(loan.id) ?? new BigNumber(0)
          expect(balance.isGreaterThanOrEqualTo(0)).toBe(true)

          // Verify payment portions are non-negative
          const activePayments = await testDb
            .select()
            .from(payments)
            .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))

          if (activePayments.length > 0) {
            const portions = await getPaymentPortionsFromLedger(activePayments.map((p) => p.id))
            for (const [, portion] of portions) {
              const interest = new BigNumber(portion.interestPortion)
              const principal = new BigNumber(portion.principalPortion)
              expect(interest.isGreaterThanOrEqualTo(0)).toBe(true)
              expect(principal.isGreaterThanOrEqualTo(0)).toBe(true)
            }
          }
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("edit date: ledger remains consistent", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Random day offset from Jan 2 to Feb 27 (day 2 to day 58 of 2025)
        fc.integer({ min: 2, max: 58 }),
        async (dayOfYear) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Record payment on Feb 28
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-02-28", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Compute new date from day of year (2025-01-02 to 2025-02-27)
          const newDate = new Date(2025, 0, dayOfYear)
          const newDateStr = newDate.toISOString().slice(0, 10)

          // Edit payment date to the random earlier date
          await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, paymentDate: newDateStr, reason: "fuzz date edit" },
              ACTOR
            )
          )

          // Verify ledger balance is non-negative
          const balances = await getLoanBalancesFromLedger([loan.id])
          const balance = balances.get(loan.id) ?? new BigNumber(0)
          expect(balance.isGreaterThanOrEqualTo(0)).toBe(true)
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("delete after edit: ledger returns to pre-payment state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50000, max: 400000 }),
        async (newAmount) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Capture ledger balance before any payment (should equal principal)
          const balancesBefore = await getLoanBalancesFromLedger([loan.id])
          const balanceBefore = balancesBefore.get(loan.id) ?? new BigNumber(0)

          // Record payment
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Edit payment
          const edited = await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, amount: String(newAmount), reason: "fuzz edit" },
              ACTOR
            )
          )

          // Delete the edited payment
          await Effect.runPromise(
            deletePayment({ paymentId: edited.id, reason: "fuzz delete after edit" }, ACTOR)
          )

          // Ledger balance should return to original principal
          const balancesAfter = await getLoanBalancesFromLedger([loan.id])
          const balanceAfter = balancesAfter.get(loan.id) ?? new BigNumber(0)

          const diff = balanceAfter.minus(balanceBefore).abs()
          expect(diff.isLessThanOrEqualTo(1)).toBe(true)
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)

  it("payment portions after edit are non-negative", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50000, max: 400000 }),
        async (newAmount) => {
          await resetDb()
          await seedCategories()

          const customer = await makeCustomer()
          const loan = await makeLoan(customer.id, "1000000", "0.10", "2025-01-01")

          // Record payment
          const payment = await Effect.runPromise(
            recordPayment(
              { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
              ACTOR
            )
          )

          // Edit payment
          const edited = await Effect.runPromise(
            editPayment(
              { paymentId: payment.id, amount: String(newAmount), reason: "fuzz edit" },
              ACTOR
            )
          )

          // Fetch payment portions from ledger
          const portions = await getPaymentPortionsFromLedger([edited.id])
          const portion = portions.get(edited.id)

          expect(portion).toBeDefined()
          if (portion) {
            const interest = new BigNumber(portion.interestPortion)
            const principal = new BigNumber(portion.principalPortion)
            expect(interest.isGreaterThanOrEqualTo(0)).toBe(true)
            expect(principal.isGreaterThanOrEqualTo(0)).toBe(true)
          }
        }
      ),
      { numRuns: 3 }
    )
  }, TEST_TIMEOUT)
})
