import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import {
  getDailyCollections,
  getLoansDueToday,
} from "@/services/daily-collections.service"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import { loans } from "@/lib/db/schema/loans"
import { eq } from "drizzle-orm"

const ACTOR_ID = "integration-test-actor"

async function makeCustomer(overrides: { fullName?: string; contact?: string } = {}) {
  return Effect.runPromise(
    createCustomer({
      fullName: overrides.fullName ?? "Test Customer",
      nin: "CM00000000TEST",
      contact: overrides.contact ?? "+256700000000",
      address: "Kampala, Uganda",
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
    startDate: "2025-12-01T00:00:00.000Z",
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
    ...overrides,
  }
}

const TEST_TIMEOUT = 30_000

describe("Daily Collections Service — Integration", { timeout: TEST_TIMEOUT, sequential: true }, () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, TEST_TIMEOUT)

  // =========================================================================
  // getDailyCollections
  // =========================================================================

  describe("getDailyCollections", () => {
    it("returns correct aggregation for payments inserted on a specific date", async () => {
      const customer = await makeCustomer({ fullName: "Collection Customer" })
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, { startDate: "2025-01-01T00:00:00.000Z" }),
          ACTOR_ID
        )
      )

      // Insert payments at UTC noon to avoid Africa/Kampala timezone boundary ambiguity.
      // Africa/Kampala is UTC+3, so T09:00:00Z = 12:00 noon Kampala time,
      // safely within the 2026-03-23 date in Kampala timezone.
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: "2026-03-23T09:00:00.000Z",
            amount: "150000.00",
          },
          ACTOR_ID
        )
      )
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: "2026-03-23T10:00:00.000Z",
            amount: "150000.00",
          },
          ACTOR_ID
        )
      )

      const result = await Effect.runPromise(getDailyCollections("2026-03-23"))

      expect(result.date).toBe("2026-03-23")
      expect(result.paymentCount).toBe(2)
      expect(result.rows).toHaveLength(2)
      // Both payments = 300000.00 total
      const total = parseFloat(result.totalCollected)
      expect(total).toBeGreaterThanOrEqual(300000)
      expect(result.rows[0].customerName).toBe("Collection Customer")
    })

    it("returns empty summary for a date with no payments", async () => {
      const customer = await makeCustomer()
      await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id),
          ACTOR_ID
        )
      )

      // No payments inserted for 2026-01-01
      const result = await Effect.runPromise(getDailyCollections("2026-01-01"))

      expect(result.date).toBe("2026-01-01")
      expect(result.totalCollected).toBe("0.00")
      expect(result.paymentCount).toBe(0)
      expect(result.rows).toEqual([])
    })

    it("excludes soft-deleted payments from aggregation", async () => {
      const customer = await makeCustomer({ fullName: "Delete Test Customer", contact: "+256700000001" })
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, { startDate: "2025-01-01T00:00:00.000Z" }),
          ACTOR_ID
        )
      )

      // Insert a payment, then soft-delete it
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: "2026-03-22T09:00:00.000Z",
            amount: "200000.00",
          },
          ACTOR_ID
        )
      )

      // Soft-delete the payment using the deletePayment service
      const { deletePayment } = await import("@/services/payment.service")
      const allPayments = await testDb.select().from((await import("@/lib/db/schema/payments")).payments).where(eq((await import("@/lib/db/schema/payments")).payments.loanId, loan.id))
      await Effect.runPromise(
        deletePayment({ paymentId: allPayments[0].id, reason: "Test deletion" }, ACTOR_ID)
      )

      const result = await Effect.runPromise(getDailyCollections("2026-03-22"))

      expect(result.totalCollected).toBe("0.00")
      expect(result.paymentCount).toBe(0)
    })
  })

  // =========================================================================
  // getLoansDueToday
  // =========================================================================

  describe("getLoansDueToday", () => {
    it("returns active loans with no payment in 30+ days using start date", async () => {
      const customer = await makeCustomer({ fullName: "Overdue Customer" })

      // Loan started far in the past, no payments
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, { startDate: "2025-12-01T00:00:00.000Z" }),
          ACTOR_ID
        )
      )

      const result = await Effect.runPromise(getLoansDueToday())

      expect(result.length).toBeGreaterThanOrEqual(1)
      const entry = result.find((e) => e.loanId === loan.id)
      expect(entry).toBeDefined()
      expect(entry!.customerId).toBe(customer.id)
      expect(entry!.customerName).toBe("Overdue Customer")
      expect(entry!.loanAmount).toBe("1000000.00")
      expect(entry!.outstandingBalance).toBe("1000000.00")
      expect(entry!.daysSinceLastPayment).toBeGreaterThanOrEqual(30)
      expect(entry!.lastPaymentDate).toBeNull()
    })

    it("excludes fully_paid loans", async () => {
      const customer = await makeCustomer({ fullName: "Paid Customer", contact: "+256700000002" })

      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, { startDate: "2025-12-01T00:00:00.000Z" }),
          ACTOR_ID
        )
      )

      // Mark loan as fully_paid
      await testDb
        .update(loans)
        .set({ status: "fully_paid" })
        .where(eq(loans.id, loan.id))

      const result = await Effect.runPromise(getLoansDueToday())
      const entry = result.find((e) => e.loanId === loan.id)
      expect(entry).toBeUndefined()
    })

    it("excludes loans with recent payment (< 30 days)", async () => {
      const customer = await makeCustomer({ fullName: "Recent Payer", contact: "+256700000003" })
      const loan = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer.id, { startDate: "2025-01-01T00:00:00.000Z" }),
          ACTOR_ID
        )
      )

      // Make a recent payment (yesterday)
      const now = new Date()
      const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
      await Effect.runPromise(
        recordPayment(
          {
            loanId: loan.id,
            paymentDate: yesterday.toISOString(),
            amount: "100000.00",
          },
          ACTOR_ID
        )
      )

      const result = await Effect.runPromise(getLoansDueToday())
      const entry = result.find((e) => e.loanId === loan.id)
      expect(entry).toBeUndefined()
    })

    it("sorts results by daysSinceLastPayment descending", async () => {
      const customer1 = await makeCustomer({ fullName: "Customer One", contact: "+256700000004" })
      const customer2 = await makeCustomer({ fullName: "Customer Two", contact: "+256700000005" })

      // Loan 1: started 60 days ago
      const now = new Date()
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      const loan1 = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer1.id, { startDate: sixtyDaysAgo.toISOString() }),
          ACTOR_ID
        )
      )

      // Loan 2: started 120 days ago (more overdue)
      const oneHundredTwentyDaysAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000)
      const loan2 = await Effect.runPromise(
        createLoan(
          baseLoanInput(customer2.id, { startDate: oneHundredTwentyDaysAgo.toISOString() }),
          ACTOR_ID
        )
      )

      const result = await Effect.runPromise(getLoansDueToday())

      const idx1 = result.findIndex((e) => e.loanId === loan1.id)
      const idx2 = result.findIndex((e) => e.loanId === loan2.id)
      expect(idx1).toBeGreaterThan(-1)
      expect(idx2).toBeGreaterThan(-1)
      // Loan2 (more overdue) should come before loan1
      expect(idx2).toBeLessThan(idx1)
      expect(result[idx2].daysSinceLastPayment).toBeGreaterThan(
        result[idx1].daysSinceLastPayment
      )
    })
  })
})
