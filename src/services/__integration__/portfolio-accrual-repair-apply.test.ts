import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { resetDb, seedCategories, testDb } from "./setup"
import { user } from "@/lib/db/schema/auth"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { portfolioAccrualRepairApprovals, portfolioAccrualRepairRuns } from
  "@/lib/db/schema/portfolio-accrual-repair-runs"
import { verifyPortfolioAccrualBackup } from "@/lib/interest/portfolio-accrual-backup"
import { loadPortfolioAccrualPlan } from "../portfolio-accrual-repair.service"
import { approvePortfolioAccrualRepair, applyPortfolioAccrualRepair } from
  "../portfolio-accrual-repair-apply.service"
import { reverseInterestAccrual } from "../transaction.service"
import { getCashflowData } from "../report.service"
import { recordPayment } from "../payment.service"

vi.mock("@/lib/interest/portfolio-accrual-backup", () => ({
  verifyPortfolioAccrualBackup: vi.fn(async () => ({
    dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
  })),
}))

const asOf = new Date("2025-01-31T23:59:59.999Z")
function backupGate() {
  return { manifestPath: "/private/tmp/integration.dump.manifest.json",
    expectedDumpSha256: "b".repeat(64),
    primaryUrl: process.env.DATABASE_URL!, directUrl: process.env.DATABASE_URL_UNPOOLED! }
}

async function seedLoan() {
  await seedCategories()
  await testDb.update(user).set({ role: "admin" }).where(eq(user.id, "admin-1"))
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]))
  const [customer] = await testDb.insert(customers).values({
    fullName: "Accrual Apply Fixture", nin: "C1234567890123",
    contact: "+256700000001", address: "Kampala",
  }).returning()
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id, principalAmount: "1000000.00",
    interestRate: "0.1000", startDate: new Date("2025-01-01T00:00:00.000Z"),
    issuanceFee: "0.00", status: "active", issuedBy: "actor-1",
    disbursementSource: "cash",
  }).returning()
  const group = randomUUID()
  await testDb.insert(transactions).values([
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "debit",
      amount: "1000000.00", referenceType: "loan", referenceId: loan.id,
      journalGroupId: group, transactionDate: loan.startDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "credit",
      amount: "1000000.00", referenceType: "loan", referenceId: loan.id,
      depositLocation: "cash", journalGroupId: group,
      transactionDate: loan.startDate, recordedBy: "actor-1" },
  ])
  return loan
}

describe("portfolio accrual exact-plan approval and apply", () => {
  beforeEach(async () => {
    await resetDb()
    vi.mocked(verifyPortfolioAccrualBackup).mockResolvedValue({
      dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
    })
  })

  it("refuses an unapproved plan without touching Cash or runs", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    const before = await testDb.select().from(transactions)

    await expect(applyPortfolioAccrualRepair(plan, "admin-1", backupGate()))
      .rejects.toThrow(/approval/i)

    expect(await testDb.select().from(transactions)).toEqual(before)
    expect(await testDb.select().from(portfolioAccrualRepairRuns)).toHaveLength(0)
  })

  it("posts exact balanced non-cash journals and is a no-op on replay", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    await approvePortfolioAccrualRepair(plan, "admin-1", "Reviewed all dates and totals")
    const cashBefore = (await testDb.select().from(transactions))
      .filter((row) => row.depositLocation !== null)

    const first = await applyPortfolioAccrualRepair(plan, "admin-1", backupGate())
    const second = await applyPortfolioAccrualRepair(plan, "admin-1", backupGate())

    expect(first.alreadyApplied).toBe(false)
    expect(second).toEqual({ runId: first.runId, alreadyApplied: true })
    const rows = await testDb.select().from(transactions)
    expect(rows.filter((row) => row.referenceType === "portfolio_accrual_repair"))
      .toEqual([expect.objectContaining({ type: "debit", amount: "100000.00" }),
        expect.objectContaining({ type: "credit", amount: "100000.00" })])
    expect(rows.filter((row) => row.depositLocation !== null)).toEqual(cashBefore)
    const cashflow = await Effect.runPromise(getCashflowData("2025-01"))
    expect(JSON.stringify(cashflow)).not.toContain("Income: Interest Earned")
    expect((await loadPortfolioAccrualPlan(loan.id, asOf, testDb)).classification).toBe("noop")
    expect(await testDb.select().from(portfolioAccrualRepairRuns)).toHaveLength(1)
  })

  it("reverses repaired receivable when a later payment is made", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    await approvePortfolioAccrualRepair(plan, "admin-1", "Reviewed all dates and totals")
    await applyPortfolioAccrualRepair(plan, "admin-1", backupGate())

    await testDb.transaction(async (tx) => {
      await reverseInterestAccrual(tx, {
        loanId: loan.id, paymentDate: "2025-02-01T00:00:00.000Z", actorId: "admin-1",
      })
    })
    const rows = await testDb.select().from(transactions)
    expect(rows.filter((row) => row.loanId === loan.id &&
      row.referenceType === "interest_accrual" && row.type === "credit" &&
      row.amount === "100000.00")).toHaveLength(1)
  })

  it("keeps unpaid repaired interest receivable after a partial cash payment", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    await approvePortfolioAccrualRepair(plan, "admin-1", "Reviewed all dates and totals")
    await applyPortfolioAccrualRepair(plan, "admin-1", backupGate())

    const payment = await Effect.runPromise(recordPayment({ loanId: loan.id,
      paymentDate: "2025-02-01T00:00:00.000Z", amount: "50000.00",
      depositLocation: "cash" }, "admin-1"))
    expect(payment.allocation.interestPortion).toBe("50000.00")
    const rows = await testDb.select({ type: transactions.type, amount: transactions.amount,
      categoryName: transactionCategories.name }).from(transactions)
      .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactions.loanId, loan.id))
    const netCategory = (name: string) => rows.filter((row) => row.categoryName === name)
      .reduce((sum, row) => sum + (row.type === "debit" ? 1 : -1) * Number(row.amount), 0)
    expect(netCategory("Interest Receivable")).toBe(50000)
    expect(netCategory("Interest Earned")).toBe(-100000)
  })

  it("refuses a stale fingerprint after approval", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    await approvePortfolioAccrualRepair(plan, "admin-1", "Reviewed all dates and totals")
    await testDb.update(loans).set({ interestRate: "0.1200" }).where(eq(loans.id, loan.id))

    await expect(applyPortfolioAccrualRepair(plan, "admin-1", backupGate()))
      .rejects.toThrow(/stale|changed/i)
    expect(await testDb.select().from(portfolioAccrualRepairRuns)).toHaveLength(0)
  })

  it("refuses an invalid backup before any journal write", async () => {
    const loan = await seedLoan()
    const plan = await loadPortfolioAccrualPlan(loan.id, asOf, testDb)
    await approvePortfolioAccrualRepair(plan, "admin-1", "Reviewed all dates and totals")
    vi.mocked(verifyPortfolioAccrualBackup).mockRejectedValueOnce(new Error("Invalid backup"))

    await expect(applyPortfolioAccrualRepair(plan, "admin-1", backupGate()))
      .rejects.toThrow(/backup/i)
    expect(await testDb.select().from(portfolioAccrualRepairRuns)).toHaveLength(0)
  })
})
