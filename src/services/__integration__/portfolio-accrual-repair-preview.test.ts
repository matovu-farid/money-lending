import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { resetDb, seedCategories, testDb } from "./setup"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loadPortfolioAccrualPlan } from "../portfolio-accrual-repair.service"
import { accrueInterestForLoans } from "../transaction.service"

const start = new Date("2025-01-01T00:00:00.000Z")
const januaryEnd = new Date("2025-01-31T23:59:59.999Z")

async function seedLoan() {
  await seedCategories()
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]))
  const [customer] = await testDb.insert(customers).values({
    fullName: "Accrual Fixture", nin: "C1234567890123",
    contact: "+256700000001", address: "Kampala",
  }).returning()
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id, principalAmount: "1000000.00",
    interestRate: "0.1000", startDate: start,
    issuanceFee: "0.00", status: "active", issuedBy: "actor-1",
    disbursementSource: "cash", createdAt: new Date("2025-02-01T00:00:00.000Z"),
  }).returning()
  const group = randomUUID()
  await testDb.insert(transactions).values([
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "debit",
      amount: "1000000.00", referenceType: "loan", referenceId: loan.id,
      journalGroupId: group, transactionDate: start, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "credit",
      amount: "1000000.00", referenceType: "loan", referenceId: loan.id,
      depositLocation: "cash", journalGroupId: group,
      transactionDate: start, recordedBy: "actor-1" },
  ])
  return { loan, categories }
}

describe("portfolio accrual source preview", () => {
  beforeEach(async () => { await resetDb() })

  it("previews an accrual without changing rows when the asset account is missing", async () => {
    const { loan, categories } = await seedLoan()
    await testDb.delete(transactionCategories)
      .where(eq(transactionCategories.id, categories["Interest Receivable"]))
    const before = await testDb.select().from(transactions)

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)

    expect(plan.classification).toBe("ready")
    expect(plan.entries).toEqual([expect.objectContaining({ delta: "100000.00" })])
    expect(await testDb.select().from(transactions)).toEqual(before)
  })

  it("blocks a payment whose Cash journal date differs from its effective date", async () => {
    const { loan, categories } = await seedLoan()
    const date = new Date("2025-01-16T00:00:00.000Z")
    const [payment] = await testDb.insert(payments).values({
      loanId: loan.id, amount: "50000.00", paymentDate: date,
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories.Cash, type: "debit", amount: "50000.00",
        referenceType: "payment", referenceId: payment.id, depositLocation: "cash",
        journalGroupId: group, transactionDate: new Date("2025-01-17T00:00:00.000Z"),
        recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "payment", referenceId: payment.id,
        journalGroupId: group, transactionDate: date, recordedBy: "actor-1" },
    ])

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)
    expect(plan.classification).toBe("blocked")
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringContaining("Cash journal does not match"),
    ]))
  })

  it("blocks an unbalanced payment journal even when its Cash amount and date match", async () => {
    const { loan, categories } = await seedLoan()
    const date = new Date("2025-01-16T00:00:00.000Z")
    const [payment] = await testDb.insert(payments).values({
      loanId: loan.id, amount: "50000.00", paymentDate: date,
      recordedBy: "actor-1", depositLocation: "cash",
    }).returning()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories.Cash, type: "debit", amount: "50000.00",
        referenceType: "payment", referenceId: payment.id, depositLocation: "cash",
        journalGroupId: group, transactionDate: date, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "40000.00", referenceType: "payment", referenceId: payment.id,
        journalGroupId: group, transactionDate: date, recordedBy: "actor-1" },
    ])

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)
    expect(plan.classification).toBe("blocked")
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringContaining("unbalanced payment or waiver journal"),
    ]))
  })

  it("does not let the monthly job silently post a historical catch-up", async () => {
    await seedLoan()
    const asOf = new Date("2025-03-01T00:00:00.000Z")

    const result = await Effect.runPromise(accrueInterestForLoans(asOf))

    expect(result.entriesPosted).toBe(0)
    expect((await testDb.select().from(transactions)).filter((row) =>
      row.referenceType === "interest_accrual")).toHaveLength(0)
  })

  it("preflights every active loan before posting any month-end entry", async () => {
    const { loan, categories } = await seedLoan()
    const oldStart = new Date("2024-12-01T00:00:00.000Z")
    const [older] = await testDb.insert(loans).values({
      customerId: loan.customerId, principalAmount: "1000000.00",
      interestRate: "0.1000", startDate: oldStart, issuanceFee: "0.00",
      status: "active", issuedBy: "actor-1", disbursementSource: "cash",
    }).returning()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: older.id, categoryId: categories["Loans Receivable"], type: "debit",
        amount: "1000000.00", referenceType: "loan", referenceId: older.id,
        journalGroupId: group, transactionDate: oldStart, recordedBy: "actor-1" },
      { loanId: older.id, categoryId: categories.Cash, type: "credit",
        amount: "1000000.00", referenceType: "loan", referenceId: older.id,
        journalGroupId: group, transactionDate: oldStart, recordedBy: "actor-1" },
    ])

    const result = await Effect.runPromise(accrueInterestForLoans(januaryEnd))
    expect(result).toMatchObject({ entriesPosted: 0, loansBlocked: 1 })
    expect((await testDb.select().from(transactions)).filter((row) =>
      row.referenceType === "interest_accrual")).toHaveLength(0)
  })

  it("posts only a current-period accrual and verifies an idempotent replay", async () => {
    await seedLoan()
    const first = await Effect.runPromise(accrueInterestForLoans(januaryEnd))
    const second = await Effect.runPromise(accrueInterestForLoans(januaryEnd))
    expect(first).toMatchObject({ entriesPosted: 1, loansBlocked: 0 })
    expect(second).toMatchObject({ entriesPosted: 0, loansBlocked: 0 })
    expect((await testDb.select().from(transactions)).filter((row) =>
      row.referenceType === "interest_accrual")).toHaveLength(2)
  })

  it("fails closed when the accrual accounts are absent", async () => {
    await expect(Effect.runPromise(accrueInterestForLoans(januaryEnd))).rejects.toThrow()
  })
})
