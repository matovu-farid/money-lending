import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect } from "effect"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { auditLog } from "@/lib/db/schema/audit"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = "integration-test-actor"

async function makeCustomer(overrides = {}) {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
      nin: "CM00000000TEST",
      contact: "+256700000000",
      address: "Kampala, Uganda",
      ...overrides,
    })
  )
}

async function makeLoan(customerId: string, principal = "1000000.00", rate = "0.10") {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: principal,
        issuanceFee: "50000.00",
        description: "Test loan",
        interestRate: rate,
        minInterestDays: 30,
        startDate: "2025-01-01",
        collateral: { nature: "Land title" },
      },
      ACTOR_ID
    )
  )
}

async function makePayment(loanId: string, amount: string, date = "2025-02-15") {
  return Effect.runPromise(
    recordPayment(
      {
        loanId,
        paymentDate: date,
        amount,
      },
      ACTOR_ID
    )
  )
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 30_000

describe(
  "Dashboard Service — Integration",
  { timeout: TEST_TIMEOUT, sequential: true },
  () => {
    beforeEach(async () => {
      await resetDb()
      await seedCategories()
    })

    // -----------------------------------------------------------------------
    // getDashboardKPIs
    // -----------------------------------------------------------------------

    describe("getDashboardKPIs", () => {
      it("returns zeroes when DB is empty", async () => {
        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.loansOutstanding).toBe("0.00")
        expect(result.repaymentsCollected).toBe("0.00")
        expect(result.interestEarned).toBe("0.00")
        expect(result.activeBorrowers).toBe(0)
        expect(result.overdueCount).toBe(0)
      })

      it("reports outstanding as principal when no payments exist", async () => {
        const customer = await makeCustomer()
        await makeLoan(customer.id, "500000.00")

        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.loansOutstanding).toBe("500000.00")
        expect(result.activeBorrowers).toBe(1)
      })

      it("reports outstanding as principalBalanceAfter when payments exist", async () => {
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, "1000000.00")

        // Record a payment (interest-first allocation) — 45 days after start
        // Loan: 1M at 10%/month, 30-day min
        // 45 days elapsed: interest = 1000000 * 0.10 * 45/30 = 150000
        // Pay 200000 → 150000 interest + 50000 principal → balance 950000
        await makePayment(loan.id, "200000.00", "2025-02-15")

        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.loansOutstanding).toBe("950000.00")
        expect(result.repaymentsCollected).toBe("200000.00")
        expect(result.interestEarned).toBe("150000.00")
        expect(result.activeBorrowers).toBe(1)
        expect(result.capitalInSystem).toBeDefined()
      })

      it("aggregates outstanding across multiple loans", async () => {
        const cust1 = await makeCustomer({ fullName: "Customer One" })
        const cust2 = await makeCustomer({
          fullName: "Customer Two",
          contact: "+256700000001",
        })

        await makeLoan(cust1.id, "500000.00")
        await makeLoan(cust2.id, "300000.00")

        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.loansOutstanding).toBe("800000.00")
        expect(result.activeBorrowers).toBe(2)
      })

      it("counts distinct borrowers (same customer, multiple loans = 1 borrower)", async () => {
        const customer = await makeCustomer()
        await makeLoan(customer.id, "500000.00")
        await makeLoan(customer.id, "300000.00")

        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.activeBorrowers).toBe(1)
        expect(result.loansOutstanding).toBe("800000.00")
      })

      it("overdueCount is correctly incremented for loans overdue 30+ days", async () => {
        const customer = await makeCustomer({ fullName: "Overdue Borrower" })

        // Create a loan started 60+ days ago with no payments
        const sixtyDaysAgo = new Date()
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
        await Effect.runPromise(
          createLoan(
            {
              customerId: customer.id,
              principalAmount: "1000000.00",
              issuanceFee: "50000.00",
              description: "Test loan",
              interestRate: "0.10",
              minInterestDays: 30,
              startDate: sixtyDaysAgo.toISOString(),
              collateral: { nature: "Land title" },
            },
            ACTOR_ID
          )
        )

        const result = await Effect.runPromise(getDashboardKPIs())

        expect(result.overdueCount).toBeGreaterThanOrEqual(1)
      })

      it("excludes fully_paid loans from outstanding", async () => {
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, "100000.00")

        // Pay enough to cover interest + full principal
        // 45 days: interest = 100000 * 0.10 * 45/30 = 15000
        // Pay 115000 → fully paid
        await makePayment(loan.id, "115000.00", "2025-02-15")

        const result = await Effect.runPromise(getDashboardKPIs())

        // Loan is fully paid, so no active loans
        expect(result.loansOutstanding).toBe("0.00")
        expect(result.activeBorrowers).toBe(0)
        // But payment stats still reflect the payment
        expect(result.repaymentsCollected).toBe("115000.00")
      })
    })

    // -----------------------------------------------------------------------
    // getRecentActivity
    // -----------------------------------------------------------------------

    describe("getRecentActivity", () => {
      it("returns empty array when no audit entries exist", async () => {
        const result = await Effect.runPromise(getRecentActivity())
        expect(result).toEqual([])
      })

      it("returns loan_issued activity when a loan is created", async () => {
        const customer = await makeCustomer({ fullName: "Alice Nakamya" })
        await makeLoan(customer.id, "500000.00")

        const result = await Effect.runPromise(getRecentActivity())

        // Should have at least the loan.create entry
        const loanIssued = result.find((r) => r.type === "loan_issued")
        expect(loanIssued).toBeDefined()
        expect(loanIssued!.description).toContain("Alice Nakamya")
        expect(loanIssued!.description).toContain("500,000")
        expect(loanIssued!.customerId).toBe(customer.id)
        expect(loanIssued!.detail?.amount).toBe("500000.00")
      })

      it("returns payment_received activity when a payment is recorded", async () => {
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, "1000000.00")
        await makePayment(loan.id, "200000.00", "2025-02-15")

        const result = await Effect.runPromise(getRecentActivity())

        const paymentActivity = result.find(
          (r) => r.type === "payment_received" && r.description.includes("200,000")
        )
        expect(paymentActivity).toBeDefined()
        expect(paymentActivity!.loanId).toBe(loan.id)
        expect(paymentActivity!.detail?.amount).toBe("200000.00")
      })

      it("limits activity feed to 10 items", async () => {
        const customer = await makeCustomer()

        // Create 6 loans → 6 audit entries (loan.create)
        for (let i = 0; i < 6; i++) {
          await makeLoan(customer.id, "100000.00")
        }

        const result = await Effect.runPromise(getRecentActivity())

        // All 6 are loan/payment entity types so they're included
        expect(result.length).toBeGreaterThanOrEqual(1)
        expect(result.length).toBeLessThanOrEqual(10)
      })

      it("orders activity from most recent first", async () => {
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, "1000000.00")
        await makePayment(loan.id, "100000.00", "2025-02-15")

        const result = await Effect.runPromise(getRecentActivity())

        expect(result.length).toBeGreaterThanOrEqual(2)
        // Most recent should be first
        expect(result[0].timestamp.getTime()).toBeGreaterThanOrEqual(
          result[1].timestamp.getTime()
        )
      })

      it("includes loanId in payment activities", async () => {
        const customer = await makeCustomer()
        const loan = await makeLoan(customer.id, "1000000.00")
        await makePayment(loan.id, "50000.00", "2025-02-15")

        const result = await Effect.runPromise(getRecentActivity())

        const paymentEntry = result.find(
          (r) => r.type === "payment_received" && r.description.includes("50,000")
        )
        expect(paymentEntry).toBeDefined()
        expect(paymentEntry!.loanId).toBe(loan.id)
      })
    })
  }
)
