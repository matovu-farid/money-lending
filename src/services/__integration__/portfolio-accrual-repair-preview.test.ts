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
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"
import { loadPortfolioAccrualPlan, provePaymentJournalHistory,
  unresolvedPaymentJournalExceptions,
  validatePaymentSettlementHistory } from
  "../portfolio-accrual-repair.service"
import { accrueInterestForLoans } from "../transaction.service"

const start = new Date("2025-01-01T00:00:00.000Z")
const januaryEnd = new Date("2025-01-31T23:59:59.999Z")

const historyLoanId = "11111111-1111-4111-8111-111111111111"
const historyPaymentId = "22222222-2222-4222-8222-222222222222"
const historyOldDate = new Date("2025-01-16T12:00:00.000Z")
const historyNewDate = new Date("2025-01-20T09:00:00.000Z")
const historyDeletedAt = new Date("2025-01-21T09:00:00.000Z")

function historyPayment(date = historyNewDate, deletedAt: Date | null = null) {
  return { id: historyPaymentId, loanId: historyLoanId, amount: "100.00",
    paymentDate: date, deletedAt, markedWrong: false,
    depositLocation: "cash", subLocationId: null }
}

function historyPair(referenceType: "payment" | "payment_reversal",
  date: Date, amount: string, categoryId: string, groupId: string,
  createdAt: Date) {
  const reversed = referenceType === "payment_reversal"
  const common = { loanId: historyLoanId, referenceType,
    referenceId: historyPaymentId, journalGroupId: groupId, date,
    amount, createdAt }
  return [
    { ...common, id: `${groupId}-cash`, categoryId: "cash", categoryName: "Cash",
      categoryType: "asset",
      type: (reversed ? "credit" : "debit") as "debit" | "credit",
      depositLocation: "cash", subLocationId: null },
    { ...common, id: `${groupId}-offset`, categoryId,
      categoryName: categoryId === "interest" ? "Interest Earned" : "Loans Receivable",
      categoryType: categoryId === "interest" ? "revenue" : "asset",
      type: (reversed ? "debit" : "credit") as "debit" | "credit",
      depositLocation: null, subLocationId: null },
  ]
}

function historyAudit(action: string, before: object | null, after: object,
  occurredAt: Date) {
  return { id: randomUUID(), entityType: "payment", entityId: historyPaymentId,
    action, beforeValue: before && JSON.stringify(before),
    afterValue: JSON.stringify(after), occurredAt }
}

function historyFixture(kind: "deleted" | "edited") {
  const old = historyPayment(historyOldDate)
  const current = kind === "deleted"
    ? historyPayment(historyOldDate, historyDeletedAt) : historyPayment()
  const originalAt = new Date("2025-01-17T00:00:00.000Z")
  const reversalAt = new Date("2025-01-19T00:00:00.000Z")
  const repostAt = new Date("2025-01-20T10:00:00.000Z")
  const rows = [
    ...historyPair("payment", historyOldDate, "30.00", "interest",
      "original-interest", originalAt),
    ...historyPair("payment", historyOldDate, "70.00", "principal",
      "original-principal", originalAt),
    ...historyPair("payment_reversal", historyOldDate, "30.00", "interest",
      "reversal-interest", reversalAt),
    ...historyPair("payment_reversal", historyOldDate, "70.00", "principal",
      "reversal-principal", reversalAt),
    ...(kind === "edited" ? [
      ...historyPair("payment", historyNewDate, "40.00", "interest",
        "current-interest", repostAt),
      ...historyPair("payment", historyNewDate, "60.00", "principal",
        "current-principal", repostAt),
    ] : []),
  ]
  const auditRows = kind === "deleted"
    ? [historyAudit("payment.delete", old, current, historyDeletedAt)]
    : [historyAudit("payment.update", old, current, repostAt)]
  return { payment: current, journalRows: rows, groupRows: rows, auditRows }
}

type HistoryFixture = ReturnType<typeof historyFixture>
function proveHistory(input: HistoryFixture): string[] {
  return provePaymentJournalHistory(input)
}

function paidRateHistoryFixture() {
  const payment = historyPayment()
  const cashRows = historyPair("payment", historyNewDate, "100.00",
    "principal", "paid-rate-cash", historyNewDate)
  const correctionAt = new Date("2025-02-01T00:00:00.000Z")
  const correction = [
    { ...cashRows[1], id: "rate-principal", journalGroupId: "rate-reclassification",
      amount: "20.00", type: "debit" as const, createdAt: correctionAt,
      description: "Historical rate repair reviewed-plan", recordedBy: "agent:executor" },
    { ...cashRows[1], id: "rate-interest", journalGroupId: "rate-reclassification",
      categoryId: "interest", categoryName: "Interest Earned",
      categoryType: "revenue", amount: "20.00", type: "credit" as const,
      createdAt: correctionAt,
      description: "Historical rate repair reviewed-plan", recordedBy: "agent:executor" },
  ]
  const expectedEntries = [
    { categoryName: "Interest Earned", type: "credit", amount: "20.00",
      referenceType: "payment", referenceId: payment.id,
      date: payment.paymentDate.toISOString() },
    { categoryName: "Loans Receivable", type: "debit", amount: "20.00",
      referenceType: "payment", referenceId: payment.id,
      date: payment.paymentDate.toISOString() },
  ]
  const evidence = { loanId: payment.loanId, expectedEntries }
  const rateProof = {
    run: { id: "rate-run", loanId: payment.loanId, planHash: "reviewed-plan",
      inputFingerprint: "reviewed-input", policyVersion: "v2",
      agentReviewId: "rate-review", appliedByAgent: "agent:executor",
      appliedAt: correctionAt, beforeSummary: JSON.stringify({
        loanId: payment.loanId, planHash: "reviewed-plan",
        inputFingerprint: "reviewed-input", policyVersion: "v2",
        classification: "review",
        changes: [{ id: payment.id, kind: "payment", date: payment.paymentDate,
          amount: payment.amount, oldInterest: "0.00", oldPrincipal: "100.00",
          oldOverpayment: "0.00", newInterest: "20.00",
          newPrincipal: "80.00", newOverpayment: "0.00" }],
      }) },
    review: { id: "rate-review", kind: "historical_rate", subjectId: payment.loanId,
      planHash: "reviewed-plan", inputFingerprint: "reviewed-input",
      policyVersion: "v2", verdict: "pass", consumedByRunId: "rate-run",
      consumedAt: correctionAt, reviewerAgentId: "agent:reviewer",
      evidenceJson: JSON.stringify(evidence),
      evidenceSha256: hashReviewEvidence(evidence) },
  }
  const journalRows = [...cashRows, ...correction]
  return { payment, journalRows, groupRows: journalRows, auditRows: [], rateProof }
}

describe("portfolio settlement history proof without database writes", () => {
  it.each(["payment", "payment_reversal"] as const)(
    "rejects a %s journal on this loan with no loaded payment row", (referenceType) => {
      const rows = historyPair(referenceType, historyNewDate, "100.00",
        "principal", "orphan-group", historyNewDate).map((row) => ({ ...row,
        referenceId: "33333333-3333-4333-8333-333333333333" }))
      expect(unresolvedPaymentJournalExceptions(historyLoanId,
        [historyPaymentId], rows)).not.toEqual([])
    },
  )

  it("keeps an ordinary paid-rate Cash payment valid beside its non-Cash reclassification", () => {
    expect(validatePaymentSettlementHistory(paidRateHistoryFixture())).toEqual([])
  })

  it("rejects an unsupported balanced non-Cash reclassification", () => {
    const fixture = paidRateHistoryFixture()
    for (const row of fixture.journalRows.filter((item) =>
      item.journalGroupId === "rate-reclassification")) row.amount = "21.00"
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("rejects a duplicate non-Cash reclassification despite a valid rate review", () => {
    const fixture = paidRateHistoryFixture()
    fixture.journalRows.push(...fixture.journalRows.filter((row) =>
      row.journalGroupId === "rate-reclassification").map((row) => ({ ...row,
        id: `duplicate-${row.id}`, journalGroupId: "duplicate-rate-group" })))
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("rejects non-Cash reclassification without a linked rate review", () => {
    const { payment, journalRows, groupRows, auditRows } = paidRateHistoryFixture()
    expect(validatePaymentSettlementHistory({ payment, journalRows, groupRows,
      auditRows })).not.toEqual([])
  })

  it("rejects reclassification when reviewed evidence digest is wrong", () => {
    const fixture = paidRateHistoryFixture()
    fixture.rateProof.review.evidenceSha256 = "0".repeat(64)
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("rejects reclassification not bound to the completed rate run", () => {
    const fixture = paidRateHistoryFixture()
    fixture.rateProof.review.consumedByRunId = "another-run"
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("does not bypass an incomplete same-day reversal beside a rate reclassification", () => {
    const fixture = paidRateHistoryFixture()
    fixture.journalRows.push(historyPair("payment_reversal", historyNewDate,
      "100.00", "principal", "incomplete-reversal", historyDeletedAt)[0])
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("does not bypass a wrong Cash location beside a rate reclassification", () => {
    const fixture = paidRateHistoryFixture()
    fixture.journalRows[0].depositLocation = "bank"
    expect(validatePaymentSettlementHistory(fixture)).not.toEqual([])
  })

  it("accepts an ordinary active payment with current-date journals and no audit", () => {
    const payment = historyPayment()
    const journalRows = historyPair("payment", historyNewDate, "100.00",
      "principal", "ordinary-payment", historyNewDate)
    expect(proveHistory({ payment, journalRows, groupRows: journalRows,
      auditRows: [] })).toEqual([])
  })

  it("accepts a deleted payment with an audit and exactly reversed journals", () => {
    expect(proveHistory(historyFixture("deleted"))).toEqual([])
  })

  it("rejects a deleted payment audited at B when all Cash was posted at A", () => {
    const fixture = historyFixture("deleted")
    fixture.payment.paymentDate = historyNewDate
    fixture.auditRows[0].beforeValue = JSON.stringify(historyPayment(historyNewDate))
    fixture.auditRows[0].afterValue = JSON.stringify(fixture.payment)
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("conservatively blocks edit-then-delete until its full audit chain is proved", () => {
    const fixture = historyFixture("deleted")
    fixture.auditRows.unshift(historyAudit("payment.update",
      historyPayment(historyOldDate), historyPayment(historyNewDate), historyNewDate))
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("accepts an audited date edit with exactly canceled old journals", () => {
    expect(proveHistory(historyFixture("edited"))).toEqual([])
  })

  it("rejects a deleted payment whose reversed cash was less than the payment row", () => {
    const fixture = historyFixture("deleted")
    for (const row of fixture.journalRows.filter((item) =>
      item.categoryId === "principal")) row.amount = "60.00"
    for (const row of fixture.journalRows.filter((item) =>
      item.categoryId === "cash" && item.journalGroupId?.includes("principal"))) {
      row.amount = "60.00"
    }
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects an edited payment whose old cash does not match its audit", () => {
    const fixture = historyFixture("edited")
    for (const row of fixture.journalRows.filter((item) =>
      item.journalGroupId?.includes("principal") &&
      item.date.getTime() === historyOldDate.getTime())) {
      row.amount = "60.00"
    }
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects an exactly reversed posting to an unexpected account", () => {
    const fixture = historyFixture("deleted")
    for (const row of fixture.journalRows.filter((item) =>
      item.categoryId === "principal")) {
      row.categoryId = "suspense"
      row.categoryName = "Suspense"
    }
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects a wrong-type account even when its journal reverses exactly", () => {
    const fixture = historyFixture("deleted")
    for (const row of fixture.journalRows.filter((item) =>
      item.categoryId === "interest")) row.categoryType = "asset"
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("keeps marked-wrong payments blocked", () => {
    const fixture = historyFixture("edited")
    fixture.payment.markedWrong = true
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects a deleted payment without a matching delete audit", () => {
    const fixture = historyFixture("deleted")
    fixture.auditRows = []
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects a deleted payment with a contradictory delete audit", () => {
    const fixture = historyFixture("deleted")
    fixture.auditRows[0].afterValue = JSON.stringify({
      ...fixture.payment, amount: "101.00",
    })
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects an active date edit without an update audit", () => {
    const fixture = historyFixture("edited")
    fixture.auditRows = []
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects an active date edit whose audit ends at another date", () => {
    const fixture = historyFixture("edited")
    fixture.auditRows[0].afterValue = JSON.stringify({
      ...fixture.payment, paymentDate: historyOldDate,
    })
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects a partial reversal even when each remaining group balances", () => {
    const fixture = historyFixture("deleted")
    const rows = fixture.journalRows.filter((row) =>
      row.journalGroupId !== "reversal-principal")
    fixture.journalRows = rows
    fixture.groupRows = rows
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it("rejects a duplicate reversal", () => {
    const fixture = historyFixture("deleted")
    const duplicate = historyPair("payment_reversal", historyOldDate, "30.00",
      "interest", "duplicate-reversal", historyDeletedAt)
    fixture.journalRows.push(...duplicate)
    expect(proveHistory(fixture)).not.toEqual([])
  })

  it.each([
    ["amount", (row: ReturnType<typeof historyPair>[number]) => {
      row.amount = "31.00"
    }],
    ["date", (row: ReturnType<typeof historyPair>[number]) => {
      row.date = historyNewDate
    }],
    ["category", (row: ReturnType<typeof historyPair>[number]) => {
      row.categoryId = "suspense"
      row.categoryName = "Suspense"
    }],
    ["loan", (row: ReturnType<typeof historyPair>[number]) => {
      row.loanId = "33333333-3333-4333-8333-333333333333"
    }],
    ["location", (row: ReturnType<typeof historyPair>[number]) => {
      row.depositLocation = "bank"
    }],
    ["group", (row: ReturnType<typeof historyPair>[number]) => {
      row.journalGroupId = "wrong-group"
    }],
  ])("rejects a reversal with the wrong %s", (_field, mutate) => {
    const fixture = historyFixture("deleted")
    const cash = fixture.journalRows.find((row) =>
      row.journalGroupId === "reversal-interest" && row.categoryName === "Cash")!
    mutate(cash)
    expect(proveHistory(fixture)).not.toEqual([])
  })
})

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
