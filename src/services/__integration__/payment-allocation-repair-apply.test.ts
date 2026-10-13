import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { resetDb, seedCategories, testDb } from "./setup"
import { auditLog } from "@/lib/db/schema/audit"
import { customers } from "@/lib/db/schema/customers"
import { financialCorrectionAgentReviews } from "@/lib/db/schema/financial-correction-agent-reviews"
import { loans } from "@/lib/db/schema/loans"
import { paymentAllocationRepairRuns } from "@/lib/db/schema/payment-allocation-repair-runs"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { payments } from "@/lib/db/schema/payments"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { transactions } from "@/lib/db/schema/transactions"
import { planFullyPaidAllocationRepair } from "@/lib/interest/fully-paid-allocation-repair"
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"
import { verifyPaymentAllocationBackup } from "@/lib/interest/payment-allocation-backup"
import { loadFullyPaidAllocationSnapshot } from "../payment-allocation-repair.service"
import { applyFullyPaidAllocationRepair, reviewFullyPaidAllocationRepair } from
  "../payment-allocation-repair-apply.service"
import { loadPortfolioAccrualPlan, loadPortfolioAccrualSnapshot } from
  "../portfolio-accrual-repair.service"

vi.mock("@/lib/interest/payment-allocation-backup", () => ({
  verifyPaymentAllocationBackup: vi.fn(async () => ({
    dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
  })),
}))

const reviewedAsOf = new Date("2026-10-10T23:59:59.999Z")
const backupGate = () => ({
  manifestPath: "/private/tmp/integration.dump.manifest.json",
  expectedDumpSha256: "b".repeat(64),
  primaryUrl: process.env.DATABASE_URL!, directUrl: process.env.DATABASE_URL_UNPOOLED!,
})

async function seedReadyLoan() {
  await seedCategories()
  await testDb.insert(transactionCategories).values({
    name: "Overpayment Revenue", type: "revenue", isDefault: true,
  })
  const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
    .map((row) => [row.name, row.id]))
  const [customer] = await testDb.insert(customers).values({
    fullName: "Allocation Apply Fixture", nin: "C1234567890987",
    contact: "+256700000987", address: "Kampala",
  }).returning()
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id, principalAmount: "7000000.00", interestRate: "0.1000",
    penaltyMultiplier: "0.1000", minInterestDays: 30,
    startDate: new Date("2026-05-05T00:00:00.000Z"),
    issuanceFee: "0.00", status: "fully_paid", loanType: "perpetual",
    issuedBy: "actor-1", disbursementSource: "cash",
  }).returning()
  await testDb.insert(auditLog).values({ actorId: "actor-1", action: "loan.create",
    entityType: "loan", entityId: loan.id, beforeValue: null,
    afterValue: JSON.stringify(loan) })
  const issueGroup = randomUUID()
  await testDb.insert(transactions).values([
    { loanId: loan.id, categoryId: categories["Loans Receivable"], type: "debit",
      amount: loan.principalAmount, referenceType: "loan", referenceId: loan.id,
      journalGroupId: issueGroup, transactionDate: loan.startDate, recordedBy: "actor-1" },
    { loanId: loan.id, categoryId: categories.Cash, type: "credit",
      amount: loan.principalAmount, referenceType: "loan", referenceId: loan.id,
      depositLocation: "cash", journalGroupId: issueGroup,
      transactionDate: loan.startDate, recordedBy: "actor-1" },
  ])
  const entries = [
    { date: "2026-06-30T12:00:00.000Z", amount: "7700000.00", location: "strong_room" as const,
      interest: "1306666.67", principal: "6393333.33", overpayment: "0.00" },
    { date: "2026-07-01T12:00:00.000Z", amount: "680000.00", location: "cash" as const,
      interest: "0.00", principal: "606666.67", overpayment: "73333.33" },
  ]
  const paymentIds: string[] = []
  for (const item of entries) {
    const [payment] = await testDb.insert(payments).values({ loanId: loan.id,
      paymentDate: new Date(item.date), amount: item.amount, recordedBy: "actor-1",
      depositLocation: item.location }).returning()
    paymentIds.push(payment.id)
    await testDb.insert(auditLog).values({ actorId: "actor-1", action: "payment.create",
      entityType: "payment", entityId: payment.id, beforeValue: null,
      afterValue: JSON.stringify(payment) })
    for (const [account, amount] of [
      ["Interest Earned", item.interest], ["Loans Receivable", item.principal],
      ["Overpayment Revenue", item.overpayment],
    ]) {
      if (amount === "0.00") continue
      const group = randomUUID()
      await testDb.insert(transactions).values([
        { loanId: loan.id, categoryId: categories.Cash, type: "debit",
          amount, referenceType: "payment", referenceId: payment.id,
          depositLocation: item.location, journalGroupId: group,
          transactionDate: payment.paymentDate, recordedBy: "actor-1" },
        { loanId: loan.id, categoryId: categories[account], type: "credit",
          amount, referenceType: "payment", referenceId: payment.id,
          journalGroupId: group, transactionDate: payment.paymentDate,
          recordedBy: "actor-1" },
      ])
    }
  }
  const snapshot = await loadFullyPaidAllocationSnapshot(loan.id, reviewedAsOf, testDb)
  const plan = planFullyPaidAllocationRepair(snapshot)
  expect(plan.status, plan.blockers.join("; ")).toBe("ready")
  return { loan, paymentIds, plan }
}

describe("fully-paid payment allocation agent review and apply", () => {
  beforeEach(async () => {
    await resetDb()
    vi.mocked(verifyPaymentAllocationBackup).mockResolvedValue({
      dumpPath: "/private/tmp/integration.dump", dumpSha256: "b".repeat(64),
    })
  })

  it("posts reviewed payment-referenced non-cash groups and observes a later noop", async () => {
    const { loan, paymentIds, plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-1")
    const original = await testDb.select().from(transactions)
    const result = await applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate())
    expect(result.alreadyApplied).toBe(false)
    const after = await testDb.select().from(transactions)
    expect(after.filter((row) => row.categoryId === original.find((old) =>
      old.depositLocation !== null)?.categoryId && row.depositLocation !== null))
      .toEqual(original.filter((row) => row.depositLocation !== null))
    const correction = after.filter((row) => !original.some((old) => old.id === row.id))
    expect(correction).toHaveLength(5)
    expect(correction.every((row) => row.referenceType === "payment" &&
      paymentIds.includes(row.referenceId ?? "") && row.depositLocation === null)).toBe(true)
    const [run] = await testDb.select().from(paymentAllocationRepairRuns)
    expect(run.id).toBe(result.runId)
    expect(JSON.parse(run.afterSummary).groups).toHaveLength(2)
    expect(correction.every((row) => row.recordedBy === "agent:executor" &&
      row.createdAt.getTime() === run.appliedAt.getTime())).toBe(true)
    const [review] = await testDb.select().from(financialCorrectionAgentReviews)
    expect(review.consumedByRunId).toBe(run.id)
    expect(review.consumedAt?.getTime()).toBe(run.appliedAt.getTime())
    const observedAt = new Date(Math.max(Date.now(), run.appliedAt.getTime() + 1))
    const post = planFullyPaidAllocationRepair(await loadFullyPaidAllocationSnapshot(
      loan.id, observedAt, testDb))
    expect(post.status, post.blockers.join("; ")).toBe("noop")
    expect(await applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .toEqual({ runId: run.id, alreadyApplied: true })
  })

  it("does not claim idempotence after a correction leg has been partially removed", async () => {
    const { plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-2")
    const { runId } = await applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate())
    const [leg] = (await testDb.select().from(transactions)).filter((row) =>
      row.description?.includes(`Payment allocation repair run ${runId}`))
    await testDb.delete(transactions).where(eq(transactions.id, leg.id))

    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/already-applied|reconcile|correction|incomplete/i)
    expect(await testDb.select().from(paymentAllocationRepairRuns)).toHaveLength(1)
  })

  it("blocks a balanced non-cash orphan payment journal in preview and apply", async () => {
    const { loan, plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-orphan")
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]))
    const groupId = randomUUID()
    const unknownPayment = randomUUID()
    await testDb.insert(transactions).values([
      { loanId: loan.id, categoryId: categories["Interest Earned"], type: "debit",
        amount: "1.00", referenceType: "payment", referenceId: unknownPayment,
        journalGroupId: groupId, transactionDate: reviewedAsOf, recordedBy: "actor-1" },
      { loanId: loan.id, categoryId: categories["Overpayment Revenue"], type: "credit",
        amount: "1.00", referenceType: "payment", referenceId: unknownPayment,
        journalGroupId: groupId, transactionDate: reviewedAsOf, recordedBy: "actor-1" },
    ])
    const preview = planFullyPaidAllocationRepair(await loadFullyPaidAllocationSnapshot(
      loan.id, reviewedAsOf, testDb))
    expect(preview.status).toBe("blocked")
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/stale|source changed/i)
    expect(await testDb.select().from(paymentAllocationRepairRuns)).toHaveLength(0)
  })

  it("blocks a changed loan term after review without consuming the review", async () => {
    const { loan, plan } = await seedReadyLoan()
    const reviewed = await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-stale")
    await testDb.update(loans).set({ interestRate: "0.1200" }).where(eq(loans.id, loan.id))
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/stale|source changed/i)
    const [review] = await testDb.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, reviewed.reviewId))
    expect(review.consumedAt).toBeNull()
    expect(await testDb.select().from(paymentAllocationRepairRuns)).toHaveLength(0)
  })

  it("blocks a tampered review digest and a same-agent executor", async () => {
    const { plan } = await seedReadyLoan()
    const reviewed = await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-tampered")
    await expect(applyFullyPaidAllocationRepair(plan, "agent:reviewer", backupGate()))
      .rejects.toThrow(/distinct/i)
    await testDb.update(financialCorrectionAgentReviews)
      .set({ evidenceSha256: "f".repeat(64) })
      .where(eq(financialCorrectionAgentReviews.id, reviewed.reviewId))
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/digest/i)
    expect(await testDb.select().from(paymentAllocationRepairRuns)).toHaveLength(0)
  })

  it("requires an exact rehearsal proof for normal apply and rejects rehearsal bypass here", async () => {
    const { plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-backup")
    vi.mocked(verifyPaymentAllocationBackup).mockRejectedValueOnce(
      new Error("Exact payment allocation plan was not rehearsed on this backup"))
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/not rehearsed/i)
    expect(vi.mocked(verifyPaymentAllocationBackup).mock.calls.at(-1)?.[1])
      .toMatchObject({ loanId: plan.loanId, planHash: plan.planHash,
        inputFingerprint: plan.sourceFingerprint, asOf: reviewedAsOf })
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate(),
      { rehearsal: true })).rejects.toThrow(/isolated restored rehearsal/i)
    expect(await testDb.select().from(paymentAllocationRepairRuns)).toHaveLength(0)
  })

  it("does not claim idempotence after a duplicate correction group is appended", async () => {
    const { loan, plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-duplicate")
    const { runId } = await applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate())
    const rows = (await testDb.select().from(transactions)).filter((row) =>
      row.description?.includes(`Payment allocation repair run ${runId}`))
    const duplicateGroup = randomUUID()
    await testDb.insert(transactions).values(rows.slice(0, 2).map((row) => ({
      loanId: loan.id, categoryId: row.categoryId, type: row.type, amount: row.amount,
      referenceType: row.referenceType, referenceId: row.referenceId,
      description: row.description, journalGroupId: duplicateGroup,
      transactionDate: row.transactionDate, recordedBy: row.recordedBy,
      createdAt: row.createdAt,
    })))
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/already-applied|reconcile|correction/i)
  })

  it("does not claim idempotence after a correction amount is tampered", async () => {
    const { plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:reviewer", "review-run-amount")
    const { runId } = await applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate())
    const [leg] = (await testDb.select().from(transactions)).filter((row) =>
      row.description?.includes(`Payment allocation repair run ${runId}`))
    await testDb.update(transactions).set({ amount: "0.34" })
      .where(eq(transactions.id, leg.id))
    await expect(applyFullyPaidAllocationRepair(plan, "agent:executor", backupGate()))
      .rejects.toThrow(/already-applied|reconcile|correction/i)
  })

  it("keeps allocation and portfolio proofs valid after reviewed dated accruals", async () => {
    const { loan, plan } = await seedReadyLoan()
    await reviewFullyPaidAllocationRepair(plan, "agent:allocation-reviewer", "review-accrual-chain")
    await applyFullyPaidAllocationRepair(plan, "agent:allocation-executor", backupGate())
    const portfolio = await loadPortfolioAccrualPlan(loan.id, reviewedAsOf, testDb)
    expect(portfolio.classification, portfolio.exceptions.join("; ")).toBe("ready")
    expect(portfolio.entries.length).toBeGreaterThan(0)
    const appliedAt = new Date()
    const portfolioSource = await loadPortfolioAccrualSnapshot(loan.id, reviewedAsOf, testDb)
    const evidence = { loanId: loan.id, asOf: portfolio.asOf.toISOString(),
      checkpoints: portfolio.entries.map((entry) => ({ ...entry,
        date: entry.date.toISOString() })), sourceDigest: portfolioSource.sourceDigest }
    const [review] = await testDb.insert(financialCorrectionAgentReviews).values({
      kind: "portfolio_accrual", subjectId: loan.id, planHash: portfolio.planHash,
      inputFingerprint: portfolio.inputFingerprint, policyVersion: portfolio.policyVersion,
      reviewerAgentId: "agent:portfolio-reviewer", reviewRunId: "review-portfolio-chain",
      evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence),
      verdict: "pass", findingsJson: "{}",
    }).returning()
    const [run] = await testDb.insert(portfolioAccrualRepairRuns).values({
      loanId: loan.id, planHash: portfolio.planHash,
      inputFingerprint: portfolio.inputFingerprint, policyVersion: portfolio.policyVersion,
      agentReviewId: review.id, appliedByAgent: "agent:portfolio-executor",
      backupSha256: "c".repeat(64), appliedAt,
      beforeSummary: JSON.stringify({ asOf: portfolio.asOf, entries: portfolio.entries }),
      afterSummary: JSON.stringify({ classification: "pending" }),
    }).returning()
    await testDb.update(financialCorrectionAgentReviews)
      .set({ consumedByRunId: run.id, consumedAt: appliedAt })
      .where(eq(financialCorrectionAgentReviews.id, review.id))
    const categories = Object.fromEntries((await testDb.select().from(transactionCategories))
      .map((row) => [row.name, row.id]))
    for (const entry of portfolio.entries) {
      const positive = !entry.delta.startsWith("-")
      const groupId = randomUUID()
      const common = { loanId: loan.id, referenceType: "portfolio_accrual_repair",
        referenceId: run.id, description: `Portfolio interest repair ${run.id}`,
        transactionDate: entry.date, createdAt: appliedAt,
        recordedBy: "agent:portfolio-executor", journalGroupId: groupId,
        amount: entry.delta.replace("-", "") }
      await testDb.insert(transactions).values([
        { ...common, categoryId: categories[positive ? "Interest Receivable" :
          "Interest Earned"], type: "debit" },
        { ...common, categoryId: categories[positive ? "Interest Earned" :
          "Interest Receivable"], type: "credit" },
      ])
    }
    const allocationAfter = planFullyPaidAllocationRepair(
      await loadFullyPaidAllocationSnapshot(loan.id, reviewedAsOf, testDb))
    expect(allocationAfter.status, allocationAfter.blockers.join("; ")).toBe("noop")
    const portfolioAfter = await loadPortfolioAccrualPlan(loan.id, reviewedAsOf, testDb)
    expect(portfolioAfter.classification, portfolioAfter.exceptions.join("; ")).toBe("noop")

    // A matching edit to the run summary and both journal legs must still fail,
    // because the independent review retained the original checkpoint amount.
    const before = JSON.parse(run.beforeSummary) as { asOf: string;
      entries: Array<{ delta: string }> }
    before.entries[0].delta = "606668.00"
    await testDb.update(portfolioAccrualRepairRuns)
      .set({ beforeSummary: JSON.stringify(before) })
      .where(eq(portfolioAccrualRepairRuns.id, run.id))
    const [firstAccrualLeg] = (await testDb.select().from(transactions))
      .filter((row) => row.referenceId === run.id &&
        row.transactionDate.getTime() === portfolio.entries[0].date.getTime())
    await testDb.update(transactions).set({ amount: "606668.00" })
      .where(eq(transactions.journalGroupId, firstAccrualLeg.journalGroupId!))
    const tamperedSource = await loadFullyPaidAllocationSnapshot(loan.id,
      reviewedAsOf, testDb)
    expect(tamperedSource.sourceExceptions.some((issue) =>
      issue.includes("no exact reviewed journal proof"))).toBe(true)
    expect(planFullyPaidAllocationRepair(tamperedSource).status).toBe("blocked")
  })
})
