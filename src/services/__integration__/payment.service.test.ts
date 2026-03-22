import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect, Exit } from "effect"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import {
  recordPayment,
  editPayment,
  deletePayment,
  getPaymentsForLoan,
} from "@/services/payment.service"
import { loans } from "@/lib/db/schema/loans"
import { auditLog } from "@/lib/db/schema/audit"
import { transactions } from "@/lib/db/schema/transactions"
import { eq } from "drizzle-orm"
import { randomUUID } from "crypto"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeCustomer() {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
      contact: "+256700000000",
      address: "Kampala, Uganda",
    })
  )
}

async function makeLoan(
  customerId: string,
  principal = "1000000.00",
  rate = "0.10"
) {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: principal,
        interestRate: rate,
        minInterestDays: 30,
        startDate: "2025-01-01",
        collateral: { nature: "Land title" },
      },
      "test-actor"
    )
  )
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 30_000

describe("Payment Service — Integration", { timeout: TEST_TIMEOUT, sequential: true }, () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  }, TEST_TIMEOUT)

  // =========================================================================
  // recordPayment
  // =========================================================================

  describe("recordPayment", () => {
    it("1. first payment activates a pending loan", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      expect(loan.status).toBe("pending")

      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      const [updated] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(updated.status).toBe("active")
    })

    it("2. interest-first allocation — payment equals interest, principal unchanged", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // 30 days after start: interest = 1,000,000 × (0.10/30) × 30 = 100,000
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      expect(payment.interestPortion).toBe("100000.00")
      expect(payment.principalPortion).toBe("0.00")
      expect(payment.principalBalanceBefore).toBe("1000000.00")
      expect(payment.principalBalanceAfter).toBe("1000000.00")
    })

    it("3. payment exceeding interest reduces principal", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Pay 200,000 after 30 days: interest=100,000, principal portion=100,000
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000" },
          "test-actor"
        )
      )

      expect(payment.interestPortion).toBe("100000.00")
      expect(payment.principalPortion).toBe("100000.00")
      expect(payment.principalBalanceAfter).toBe("900000.00")
    })

    it("4. full repayment marks loan fully_paid", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // interest = 100,000 × (0.10/30) × 30 = 10,000
      // Need to pay 110,000 to cover interest + principal
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000" },
          "test-actor"
        )
      )

      const [updated] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(updated.status).toBe("fully_paid")
    })

    it("5. audit log written with action payment.create", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)

      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      const logs = await testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, payment.id))

      expect(logs.length).toBeGreaterThanOrEqual(1)
      const entry = logs.find((l) => l.action === "payment.create")
      expect(entry).toBeDefined()
      expect(entry!.actorId).toBe("test-actor")
      expect(entry!.entityType).toBe("payment")
    })

    it("6. auto-posts interest earned transaction with referenceType=payment", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000" },
          "test-actor"
        )
      )

      const txns = await testDb
        .select()
        .from(transactions)
        .where(eq(transactions.referenceType, "payment"))

      expect(txns.length).toBeGreaterThanOrEqual(1)
      const interestTxn = txns.find((t) => t.referenceId === loan.id)
      expect(interestTxn).toBeDefined()
      expect(interestTxn!.type).toBe("credit")
    })

    it("7. payment on nonexistent loan returns LoanNotFound", async () => {
      const fakeId = randomUUID()
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: fakeId, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("LoanNotFound")
      }
    })
  })

  // =========================================================================
  // editPayment
  // =========================================================================

  describe("editPayment", () => {
    it("8. edit payment amount triggers recalculation of subsequent payments", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Payment 1: 200,000 on day 30 → interest=100k, principal=100k, balance=900k
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000" },
          "test-actor"
        )
      )

      // Payment 2: 150,000 on day 60 (30 days after p1)
      // interest = 900,000 × (0.10/30) × 30 = 90,000
      // principal = 60,000, balance = 840,000
      const p2 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "150000" },
          "test-actor"
        )
      )
      expect(p2.principalBalanceBefore).toBe("900000.00")

      // Edit p1 to 300,000 → interest=100k, principal=200k, balance=800k
      await Effect.runPromise(
        editPayment(
          { paymentId: p1.id, amount: "300000", reason: "Correction" },
          "test-actor"
        )
      )

      // p2 should have been recalculated: balanceBefore=800k
      // interest = 800,000 × (0.10/30) × 30 = 80,000
      // principal = 70,000, balance = 730,000
      const refreshed = await Effect.runPromise(getPaymentsForLoan(loan.id))
      const refreshedP2 = refreshed.find((p) => p.id === p2.id)!
      expect(refreshedP2.principalBalanceBefore).toBe("800000.00")
      expect(refreshedP2.interestPortion).toBe("80000.00")
      expect(refreshedP2.principalPortion).toBe("70000.00")
      expect(refreshedP2.principalBalanceAfter).toBe("730000.00")
    })

    it("9. edit reverts fully_paid status to active", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // Fully pay: interest = 10,000, need 110,000
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000" },
          "test-actor"
        )
      )

      const [fullyPaid] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(fullyPaid.status).toBe("fully_paid")

      // Edit payment to a smaller amount that won't cover full principal
      await Effect.runPromise(
        editPayment(
          { paymentId: p1.id, amount: "50000", reason: "Was overstated" },
          "test-actor"
        )
      )

      const [reverted] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(reverted.status).toBe("active")
    })
  })

  // =========================================================================
  // deletePayment (soft delete)
  // =========================================================================

  describe("deletePayment", () => {
    it("10. soft delete sets deletedAt, deletedBy, deleteReason", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)

      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      const deleted = await Effect.runPromise(
        deletePayment(
          { paymentId: payment.id, reason: "Duplicate entry" },
          "test-actor"
        )
      )

      expect(deleted.deletedAt).not.toBeNull()
      expect(deleted.deletedBy).toBe("test-actor")
      expect(deleted.deleteReason).toBe("Duplicate entry")
    })

    it("11. soft delete recalculates subsequent payments from loan start", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Payment 1: day 30
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000" },
          "test-actor"
        )
      )
      // p1: interest=100k, principal=100k, balance=900k

      // Payment 2: day 60 (30 days after p1)
      const p2 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "150000" },
          "test-actor"
        )
      )
      // p2: balanceBefore=900k, interest=90k, principal=60k, balance=840k
      expect(p2.principalBalanceBefore).toBe("900000.00")

      // Delete p1 → p2 should recalculate from loan start (balance=1M)
      await Effect.runPromise(
        deletePayment(
          { paymentId: p1.id, reason: "Error" },
          "test-actor"
        )
      )

      const refreshed = await Effect.runPromise(getPaymentsForLoan(loan.id))
      // Filter to active (non-deleted) payments
      const active = refreshed.filter((p) => p.deletedAt === null)
      expect(active).toHaveLength(1)

      const recalcP2 = active[0]
      // p2 is now first payment: balanceBefore=1M
      // days from loan start (2025-01-01) to 2025-03-02 = 60 days
      // interest = 1,000,000 × (0.10/30) × 60 = 200,000
      // payment=150,000 < interest → all to interest, balance unchanged
      expect(recalcP2.principalBalanceBefore).toBe("1000000.00")
      expect(recalcP2.principalBalanceAfter).toBe("1000000.00")
    })

    it("12. deleting only payment reverts loan to pending", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)

      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )

      // Loan should be active after first payment
      const [active] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(active.status).toBe("active")

      await Effect.runPromise(
        deletePayment(
          { paymentId: payment.id, reason: "Reversed" },
          "test-actor"
        )
      )

      const [reverted] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(reverted.status).toBe("pending")
    })
  })

  // =========================================================================
  // getPaymentsForLoan
  // =========================================================================

  describe("getPaymentsForLoan", () => {
    it("13. returns all payments including soft-deleted", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)

      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000" },
          "test-actor"
        )
      )
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "100000" },
          "test-actor"
        )
      )

      // Soft-delete the first payment
      await Effect.runPromise(
        deletePayment(
          { paymentId: p1.id, reason: "Duplicate" },
          "test-actor"
        )
      )

      const all = await Effect.runPromise(getPaymentsForLoan(loan.id))
      expect(all).toHaveLength(2)

      const deletedOne = all.find((p) => p.id === p1.id)!
      expect(deletedOne.deletedAt).not.toBeNull()

      const activeOne = all.find((p) => p.id !== p1.id)!
      expect(activeOne.deletedAt).toBeNull()
    })

    it("14. nonexistent loan returns LoanNotFound", async () => {
      const fakeId = randomUUID()
      const exit = await Effect.runPromiseExit(getPaymentsForLoan(fakeId))

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("LoanNotFound")
      }
    })
  })
})
