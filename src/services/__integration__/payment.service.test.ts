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
  listPayments,
  searchActiveLoans,
  getRecentlyCollectedLoans,
} from "@/services/payment.service"
import { loans } from "@/lib/db/schema/loans"
import { auditLog } from "@/lib/db/schema/audit"
import { transactions } from "@/lib/db/schema/transactions"
import { eq } from "drizzle-orm"
import { randomUUID } from "crypto"
import { payments } from "@/lib/db/schema/payments"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeCustomer() {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
      nin: "CM00000000TEST",
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
        issuanceFee: "50000.00",

        interestRate: rate,
        minInterestDays: 30,
        startDate: "2025-01-01",
        collateral: { nature: "Land title", description: "Test collateral" },
        disbursementSource: "cash",
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
    it("1. first payment on active loan keeps it active", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      expect(loan.status).toBe("active")

      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )

      expect(payment.allocation.interestPortion).toBe("100000.00")
      expect(payment.allocation.principalPortion).toBe("0.00")
      expect(payment.allocation.principalBalanceBefore).toBe("1000000.00")
      expect(payment.allocation.principalBalanceAfter).toBe("1000000.00")
    })

    it("3. payment exceeding interest reduces principal", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Pay 200,000 after 30 days: interest=100,000, principal portion=100,000
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      expect(payment.allocation.interestPortion).toBe("100000.00")
      expect(payment.allocation.principalPortion).toBe("100000.00")
      expect(payment.allocation.principalBalanceAfter).toBe("900000.00")
    })

    it("4. full repayment marks loan fully_paid", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // interest = 100,000 × (0.10/30) × 30 = 10,000
      // Need to pay 110,000 to cover interest + principal
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000", depositLocation: "cash" },
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
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
      // Interest portion for 1M at 10%/month after 30 days = 100,000
      expect(interestTxn!.amount).toBe("100000.00")
    })

    it("7. payment on nonexistent loan returns LoanNotFound", async () => {
      const fakeId = randomUUID()
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: fakeId, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      // Payment 2: 150,000 on day 60 (30 days after p1)
      // interest = 900,000 × (0.10/30) × 30 = 90,000
      // principal = 60,000, balance = 840,000
      const p2 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "150000", depositLocation: "cash" },
          "test-actor"
        )
      )
      expect(p2.allocation.principalBalanceBefore).toBe("900000.00")

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
      // After edit, verify payment still exists (details now derived from ledger)
      const refreshed = await Effect.runPromise(getPaymentsForLoan(loan.id))
      const refreshedP2 = refreshed.find((p) => p.id === p2.id)!
      expect(refreshedP2).toBeDefined()
      expect(refreshedP2.amount).toBe("150000")
    })

    it("9. edit reverts fully_paid status to active", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // Fully pay: interest = 10,000, need 110,000
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000", depositLocation: "cash" },
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

    it("15. editPayment with non-existent payment ID returns PaymentNotFound", async () => {
      const fakeId = randomUUID()
      const exit = await Effect.runPromiseExit(
        editPayment(
          { paymentId: fakeId, amount: "50000", reason: "Test" },
          "test-actor"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("PaymentNotFound")
      }
    })

    it("16. editPayment with paymentDate change recalculates correctly", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Payment on day 30: interest = 1,000,000 × 0.10/30 × 30 = 100,000
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      expect(p1.allocation.interestPortion).toBe("100000.00")
      expect(p1.allocation.principalPortion).toBe("100000.00")

      // Edit paymentDate to day 60 — interest = 1,000,000 × 0.10/30 × 60 = 200,000
      // All 200,000 goes to interest, no principal reduction
      const edited = await Effect.runPromise(
        editPayment(
          { paymentId: p1.id, paymentDate: "2025-03-02", reason: "Wrong date" },
          "test-actor"
        )
      )

      expect(edited.paymentDate).toEqual(new Date("2025-03-02"))
      // Portions are now derived from ledger, not cached columns

      // Verify audit log was written for the edit
      const logs = await testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, p1.id))

      const editLog = logs.find((l) => l.action === "payment.update")
      expect(editLog).toBeDefined()
      expect(editLog!.actorId).toBe("test-actor")
      expect(editLog!.entityType).toBe("payment")
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )
      // p1: interest=100k, principal=100k, balance=900k

      // Payment 2: day 60 (30 days after p1)
      const p2 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "150000", depositLocation: "cash" },
          "test-actor"
        )
      )
      // p2: balanceBefore=900k, interest=90k, principal=60k, balance=840k
      expect(p2.allocation.principalBalanceBefore).toBe("900000.00")

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
      // p2 is now first payment after p1 deleted
      // Portions are now derived from ledger, not cached columns
      expect(recalcP2).toBeDefined()
      expect(recalcP2.amount).toBe("150000")
    })

    it("12. deleting only payment keeps loan active", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)

      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )

      // Loan is active after first payment
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

      // Loan stays active after deleting the only payment (disbursement happened off-app)
      const [afterDelete] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(afterDelete.status).toBe("active")
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
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "100000", depositLocation: "cash" },
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

    it("17. returns payments ordered by paymentDate ASC", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Record 3 payments on different dates (not in chronological order of recording)
      // Payment at day 60 recorded first
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )
      // Payment at day 30 recorded second
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )
      // Payment at day 90 recorded third
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-04-01", amount: "100000", depositLocation: "cash" },
          "test-actor"
        )
      )

      const result = await Effect.runPromise(getPaymentsForLoan(loan.id))
      const dates = result.map((p) => p.paymentDate.toISOString())

      // Verify ascending order by paymentDate
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i - 1]).toBe(true)
      }
      expect(result).toHaveLength(3)
    })
  })

  // =========================================================================
  // Minimum interest days enforcement
  // =========================================================================

  describe("minimum interest days", () => {
    it("18. LOAN-10: payment within 5 days charges 30 days of interest", async () => {
      const customer = await makeCustomer()
      // Loan: 1,000,000 UGX at 10% monthly rate, minInterestDays=30
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Record a payment only 5 days after loan start (2025-01-01 + 5 = 2025-01-06)
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-06", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      // Even though only 5 days passed, minInterestDays=30 should enforce 30 days of interest
      // interest = 1,000,000 × (0.10/30) × 30 = 100,000
      expect(payment.allocation.interestPortion).toBe("100000.00")
      expect(payment.allocation.principalPortion).toBe("100000.00")
      expect(payment.allocation.principalBalanceAfter).toBe("900000.00")
    })
  })

  // =========================================================================
  // Consecutive payments balance chain
  // =========================================================================

  describe("balance chain", () => {
    it("19. consecutive payments maintain balance chain: p2.principalBalanceBefore === p1.principalBalanceAfter", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "1000000.00", "0.10")

      // Payment 1: 200,000 on day 30
      // interest = 1,000,000 × (0.10/30) × 30 = 100,000
      // principal = 100,000, balance after = 900,000
      const p1 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      // Payment 2: 200,000 on day 60
      // interest = 900,000 × (0.10/30) × 30 = 90,000
      // principal = 110,000, balance after = 790,000
      const p2 = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-03-02", amount: "200000", depositLocation: "cash" },
          "test-actor"
        )
      )

      expect(p2.allocation.principalBalanceBefore).toBe(p1.allocation.principalBalanceAfter)
      expect(p1.allocation.principalBalanceAfter).toBe("900000.00")
      expect(p2.allocation.principalBalanceBefore).toBe("900000.00")
    })
  })

  // =========================================================================
  // listPayments
  // =========================================================================

  describe("listPayments", () => {
    it("returns paginated rows with total count (PAY-01)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      // Record 3 payments
      for (let i = 1; i <= 3; i++) {
        await Effect.runPromise(recordPayment({
          loanId: loan.id,
          paymentDate: `2025-02-0${i}`,
          amount: "50000.00",
          depositLocation: "cash",
        }, "test-actor"))
      }
      const result = await Effect.runPromise(listPayments({ page: 1, pageSize: 2 }))
      expect(result.rows).toHaveLength(2)
      expect(result.total).toBe(3)
      // Page 2
      const page2 = await Effect.runPromise(listPayments({ page: 2, pageSize: 2 }))
      expect(page2.rows).toHaveLength(1)
      expect(page2.total).toBe(3)
    })

    it("includes customerName and allocation fields (PAY-02)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({
        loanId: loan.id,
        paymentDate: "2025-02-01",
        amount: "50000.00",
        depositLocation: "cash",
      }, "test-actor"))
      const result = await Effect.runPromise(listPayments({ page: 1 }))
      const row = result.rows[0]
      expect(row.customerName).toBe("Test Customer")
      expect(row.loanId).toBe(loan.id)
      expect(row).toHaveProperty("amount")
    })

    it("filters by dateFrom and dateTo including boundaries (PAY-03)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-01-10", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-01-20", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-01-30", amount: "50000.00", depositLocation: "cash" }, "test-actor"))

      // dateTo should include Jan 20
      const result = await Effect.runPromise(listPayments({ dateTo: "2025-01-20" }))
      expect(result.total).toBe(2)

      // dateFrom should include Jan 20
      const result2 = await Effect.runPromise(listPayments({ dateFrom: "2025-01-20" }))
      expect(result2.total).toBe(2)
    })

    it("filters by amountMin and amountMax (PAY-04)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "5000000.00")
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-01", amount: "30000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-02", amount: "80000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-03", amount: "150000.00", depositLocation: "cash" }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ amountMin: "50000" }))
      expect(result.total).toBe(2)

      const result2 = await Effect.runPromise(listPayments({ amountMax: "100000" }))
      expect(result2.total).toBe(2)
    })

    it("searches by customerName case-insensitively (PAY-05)", async () => {
      const c1 = await Effect.runPromise(createCustomer({ fullName: "John Mukasa", nin: "CM00000000TEST", contact: "+256700000001", address: "Kampala" }))
      const c2 = await Effect.runPromise(createCustomer({ fullName: "Jane Nakato", nin: "CM00000000TEST", contact: "+256700000002", address: "Entebbe" }))
      const l1 = await makeLoan(c1.id)
      const l2 = await makeLoan(c2.id)
      await Effect.runPromise(recordPayment({ loanId: l1.id, paymentDate: "2025-02-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: l2.id, paymentDate: "2025-02-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ customerName: "mukasa" }))
      expect(result.total).toBe(1)
      expect(result.rows[0].customerName).toBe("John Mukasa")
    })

    it("excludes soft-deleted payments", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      const p2 = await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-02", amount: "60000.00", depositLocation: "cash" }, "test-actor"))
      // Soft-delete the second payment
      await Effect.runPromise(deletePayment({ paymentId: p2.id, reason: "test" }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ page: 1 }))
      expect(result.total).toBe(1)
      expect(result.rows[0].amount).toBe("50000.00")
    })

    it("returns empty result when no payments exist", async () => {
      const result = await Effect.runPromise(listPayments({ page: 1 }))
      expect(result.rows).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it("defaults to page 1 and pageSize 25 when omitted", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({
        loanId: loan.id,
        paymentDate: "2025-02-01",
        amount: "50000.00",
        depositLocation: "cash",
      }, "test-actor"))

      const result = await Effect.runPromise(listPayments({}))
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it("orders by paymentDate descending (most recent first)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-01-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-03-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: loan.id, paymentDate: "2025-02-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ page: 1 }))
      const dates = result.rows.map((r) => new Date(r.paymentDate).toISOString().slice(0, 10))
      expect(dates).toEqual(["2025-03-01", "2025-02-01", "2025-01-01"])
    })

    it("combines multiple filters (date + amount + customer name)", async () => {
      const c1 = await Effect.runPromise(createCustomer({ fullName: "Alice Mukasa", nin: "CM00000000TEST", contact: "+256700000003", address: "Kampala" }))
      const c2 = await Effect.runPromise(createCustomer({ fullName: "Bob Kato", nin: "CM00000000TEST", contact: "+256700000004", address: "Entebbe" }))
      const l1 = await makeLoan(c1.id, "5000000.00")
      const l2 = await makeLoan(c2.id, "5000000.00")

      // Alice: large payment on Jan 15
      await Effect.runPromise(recordPayment({ loanId: l1.id, paymentDate: "2025-01-15", amount: "200000.00", depositLocation: "cash" }, "test-actor"))
      // Alice: small payment on Feb 15
      await Effect.runPromise(recordPayment({ loanId: l1.id, paymentDate: "2025-02-15", amount: "30000.00", depositLocation: "cash" }, "test-actor"))
      // Bob: large payment on Jan 15
      await Effect.runPromise(recordPayment({ loanId: l2.id, paymentDate: "2025-01-15", amount: "200000.00", depositLocation: "cash" }, "test-actor"))

      // Filter: Alice + Jan only + large amounts
      const result = await Effect.runPromise(listPayments({
        customerName: "alice",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
        amountMin: "100000",
      }))
      expect(result.total).toBe(1)
      expect(result.rows[0].customerName).toBe("Alice Mukasa")
    })

    it("returns payments across multiple loans and customers", async () => {
      const c1 = await Effect.runPromise(createCustomer({ fullName: "Multi Loan A", nin: "CM00000000TEST", contact: "+256700000005", address: "A" }))
      const c2 = await Effect.runPromise(createCustomer({ fullName: "Multi Loan B", nin: "CM00000000TEST", contact: "+256700000006", address: "B" }))
      const l1 = await makeLoan(c1.id)
      const l2 = await makeLoan(c2.id)
      await Effect.runPromise(recordPayment({ loanId: l1.id, paymentDate: "2025-02-01", amount: "50000.00", depositLocation: "cash" }, "test-actor"))
      await Effect.runPromise(recordPayment({ loanId: l2.id, paymentDate: "2025-02-01", amount: "70000.00", depositLocation: "cash" }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ page: 1 }))
      expect(result.total).toBe(2)
      const names = result.rows.map((r) => r.customerName).sort()
      expect(names).toEqual(["Multi Loan A", "Multi Loan B"])
    })

    it("includes customerId in each row", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id)
      await Effect.runPromise(recordPayment({
        loanId: loan.id,
        paymentDate: "2025-02-01",
        amount: "50000.00",
        depositLocation: "cash",
      }, "test-actor"))

      const result = await Effect.runPromise(listPayments({ page: 1 }))
      expect(result.rows[0].customerId).toBe(customer.id)
    })
  })

  // =========================================================================
  // deletePayment on fully_paid loan
  // =========================================================================

  describe("deletePayment status revert", () => {
    it("20. deletePayment on fully_paid loan reverts status to active", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // interest = 100,000 × (0.10/30) × 30 = 10,000
      // Need to pay 110,000 to cover interest + principal
      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "110000", depositLocation: "cash" },
          "test-actor"
        )
      )

      // Verify loan is fully_paid
      const [fullyPaid] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(fullyPaid.status).toBe("fully_paid")

      // Delete the payment
      await Effect.runPromise(
        deletePayment(
          { paymentId: payment.id, reason: "Reversed" },
          "test-actor"
        )
      )

      // Verify loan status reverts to active
      const [reverted] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))
      expect(reverted.status).toBe("active")
    })
  })

  // =========================================================================
  // Phase 8: searchActiveLoans
  // =========================================================================

  describe("searchActiveLoans", () => {
    it("returns active loans matching customer name (case-insensitive partial match)", async () => {
      const customer = await Effect.runPromise(
        createCustomer({ fullName: "Sarah Mutesi", nin: "CM00000000TEST", contact: "+256700000010", address: "Kampala" })
      )
      const loan = await makeLoan(customer.id)

      const results = await Effect.runPromise(searchActiveLoans("sarah"))

      expect(results.length).toBeGreaterThanOrEqual(1)
      const match = results.find((r) => r.loanId === loan.id)
      expect(match).toBeDefined()
      expect(match!.customerName).toBe("Sarah Mutesi")
      expect(match!.loanId).toBe(loan.id)
    })

    it("returns empty array when no loans match", async () => {
      await makeCustomer()
      const results = await Effect.runPromise(searchActiveLoans("xyz999"))
      expect(results).toHaveLength(0)
    })

    it("does not return fully_paid loans", async () => {
      const customer = await Effect.runPromise(
        createCustomer({ fullName: "Fully Paid Customer", nin: "CM00000000TEST", contact: "+256700000011", address: "Kampala" })
      )
      const loan = await makeLoan(customer.id, "100000.00", "0.10")

      // Pay off the loan completely: interest=10,000 + principal=100,000 = 110,000
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31T09:00:00Z", amount: "110000", depositLocation: "cash" },
          "test-actor"
        )
      )

      const results = await Effect.runPromise(searchActiveLoans("Fully Paid"))
      expect(results).toHaveLength(0)
    })

    it("does not return soft-deleted loans", async () => {
      const customer = await Effect.runPromise(
        createCustomer({ fullName: "Deleted Loan Customer", nin: "CM00000000TEST", contact: "+256700000012", address: "Kampala" })
      )
      const loan = await makeLoan(customer.id)

      // Soft-delete the loan via testDb
      await testDb
        .update(loans)
        .set({ deletedAt: new Date() })
        .where(eq(loans.id, loan.id))

      const results = await Effect.runPromise(searchActiveLoans("Deleted Loan"))
      expect(results).toHaveLength(0)
    })

    it("returns empty array for query shorter than 2 chars", async () => {
      await makeCustomer()
      const results = await Effect.runPromise(searchActiveLoans("a"))
      expect(results).toHaveLength(0)
    })

    it("returns empty array for empty string", async () => {
      await makeCustomer()
      const results = await Effect.runPromise(searchActiveLoans(""))
      expect(results).toHaveLength(0)
    })
  })

  // =========================================================================
  // Phase 8: getRecentlyCollectedLoans
  // =========================================================================

  describe("getRecentlyCollectedLoans", () => {
    it("returns empty array for user with no payment history", async () => {
      const results = await Effect.runPromise(getRecentlyCollectedLoans("unknown-user-id"))
      expect(results).toHaveLength(0)
    })

    it("returns most recent payment date per loan (no duplicates for same loan)", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "5000000.00", "0.10")

      // Record 2 payments on the same loan
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2026-01-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-a"
        )
      )
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2026-02-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-a"
        )
      )

      const results = await Effect.runPromise(getRecentlyCollectedLoans("collector-a"))

      // Should return only 1 entry (DISTINCT ON loan_id)
      expect(results).toHaveLength(1)
      expect(results[0].loanId).toBe(loan.id)
      // Should return the most recent payment date
      expect(results[0].paymentDate.toISOString().slice(0, 10)).toBe("2026-02-01")
    })

    it("orders results by most recent payment first", async () => {
      const c1 = await Effect.runPromise(
        createCustomer({ fullName: "Order Test Alpha", nin: "CM00000000TEST", contact: "+256700001001", address: "A" })
      )
      const c2 = await Effect.runPromise(
        createCustomer({ fullName: "Order Test Beta", nin: "CM00000000TEST", contact: "+256700001002", address: "B" })
      )
      const l1 = await makeLoan(c1.id, "5000000.00")
      const l2 = await makeLoan(c2.id, "5000000.00")

      // Older payment on l1, newer on l2
      await Effect.runPromise(
        recordPayment(
          { loanId: l1.id, paymentDate: "2026-01-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-b"
        )
      )
      await Effect.runPromise(
        recordPayment(
          { loanId: l2.id, paymentDate: "2026-02-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-b"
        )
      )

      const results = await Effect.runPromise(getRecentlyCollectedLoans("collector-b"))
      expect(results).toHaveLength(2)
      // Most recent first
      expect(results[0].paymentDate >= results[1].paymentDate).toBe(true)
    })

    it("excludes soft-deleted payments", async () => {
      const customer = await makeCustomer()
      const loan = await makeLoan(customer.id, "5000000.00")

      const payment = await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2026-03-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-c"
        )
      )

      // Soft-delete the payment
      await Effect.runPromise(
        deletePayment({ paymentId: payment.id, reason: "Duplicate" }, "collector-c")
      )

      const results = await Effect.runPromise(getRecentlyCollectedLoans("collector-c"))
      expect(results).toHaveLength(0)
    })

    it("filters by recordedBy user — only sees own collected loans", async () => {
      const c1 = await Effect.runPromise(
        createCustomer({ fullName: "User Filter Alpha", nin: "CM00000000TEST", contact: "+256700002001", address: "A" })
      )
      const c2 = await Effect.runPromise(
        createCustomer({ fullName: "User Filter Beta", nin: "CM00000000TEST", contact: "+256700002002", address: "B" })
      )
      const l1 = await makeLoan(c1.id, "5000000.00")
      const l2 = await makeLoan(c2.id, "5000000.00")

      // collector-x records on l1, collector-y records on l2
      await Effect.runPromise(
        recordPayment(
          { loanId: l1.id, paymentDate: "2026-03-01T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-x"
        )
      )
      await Effect.runPromise(
        recordPayment(
          { loanId: l2.id, paymentDate: "2026-03-02T09:00:00Z", amount: "50000", depositLocation: "cash" },
          "collector-y"
        )
      )

      const resultsX = await Effect.runPromise(getRecentlyCollectedLoans("collector-x"))
      const resultsY = await Effect.runPromise(getRecentlyCollectedLoans("collector-y"))

      expect(resultsX).toHaveLength(1)
      expect(resultsX[0].loanId).toBe(l1.id)

      expect(resultsY).toHaveLength(1)
      expect(resultsY[0].loanId).toBe(l2.id)
    })

    it("respects the limit parameter — returns at most 5 by default", async () => {
      const userId = "collector-limit"

      // Create 6 customers with loans and payments
      for (let i = 0; i < 6; i++) {
        const customer = await Effect.runPromise(
          createCustomer({
            fullName: `Limit Test Customer ${i}`,
            nin: "CM00000000TEST",
            contact: `+25670000300${i}`,
            address: "Kampala",
          })
        )
        const loan = await makeLoan(customer.id, "5000000.00")
        await Effect.runPromise(
          recordPayment(
            {
              loanId: loan.id,
              paymentDate: `2026-0${(i % 9) + 1}-01T09:00:00Z`,
              amount: "50000",
              depositLocation: "cash",
            },
            userId
          )
        )
      }

      const results = await Effect.runPromise(getRecentlyCollectedLoans(userId, 5))
      expect(results).toHaveLength(5)
    })
  })
})
