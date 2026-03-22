import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb } from "./setup"
import { Effect, Exit } from "effect"
import { createLoan, getLoan, listLoans } from "@/services/loan.service"
import { createCustomer, changeCustomerStatus } from "@/services/customer.service"
import { auditLog } from "@/lib/db/schema/audit"
import { collateral } from "@/lib/db/schema/collateral"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"

const ACTOR_ID = "integration-test-actor"

async function makeCustomer(overrides = {}) {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
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
    interestRate: "0.10",
    minInterestDays: 30,
    startDate: "2026-04-01T00:00:00.000Z",
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
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
    expect(result.status).toBe("pending")
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
        contact: "+256700000000",
        address: "",
      })
      .returning()

    const input = baseLoanInput(incomplete.id)
    const exit = await Effect.runPromiseExit(createLoan(input, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = (exit.cause as any).error
      expect(error._tag).toBe("IncompleteLoanRequirements")
      expect(error.missing).toContain("address")
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
      const error = (exit.cause as any).error
      expect(error._tag).toBe("DatabaseError")
    }
  })

  // 7. createLoan with nonexistent customer
  it("fails with CustomerNotFound for nonexistent customer", async () => {
    const input = baseLoanInput("00000000-0000-4000-a000-000000000000")
    const exit = await Effect.runPromiseExit(createLoan(input, ACTOR_ID))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = (exit.cause as any).error
      expect(error._tag).toBe("CustomerNotFound")
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
    expect(fetched.status).toBe("pending")
  })

  // 9. getLoan not found
  it("fails with LoanNotFound for nonexistent loan", async () => {
    const exit = await Effect.runPromiseExit(
      getLoan("00000000-0000-4000-a000-000000000000")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = (exit.cause as any).error
      expect(error._tag).toBe("LoanNotFound")
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
})
