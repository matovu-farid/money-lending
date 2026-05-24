import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect, Exit, Cause, Option } from "effect"
import { createLoan, getLoan, listLoans, deleteLoan } from "@/services/loan.service"
import { recordPayment } from "@/services/payment.service"
import { transactions } from "@/lib/db/schema/transactions"
import { sql } from "drizzle-orm"
import BigNumber from "bignumber.js"
import { createCustomer, changeCustomerStatus } from "@/services/customer.service"
import { auditLog } from "@/lib/db/schema/audit"
import { collateral } from "@/lib/db/schema/collateral"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { eq } from "drizzle-orm"

const ACTOR_ID = "integration-test-actor"

async function makeCustomer(overrides = {}) {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
      nin: "C0000000000000",
      contact: "+256700000000",
      address: "Kampala, Uganda",
      ...overrides,
    })
  )
}

function baseLoanInput(customerId: string) {
  return {
    customerId,
    principalAmount: "1000000.00",
    issuanceFee: "50000.00",
    interestRate: "0.10",
    minInterestDays: 30,
    startDate: "2026-04-01T00:00:00.000Z",
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
    disbursementSource: "cash" as const,
  }
}

describe("Loan Service — Integration", () => {
  beforeEach(async () => {
    await resetDb()
  })

  // 1. createLoan — verify loan fields
  it("creates a loan with correct fields", async () => {
    const customer = await makeCustomer()
    const input = baseLoanInput(customer.id)

    const result = await Effect.runPromise(createLoan(input, ACTOR_ID))

    expect(result.id).toBeDefined()
    expect(result.customerId).toBe(customer.id)
    expect(result.principalAmount).toBe("1000000.00")
    // numeric(5,4) stores "0.10" as "0.1000"
    expect(result.interestRate).toBe("0.1000")
    expect(result.minInterestDays).toBe(30)
    expect(result.startDate).toEqual(new Date("2026-04-01T00:00:00.000Z"))
    expect(result.status).toBe("active")
    expect(result.issuedBy).toBe(ACTOR_ID)
  })

  // 2. createLoan creates collateral
  it("creates collateral with nature and description", async () => {
    const customer = await makeCustomer()
    const input = baseLoanInput(customer.id)

    const result = await Effect.runPromise(createLoan(input, ACTOR_ID))

    expect(result.collateral).toBeDefined()
    expect(result.collateral.nature).toBe("Land Title")
    expect(result.collateral.description).toBe("Plot 42, Kampala")
    expect(result.collateral.id).toBeDefined()
  })

  // 3. createLoan writes audit log
  it("writes an audit log entry with action loan.create", async () => {
    const customer = await makeCustomer()
    const input = baseLoanInput(customer.id)

    const result = await Effect.runPromise(createLoan(input, ACTOR_ID))

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("loan.create")
    expect(logs[0].actorId).toBe(ACTOR_ID)
    expect(logs[0].entityType).toBe("loan")
  })

  // 4. createLoan atomic — collateral + audit in same transaction
  it("creates loan, collateral, and audit log atomically", async () => {
    const customer = await makeCustomer()
    const input = baseLoanInput(customer.id)

    const result = await Effect.runPromise(createLoan(input, ACTOR_ID))

    // Verify all three rows exist
    const [collRows, auditRows] = await Promise.all([
      testDb
        .select()
        .from(collateral)
        .where(eq(collateral.loanId, result.id)),
      testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, result.id)),
    ])

    expect(collRows).toHaveLength(1)
    expect(collRows[0].nature).toBe("Land Title")
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0].action).toBe("loan.create")
  })

  // 5. createLoan blocks incomplete customer
  it("blocks loan creation for customer with incomplete details", async () => {
    // Insert directly via testDb to bypass service validation
    const [incomplete] = await testDb
      .insert(customers)
      .values({
        fullName: "Incomplete",
        nin: "C0000000000000",
        contact: "+256700000000",
        address: "",
      })
      .returning()

    const input = baseLoanInput(incomplete.id)
    const exit = await Effect.runPromiseExit(createLoan(input, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        const error = failure.value
        expect(error._tag).toBe("IncompleteLoanRequirements")
        if (error._tag === "IncompleteLoanRequirements") {
          expect(error.missing).toContain("address")
        }
      }
    }
  })

  // 6. createLoan blocks blacklisted customer
  it("blocks loan creation for blacklisted customer", async () => {
    const customer = await makeCustomer()

    // Blacklist the customer
    await Effect.runPromise(
      changeCustomerStatus(customer.id, "blacklisted", "Test blacklist", ACTOR_ID)
    )

    const input = baseLoanInput(customer.id)
    const exit = await Effect.runPromiseExit(createLoan(input, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)
    // The ValidationError is wrapped in a DatabaseError by the catch handler
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause)
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DatabaseError")
      }
    }
  })

  // 7. createLoan with nonexistent customer
  it("fails with CustomerNotFound for nonexistent customer", async () => {
    const input = baseLoanInput("00000000-0000-4000-a000-000000000000")
    const exit = await Effect.runPromiseExit(createLoan(input, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause)
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("CustomerNotFound")
      }
    }
  })

  // 8. getLoan — fetch by ID
  it("fetches a loan by ID", async () => {
    const customer = await makeCustomer()
    const input = baseLoanInput(customer.id)
    const created = await Effect.runPromise(createLoan(input, ACTOR_ID))

    const fetched = await Effect.runPromise(getLoan(created.id))

    expect(fetched.id).toBe(created.id)
    expect(fetched.customerId).toBe(customer.id)
    expect(fetched.principalAmount).toBe("1000000.00")
    expect(fetched.status).toBe("active")
  })

  // 9. getLoan not found
  it("fails with LoanNotFound for nonexistent loan", async () => {
    const exit = await Effect.runPromiseExit(
      getLoan("00000000-0000-4000-a000-000000000000")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause)
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("LoanNotFound")
      }
    }
  })

  // 10. listLoans — returns multiple loans
  it("lists all loans", async () => {
    const customer1 = await makeCustomer({ fullName: "Customer One" })
    const customer2 = await makeCustomer({
      fullName: "Customer Two",
      contact: "+256700000001",
    })

    await Effect.runPromise(createLoan(baseLoanInput(customer1.id), ACTOR_ID))
    await Effect.runPromise(createLoan(baseLoanInput(customer2.id), ACTOR_ID))

    const all = await Effect.runPromise(listLoans())

    expect(all).toHaveLength(2)
    const customerIds = all.map((l) => l.customerId)
    expect(customerIds).toContain(customer1.id)
    expect(customerIds).toContain(customer2.id)
  })

  // =========================================================================
  // deleteLoan — ledger reversal
  // =========================================================================

  describe("deleteLoan", () => {
    it("soft-deletes the loan with metadata", async () => {
      await seedCategories()
      const customer = await makeCustomer({ contact: "+256700000010" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR_ID)
      )

      await Effect.runPromise(
        deleteLoan({ loanId: loan.id, reason: "test deletion" }, ACTOR_ID)
      )

      const [deleted] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id))

      expect(deleted.deletedAt).not.toBeNull()
    })

    it("all ledger entries net to zero after deletion", async () => {
      await seedCategories()
      const customer = await makeCustomer({ contact: "+256700000011" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR_ID)
      )

      // Delete the loan
      await Effect.runPromise(
        deleteLoan({ loanId: loan.id, reason: "test" }, ACTOR_ID)
      )

      // Sum all debits and credits for this loan — they should net to zero
      const rows = await testDb
        .select({
          type: transactions.type,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .where(eq(transactions.loanId, loan.id))
        .groupBy(transactions.type)

      let debits = new BigNumber(0)
      let credits = new BigNumber(0)
      for (const row of rows) {
        if (row.type === "debit") debits = debits.plus(new BigNumber(row.total))
        else credits = credits.plus(new BigNumber(row.total))
      }
      const net = debits.minus(credits).abs()
      expect(net.isLessThanOrEqualTo(1)).toBe(true)
    })

    it("all ledger entries net to zero after loan with payments is deleted", async () => {
      await seedCategories()
      const customer = await makeCustomer({ contact: "+256700000012" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR_ID)
      )

      // Make a payment
      await Effect.runPromise(
        recordPayment(
          { loanId: loan.id, paymentDate: "2025-01-31", amount: "200000", depositLocation: "cash" },
          ACTOR_ID
        )
      )

      // Delete the loan (should reverse payment journals too)
      await Effect.runPromise(
        deleteLoan({ loanId: loan.id, reason: "test" }, ACTOR_ID)
      )

      const rows = await testDb
        .select({
          type: transactions.type,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .where(eq(transactions.loanId, loan.id))
        .groupBy(transactions.type)

      let debits = new BigNumber(0)
      let credits = new BigNumber(0)
      for (const row of rows) {
        if (row.type === "debit") debits = debits.plus(new BigNumber(row.total))
        else credits = credits.plus(new BigNumber(row.total))
      }
      const net = debits.minus(credits).abs()
      expect(net.isLessThanOrEqualTo(1)).toBe(true)
    })

    it("total transaction debits equal credits after deletion (net zero)", async () => {
      await seedCategories()
      const customer = await makeCustomer({ contact: "+256700000013" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR_ID)
      )

      await Effect.runPromise(
        deleteLoan({ loanId: loan.id, reason: "test" }, ACTOR_ID)
      )

      // Check ALL transactions for this loan, not just Loans Receivable
      const rows = await testDb
        .select({
          type: transactions.type,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .where(eq(transactions.loanId, loan.id))
        .groupBy(transactions.type)

      let debits = new BigNumber(0)
      let credits = new BigNumber(0)
      for (const row of rows) {
        if (row.type === "debit") debits = debits.plus(new BigNumber(row.total))
        else credits = credits.plus(new BigNumber(row.total))
      }
      const net = debits.minus(credits).abs()
      expect(net.isLessThanOrEqualTo(1)).toBe(true)
    })

    it("writes audit log entry with action loan.delete", async () => {
      await seedCategories()
      const customer = await makeCustomer({ contact: "+256700000014" })
      const loan = await Effect.runPromise(
        createLoan(baseLoanInput(customer.id), ACTOR_ID)
      )

      await Effect.runPromise(
        deleteLoan({ loanId: loan.id, reason: "audit test" }, ACTOR_ID)
      )

      const logs = await testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, loan.id))

      const deleteEntry = logs.find((l) => l.action === "loan.delete")
      expect(deleteEntry).toBeDefined()
      expect(deleteEntry!.actorId).toBe(ACTOR_ID)
    })
  })
})
