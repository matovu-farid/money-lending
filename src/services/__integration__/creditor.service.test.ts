import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb, seedCategories } from "./setup"
import { Effect, Exit, Cause } from "effect"
import {
  createCreditor,
  updateCreditor,
  getCreditor,
  listCreditors,
  addInvestment,
  recordCreditorRepayment,
  getCreditorDashboard,
  getSystemCapital,
} from "@/services/creditor.service"
import { CreditorNotFound, InvestmentNotFound } from "@/lib/errors"
import { auditLog } from "@/lib/db/schema/audit"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { transactions } from "@/lib/db/schema/transactions"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"

async function makeCreditor(name = "Test Creditor") {
  return Effect.runPromise(
    createCreditor(
      {
        name,
        contact: "+256700000000",
        address: "Kampala, Uganda",
      },
      "test-actor",
    ),
  )
}

describe("Creditor Service (integration)", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await resetDb()
    await seedCategories()
  })

  // ── CRUD ─────────────────────────────────────────────────────────────

  // 1. createCreditor
  it("createCreditor — returns all fields and writes audit log", async () => {
    const creditor = await makeCreditor("Alice Fund")

    expect(creditor.id).toBeDefined()
    expect(creditor.name).toBe("Alice Fund")
    expect(creditor.contact).toBe("+256700000000")
    expect(creditor.address).toBe("Kampala, Uganda")
    expect(creditor.createdAt).toBeInstanceOf(Date)
    expect(creditor.updatedAt).toBeInstanceOf(Date)

    // Verify audit log
    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, creditor.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("creditor.create")
    expect(logs[0].actorId).toBe("test-actor")
    expect(logs[0].entityType).toBe("creditor")
  })

  // 2. updateCreditor
  it("updateCreditor — updates name, persists change, writes audit log", async () => {
    const creditor = await makeCreditor("Original Name")

    const updated = await Effect.runPromise(
      updateCreditor(creditor.id, { name: "Updated Name" }, "test-actor"),
    )

    expect(updated.name).toBe("Updated Name")
    expect(updated.contact).toBe("+256700000000") // unchanged

    // Verify persistence
    const refetched = await Effect.runPromise(getCreditor(creditor.id))
    expect(refetched.name).toBe("Updated Name")

    // Verify audit log (createCreditor writes 1 + updateCreditor writes 1 = 2)
    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, creditor.id))

    const updateLog = logs.find((l) => l.action === "creditor.update")
    expect(updateLog).toBeDefined()
    expect(updateLog!.actorId).toBe("test-actor")
    expect(JSON.parse(updateLog!.beforeValue!)).toEqual(
      expect.objectContaining({ name: "Original Name" }),
    )
    expect(JSON.parse(updateLog!.afterValue!)).toEqual(
      expect.objectContaining({ name: "Updated Name" }),
    )
  })

  // 3. updateCreditor not found
  it("updateCreditor — returns CreditorNotFound for unknown id", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(
      updateCreditor(fakeId, { name: "Nope" }, "test-actor"),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CreditorNotFound)
      }
    }
  })

  // 4. getCreditor
  it("getCreditor — fetches a creditor by id", async () => {
    const created = await makeCreditor("Fetch Me")

    const fetched = await Effect.runPromise(getCreditor(created.id))

    expect(fetched.id).toBe(created.id)
    expect(fetched.name).toBe("Fetch Me")
  })

  // 5. getCreditor not found
  it("getCreditor — returns CreditorNotFound for unknown id", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(getCreditor(fakeId))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CreditorNotFound)
      }
    }
  })

  // 6. listCreditors
  it("listCreditors — returns all creditors ordered by name", async () => {
    await makeCreditor("Charlie")
    await makeCreditor("Alpha")
    await makeCreditor("Bravo")

    const list = await Effect.runPromise(listCreditors())

    expect(list).toHaveLength(3)
    expect(list[0].name).toBe("Alpha")
    expect(list[1].name).toBe("Bravo")
    expect(list[2].name).toBe("Charlie")
  })

  // ── Investments ──────────────────────────────────────────────────────

  // 7. addInvestment
  it("addInvestment — principalBalance equals amount", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    expect(investment.id).toBeDefined()
    expect(investment.creditorId).toBe(creditor.id)
    expect(investment.amount).toBe("1000000.00")
    expect(investment.principalBalance).toBe("1000000.00")
    expect(investment.interestRateMonthly).toBe("0.0500")
    expect(investment.recordedBy).toBe("test-actor")
  })

  // 8. addInvestment audit log
  it("addInvestment — writes audit log entry", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "5000000",
          interestRateMonthly: "0.10",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, investment.id))

    const investmentLog = logs.find(
      (l) => l.action === "creditor_investment.create",
    )
    expect(investmentLog).toBeDefined()
    expect(investmentLog!.entityType).toBe("creditor_investment")
    expect(investmentLog!.actorId).toBe("test-actor")
  })

  // 9. addInvestment to nonexistent creditor
  it("addInvestment — returns CreditorNotFound for unknown creditor", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(
      addInvestment(
        {
          creditorId: fakeId,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CreditorNotFound)
      }
    }
  })

  // ── Repayments ───────────────────────────────────────────────────────

  // 10. recordCreditorRepayment with interest-first allocation
  it("recordCreditorRepayment — interest-first allocation (1M at 5%, 30 days, repay 100K)", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    // Repay 100,000 after 30 days
    // Interest = 1,000,000 * (0.05/30) * 30 = 50,000
    // principalPortion = 100,000 - 50,000 = 50,000
    // balanceAfter = 1,000,000 - 50,000 = 950,000
    const repayment = await Effect.runPromise(
      recordCreditorRepayment(
        {
          investmentId: investment.id,
          repaymentDate: "2026-01-31T00:00:00.000Z",
          amount: "100000",
        },
        "test-actor",
      ),
    )

    // Interest = 1M * (0.05/30) * 30 ≈ 50000 (BigNumber precision may yield 49999.99)
    const interestPortion = parseFloat(repayment.interestPortion)
    expect(interestPortion).toBeCloseTo(50000, -1)

    const principalPortion = parseFloat(repayment.principalPortion)
    expect(principalPortion).toBeCloseTo(50000, -1)

    const balanceAfter = parseFloat(repayment.principalBalanceAfter)
    expect(balanceAfter).toBeCloseTo(950000, -1)

    expect(repayment.principalBalanceBefore).toBe("1000000.00")
  })

  // 11. recordCreditorRepayment updates principalBalance
  it("recordCreditorRepayment — updates investment principalBalance", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    await Effect.runPromise(
      recordCreditorRepayment(
        {
          investmentId: investment.id,
          repaymentDate: "2026-01-31T00:00:00.000Z",
          amount: "100000",
        },
        "test-actor",
      ),
    )

    // Verify the investment row was updated
    const [updatedInvestment] = await testDb
      .select()
      .from(creditorInvestments)
      .where(eq(creditorInvestments.id, investment.id))

    const principalBalance = parseFloat(updatedInvestment.principalBalance)
    expect(principalBalance).toBeCloseTo(950000, -1)
    expect(principalBalance).toBeLessThan(1000000)
  })

  // 12. recordCreditorRepayment auto-posts interest expense
  it("recordCreditorRepayment — auto-posts interest expense transaction", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    await Effect.runPromise(
      recordCreditorRepayment(
        {
          investmentId: investment.id,
          repaymentDate: "2026-01-31T00:00:00.000Z",
          amount: "100000",
        },
        "test-actor",
      ),
    )

    // Verify a debit transaction was auto-posted for the interest portion
    const txns = await testDb.select().from(transactions)

    const interestTxn = txns.find((t) => t.type === "debit")
    expect(interestTxn).toBeDefined()
    // Interest portion ~50,000
    const txnAmount = parseFloat(interestTxn!.amount)
    expect(txnAmount).toBeCloseTo(50000, -1)
  })

  // 13. recordCreditorRepayment to nonexistent investment
  it("recordCreditorRepayment — returns InvestmentNotFound for unknown investment", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(
      recordCreditorRepayment(
        {
          investmentId: fakeId,
          repaymentDate: "2026-01-31T00:00:00.000Z",
          amount: "100000",
        },
        "test-actor",
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(InvestmentNotFound)
      }
    }
  })

  // ── Dashboard ────────────────────────────────────────────────────────

  // 14. getCreditorDashboard
  it("getCreditorDashboard — aggregates investment, repayment, and interest data", async () => {
    const creditor = await makeCreditor()

    await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    // Fetch dashboard — investment exists, no repayments yet
    // Interest accrues from 2026-01-01 to now
    const dashboard = await Effect.runPromise(
      getCreditorDashboard(creditor.id),
    )

    expect(dashboard.totalInvested).toBe("1000000.00")
    expect(dashboard.investments).toHaveLength(1)
    expect(dashboard.investments[0].amount).toBe("1000000.00")
    expect(dashboard.investments[0].principalBalance).toBe("1000000.00")
    // Interest should have accrued (many days since Jan 1 2026)
    expect(parseFloat(dashboard.interestAccrued)).toBeGreaterThan(0)
    expect(parseFloat(dashboard.outstandingBalance)).toBeGreaterThan(1000000)
  })

  // 14b. getCreditorDashboard with repayment
  it("getCreditorDashboard — reflects repayment in totals", async () => {
    const creditor = await makeCreditor()

    const investment = await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    const repayment = await Effect.runPromise(
      recordCreditorRepayment(
        {
          investmentId: investment.id,
          repaymentDate: "2026-01-31T00:00:00.000Z",
          amount: "100000",
        },
        "test-actor",
      ),
    )

    const dashboard = await Effect.runPromise(
      getCreditorDashboard(creditor.id),
    )

    expect(dashboard.totalInvested).toBe("1000000.00")
    expect(dashboard.repaymentsMade).toBe("100000.00")
    // principalBalance should reflect the reduction from repayment
    const principalBalance = parseFloat(
      dashboard.investments[0].principalBalance,
    )
    expect(principalBalance).toBeCloseTo(950000, -1)
  })

  // 15. getCreditorDashboard not found
  it("getCreditorDashboard — returns CreditorNotFound for unknown creditor", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(getCreditorDashboard(fakeId))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CreditorNotFound)
      }
    }
  })

  // ── System Capital ───────────────────────────────────────────────────

  // 16. getSystemCapital
  it("getSystemCapital — aggregates across multiple creditors", async () => {
    const creditor1 = await makeCreditor("Creditor A")
    const creditor2 = await makeCreditor("Creditor B")

    await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor1.id,
          amount: "1000000",
          interestRateMonthly: "0.05",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    await Effect.runPromise(
      addInvestment(
        {
          creditorId: creditor2.id,
          amount: "2000000",
          interestRateMonthly: "0.08",
          investmentDate: "2026-01-01T00:00:00.000Z",
        },
        "test-actor",
      ),
    )

    const capital = await Effect.runPromise(getSystemCapital())

    // totalInvested = 1M + 2M = 3M
    expect(capital.totalInvested).toBe("3000000.00")
    expect(capital.totalRepaymentsMade).toBe("0.00")
    // Interest has accrued on both investments
    expect(parseFloat(capital.totalInterestAccrued)).toBeGreaterThan(0)
    // totalOutstanding = total principal + interest > 3M
    expect(parseFloat(capital.totalOutstanding)).toBeGreaterThan(3000000)
  })
})
