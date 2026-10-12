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
import { auditLog } from "@/lib/db/schema/audit"
import { historicalRateRepairRuns } from "@/lib/db/schema/historical-rate-repair-runs"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
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

  it("previews a corrected paid-rate loan and invalidates the plan when its run audit changes", async () => {
    const { loan, categories } = await seedLoan()
    const paymentDate = new Date("2025-01-16T00:00:00.000Z")
    const [payment] = await testDb.insert(payments).values({ loanId: loan.id,
      amount: "50000.00", paymentDate, recordedBy: "actor-1",
      depositLocation: "cash" }).returning()
    const paymentGroup = randomUUID()
    const accrualGroup = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories.Cash, type: "debit",
        amount: "50000.00", referenceType: "payment", referenceId: payment.id,
        depositLocation: "cash", journalGroupId: paymentGroup,
        transactionDate: paymentDate, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "payment", referenceId: payment.id,
        journalGroupId: paymentGroup, transactionDate: paymentDate, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "100000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: accrualGroup, transactionDate: januaryEnd, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "100000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: accrualGroup, transactionDate: januaryEnd, recordedBy: "actor-1" },
    ])
    await testDb.update(loans).set({ interestRateOverride: "0.1500" })
      .where(eq(loans.id, loan.id))
    const reviewId = randomUUID()
    const runId = randomUUID()
    const runAsOf = januaryEnd.toISOString()
    await testDb.insert(financialCorrectionAgentReviews).values({ id: reviewId,
      kind: "historical_rate", subjectId: loan.id, planHash: "historical-plan",
      inputFingerprint: "historical-input", policyVersion: "v2",
      reviewerAgentId: "agent:reviewer", reviewRunId: "review-attempt",
      evidenceSha256: "a".repeat(64), evidenceJson: "{}", verdict: "pass",
      findingsJson: "{}", consumedAt: new Date("2025-02-02T00:00:00.000Z"),
      consumedByRunId: runId })
    await testDb.insert(historicalRateRepairRuns).values({ id: runId, loanId: loan.id,
      planHash: "historical-plan", inputFingerprint: "historical-input",
      policyVersion: "v2", agentReviewId: reviewId,
      appliedByAgent: "agent:executor", backupSha256: "a".repeat(64),
      appliedAt: new Date("2025-02-02T00:00:00.000Z"),
      beforeSummary: JSON.stringify({ loanId: loan.id, classification: "review",
        planHash: "historical-plan", inputFingerprint: "historical-input",
        policyVersion: "v2", correctedRate: "0.1500", asOf: runAsOf,
        changes: [{ id: payment.id, newInterest: "50000.00", newPrincipal: "0.00" }] }),
      afterSummary: JSON.stringify({ loanId: loan.id, classification: "noop",
        policyVersion: "v2", correctedRate: "0.1500", asOf: runAsOf,
        accrualJournalDelta: "0.00", accrualJournalTarget: "100000.00",
        exceptions: [], endingPrincipal: "1000000.00",
        changes: [{ id: payment.id, oldInterest: "50000.00",
          oldPrincipal: "0.00", newInterest: "50000.00", newPrincipal: "0.00" }] }) })
    const [audit] = await testDb.insert(auditLog).values({ entityType: "loan",
      entityId: loan.id, action: "historical_rate_corrected_by_agent",
      beforeValue: JSON.stringify({ interestRateOverride: "0.1500" }),
      afterValue: JSON.stringify({ interestRateOverride: "0.1500",
        rateSemantics: "correction", effectiveFrom: loan.startDate.toISOString(),
        repairedPlanHash: "historical-plan", agentReviewId: reviewId,
        reviewerAgentId: "agent:reviewer", executorAgentId: "agent:executor",
        repairRunId: runId }), occurredAt: new Date("2025-02-02T00:00:00.000Z")
    }).returning()
    const previewAsOf = new Date("2025-02-28T23:59:59.999Z")
    const first = await loadPortfolioAccrualPlan(loan.id, previewAsOf, testDb)
    expect(first.classification).toBe("ready")
    const portfolioRunId = randomUUID()
    const portfolioReviewId = randomUUID()
    const portfolioDate = new Date("2025-01-31T23:59:59.999Z")
    await testDb.insert(financialCorrectionAgentReviews).values({ id: portfolioReviewId,
      kind: "portfolio_accrual", subjectId: loan.id, planHash: "portfolio-plan",
      inputFingerprint: "portfolio-input", policyVersion: "v3",
      reviewerAgentId: "agent:portfolio-reviewer", reviewRunId: "portfolio-review-attempt",
      evidenceSha256: "b".repeat(64), evidenceJson: "{}", verdict: "pass",
      findingsJson: "{}", consumedAt: new Date("2025-02-03T00:00:00.000Z"),
      consumedByRunId: portfolioRunId })
    await testDb.insert(portfolioAccrualRepairRuns).values({ id: portfolioRunId,
      loanId: loan.id, planHash: "portfolio-plan", inputFingerprint: "portfolio-input",
      policyVersion: "v3", agentReviewId: portfolioReviewId,
      appliedByAgent: "agent:portfolio-executor", backupSha256: "b".repeat(64),
      beforeSummary: "{}", afterSummary: "{}",
      appliedAt: new Date("2025-02-03T00:00:00.000Z") })
    const portfolioGroup = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "50000.00", referenceType: "portfolio_accrual_repair",
        referenceId: portfolioRunId, journalGroupId: portfolioGroup,
        transactionDate: portfolioDate, recordedBy: "agent:portfolio-executor" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "portfolio_accrual_repair",
        referenceId: portfolioRunId, journalGroupId: portfolioGroup,
        transactionDate: portfolioDate, recordedBy: "agent:portfolio-executor" },
    ])
    const afterPortfolio = await loadPortfolioAccrualPlan(loan.id, previewAsOf, testDb)
    expect(afterPortfolio.classification).toBe("ready")
    await testDb.update(portfolioAccrualRepairRuns).set({
      appliedAt: new Date("2025-02-01T00:00:00.000Z"),
    }).where(eq(portfolioAccrualRepairRuns.id, portfolioRunId))
    expect((await loadPortfolioAccrualPlan(loan.id, previewAsOf, testDb)).classification)
      .toBe("blocked")
    await testDb.update(portfolioAccrualRepairRuns).set({
      appliedAt: new Date("2025-02-03T00:00:00.000Z"),
    }).where(eq(portfolioAccrualRepairRuns.id, portfolioRunId))
    const [storedRun] = await testDb.select().from(historicalRateRepairRuns)
      .where(eq(historicalRateRepairRuns.id, runId))
    await testDb.update(historicalRateRepairRuns).set({ afterSummary: JSON.stringify({
      ...JSON.parse(storedRun.afterSummary), accrualJournalTarget: "999999.00",
    }) }).where(eq(historicalRateRepairRuns.id, runId))
    const contradictory = await loadPortfolioAccrualPlan(loan.id, previewAsOf, testDb)
    expect(contradictory.classification).toBe("blocked")
    expect(contradictory.inputFingerprint).not.toBe(first.inputFingerprint)
    await testDb.update(historicalRateRepairRuns).set({ afterSummary: storedRun.afterSummary })
      .where(eq(historicalRateRepairRuns.id, runId))
    await testDb.update(auditLog).set({ afterValue: JSON.stringify({
      interestRateOverride: "0.1500", rateSemantics: "correction",
      effectiveFrom: "2025-01-02T00:00:00.000Z", repairedPlanHash: "historical-plan",
      agentReviewId: reviewId, reviewerAgentId: "agent:reviewer",
      executorAgentId: "agent:executor", repairRunId: runId,
    }) }).where(eq(auditLog.id, audit.id))
    const stale = await loadPortfolioAccrualPlan(loan.id, previewAsOf, testDb)
    expect(stale.classification).toBe("blocked")
    expect(stale.inputFingerprint).not.toBe(first.inputFingerprint)
  })

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

  it("credits an attributed prior pair toward the remaining receivable", async () => {
    const { loan, categories } = await seedLoan()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
    ])

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)
    expect(plan.classification).toBe("ready")
    expect(plan.entries).toEqual([expect.objectContaining({ delta: "50000.00" })])
  })

  it.each([
    ["loan", { loanId: null }],
    ["reference type", { referenceType: "other_accrual" }],
    ["reference id", { referenceId: "other-loan" }],
    ["effective date", { transactionDate: new Date("2025-01-30T23:59:59.999Z") }],
    ["deposit location", { depositLocation: "cash" as const }],
  ])("blocks a prior receivable pair with mismatched %s attribution", async (_field, patch) => {
    const { loan, categories } = await seedLoan()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1", ...patch },
    ])

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)
    expect(plan.classification).toBe("blocked")
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/Receivable journal .*counterpart/),
    ]))
  })

  it("blocks a prior journal group that also contains another loan's leg", async () => {
    const { loan, categories } = await seedLoan()
    const [otherLoan] = await testDb.insert(loans).values({
      customerId: loan.customerId, principalAmount: "1000.00",
      interestRate: "0.1000", startDate: start,
      issuanceFee: "0.00", status: "active", issuedBy: "actor-1",
      disbursementSource: "cash",
    }).returning()
    const group = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Receivable"], type: "debit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "credit",
        amount: "50000.00", referenceType: "interest_accrual", referenceId: loan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
      { loanId: otherLoan.id, categoryId: categories.Cash, type: "debit",
        amount: "1.00", referenceType: "loan", referenceId: otherLoan.id,
        journalGroupId: group, transactionDate: januaryEnd, recordedBy: "actor-1" },
    ])

    const plan = await loadPortfolioAccrualPlan(loan.id, januaryEnd, testDb)
    expect(plan.classification).toBe("blocked")
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/Receivable journal .*counterpart/),
    ]))
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
