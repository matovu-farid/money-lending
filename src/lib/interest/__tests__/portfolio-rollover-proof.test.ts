import { describe, expect, it } from "vitest"
import type { ChainSnapshot } from "@/lib/interest/rollover-correction"
import { assertRolloverCarryCoversAccrued, provePortfolioRolloverSource,
  type PortfolioRolloverSource } from
  "../portfolio-rollover-proof"
import { planPortfolioAccrualRepair, type PortfolioAccrualSnapshot } from
  "../portfolio-accrual-repair"
import { verifyPortfolioAccrualEvidence } from
  "@/lib/financial-corrections/portfolio-verifier"
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const appliedAt = new Date("2026-10-09T16:09:51.000Z")

function source(): PortfolioRolloverSource {
  const base = {
    interestRate: "0.10", interestRateOverride: null, penaltyMultiplier: "0.1000",
    penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
    minInterestDays: 30, minPeriodOverride: null, issuanceFee: "0",
    disbursementSource: "cash", subLocationId: null, loanType: "perpetual",
    sourceExceptions: [], sourceDigest: "a".repeat(64), payments: [], waivers: [],
    rateChanges: [], deletedAt: null,
  }
  const chain: ChainSnapshot = { loans: [
    { ...base, id: "root", rolledOverFrom: null, principalAmount: "15000000",
      rolloverAmount: null, startDate: day("2026-08-28"), createdAt: day("2026-08-28"),
      status: "rolled_over" },
    { ...base, id: "next", rolledOverFrom: "root", principalAmount: "26500000",
      rolloverAmount: "16500000", startDate: day("2026-09-18"),
      createdAt: day("2026-09-18"), status: "active" },
  ] }
  const journal = (id: string, group: string, loanId: string | null,
    categoryName: string, type: "debit" | "credit", amount: string,
    referenceType: string, referenceId: string, date: Date, description: string,
    recordedBy = "test-actor") => ({ id, journalGroupId: group, loanId,
    categoryName, categoryType: categoryName === "Interest Earned" ? "revenue" : "asset",
    type, amount, referenceType, referenceId, transactionDate: date,
    createdAt: description.startsWith("Non-cash") ? appliedAt : date,
    description, recordedBy,
    depositLocation: categoryName === "Cash" ? "cash" : null, subLocationId: null })
  const journals = [
    journal("r1", "root-issue", "root", "Loans Receivable", "debit", "15000000",
      "loan", "root", day("2026-08-28"), "Principal disbursed"),
    journal("r2", "root-issue", null, "Cash", "credit", "15000000",
      "loan", "root", day("2026-08-28"), "Principal disbursed"),
    journal("n1", "next-issue", "next", "Loans Receivable", "debit", "10000000",
      "loan", "next", day("2026-09-18"), "Principal disbursed"),
    journal("n2", "next-issue", null, "Cash", "credit", "10000000",
      "loan", "next", day("2026-09-18"), "Principal disbursed"),
    journal("t1", "transfer", "next", "Loans Receivable", "debit", "15000000",
      "rollover", "root", day("2026-09-18"), "Principal transferred"),
    journal("t2", "transfer", "root", "Loans Receivable", "credit", "15000000",
      "rollover", "next", day("2026-09-18"), "Principal transferred"),
    journal("i1", "interest", "next", "Loans Receivable", "debit", "1550000",
      "rollover", "root", day("2026-09-18"), "Interest carried"),
    journal("i2", "interest", "next", "Interest Earned", "credit", "1550000",
      "rollover", "root", day("2026-09-18"), "Interest carried"),
    journal("c1", "correction", "next", "Loans Receivable", "credit", "50000",
      "rollover", "root", day("2026-09-18"), "Non-cash rollover correction run-1"),
    journal("c2", "correction", "next", "Interest Earned", "debit", "50000",
      "rollover", "root", day("2026-09-18"), "Non-cash rollover correction run-1"),
  ]
  return { chain, journals, runs: [{ id: "run-1", chainRootId: "root",
    planHash: "b".repeat(64), inputFingerprint: "c".repeat(64), policyVersion: "v1",
    reviewedBy: "test-actor", agentReviewId: null, appliedByAgent: null, appliedAt,
    beforeSummary: JSON.stringify({ loans: [{ loanId: "next",
      principalAmount: "26550000.00", rolloverAmount: "16550000.00" }], settlements: [] }),
    afterSummary: JSON.stringify({ loans: [{ loanId: "next",
      principalAmount: "26500000.00", rolloverAmount: "16500000.00" }], settlements: [] }),
  }], reviews: [], portfolioRuns: [], portfolioReviews: [] }
}

function fourLoanSource(): PortfolioRolloverSource {
  const value = source()
  value.chain.loans[1].status = "rolled_over"
  const next = value.chain.loans[1]
  value.chain.loans.push(
    { ...next, id: "middle", rolledOverFrom: "next", principalAmount: "30648333",
      rolloverAmount: "27648333", startDate: day("2026-10-01"),
      createdAt: day("2026-10-01"), status: "rolled_over" },
    { ...next, id: "terminal", rolledOverFrom: "middle", principalAmount: "33363461",
      rolloverAmount: "31363461", startDate: day("2026-10-08"),
      createdAt: day("2026-10-08"), status: "active" },
  )
  const add = (id: string, group: string, loanId: string | null,
    categoryName: string, type: "debit" | "credit", amount: string,
    referenceType: string, referenceId: string, at: Date, correction = false) => {
    const sample = value.journals[0]
    value.journals.push({ ...sample, id, journalGroupId: group, loanId,
      categoryName, categoryType: categoryName === "Interest Earned" ? "revenue" : "asset",
      type, amount, referenceType, referenceId, transactionDate: at,
      createdAt: correction ? appliedAt : at,
      description: correction ? "Non-cash rollover correction run-1" : "Source journal",
      depositLocation: categoryName === "Cash" ? "cash" : null })
  }
  for (const [id, prior, at, fresh, oldPrincipal, oldInterest] of [
    ["middle", "next", day("2026-10-01"), "3000000", "26550000", "308500"],
    ["terminal", "middle", day("2026-10-08"), "2000000", "29858500", "487727"],
  ] as const) {
    add(`${id}-issue-lr`, `${id}-issue`, id, "Loans Receivable", "debit", fresh,
      "loan", id, at)
    add(`${id}-issue-cash`, `${id}-issue`, null, "Cash", "credit", fresh,
      "loan", id, at)
    add(`${id}-principal-in`, `${id}-principal`, id, "Loans Receivable", "debit",
      oldPrincipal, "rollover", prior, at)
    add(`${id}-principal-out`, `${id}-principal`, prior, "Loans Receivable", "credit",
      oldPrincipal, "rollover", id, at)
    add(`${id}-interest-in`, `${id}-interest`, id, "Loans Receivable", "debit",
      oldInterest, "rollover", prior, at)
    add(`${id}-interest-out`, `${id}-interest`, id, "Interest Earned", "credit",
      oldInterest, "rollover", prior, at)
  }
  const atMiddle = day("2026-10-01")
  const atTerminal = day("2026-10-08")
  add("m-p-in", "m-principal-correction", "middle", "Loans Receivable", "credit",
    "50000", "rollover", "next", atMiddle, true)
  add("m-p-out", "m-principal-correction", "next", "Loans Receivable", "debit",
    "50000", "rollover", "middle", atMiddle, true)
  add("m-i-in", "m-interest-correction", "middle", "Loans Receivable", "debit",
    "839833", "rollover", "next", atMiddle, true)
  add("m-i-out", "m-interest-correction", "middle", "Interest Earned", "credit",
    "839833", "rollover", "next", atMiddle, true)
  add("t-p-in", "t-principal-correction", "terminal", "Loans Receivable", "debit",
    "789833", "rollover", "middle", atTerminal, true)
  add("t-p-out", "t-principal-correction", "middle", "Loans Receivable", "credit",
    "789833", "rollover", "terminal", atTerminal, true)
  add("t-i-in", "t-interest-correction", "terminal", "Loans Receivable", "debit",
    "227401", "rollover", "middle", atTerminal, true)
  add("t-i-out", "t-interest-correction", "terminal", "Interest Earned", "credit",
    "227401", "rollover", "middle", atTerminal, true)
  const first = JSON.parse(value.runs[0].beforeSummary) as { loans: unknown[] }
  const last = JSON.parse(value.runs[0].afterSummary) as { loans: unknown[] }
  value.runs[0].beforeSummary = JSON.stringify({ loans: [...first.loans,
    { loanId: "middle", principalAmount: "29858500.00", rolloverAmount: "26858500.00" },
    { loanId: "terminal", principalAmount: "32346227.00", rolloverAmount: "30346227.00" }],
  settlements: [] })
  value.runs[0].afterSummary = JSON.stringify({ loans: [...last.loans,
    { loanId: "middle", principalAmount: "30648333.00", rolloverAmount: "27648333.00" },
    { loanId: "terminal", principalAmount: "33363461.00", rolloverAmount: "31363461.00" }],
  settlements: [] })
  return value
}

function sameDayCorrectedSource(): PortfolioRolloverSource {
  const value = source()
  const receiptDate = new Date("2026-09-18T12:00:00.000Z")
  value.chain.loans[0].payments = [Object.assign({ id: "same-day-root", paymentDate: receiptDate,
    amount: "1000000", interestPortion: "1000000", principalPortion: "0",
    recorderName: "" }, { depositLocation: "cash", subLocationId: null })]
  value.chain.loans[1].principalAmount = "25500000"
  value.chain.loans[1].rolloverAmount = "15500000"
  const originalAmounts = new Map([
    ["t1", "14500000"], ["t2", "14500000"],
    ["i1", "2050000"], ["i2", "2050000"],
    ["c1", "1550000"], ["c2", "1550000"],
  ])
  for (const row of value.journals) row.amount = originalAmounts.get(row.id) ?? row.amount
  const add = (id: string, group: string, loanId: string, categoryName: string,
    type: "debit" | "credit", amount: string, referenceType: string,
    referenceId: string, at: Date, correction: boolean) => {
    const sample = value.journals[0]
    value.journals.push({ ...sample, id, journalGroupId: group, loanId,
      categoryName, categoryType: categoryName === "Interest Earned" ? "revenue" : "asset",
      type, amount, referenceType, referenceId, transactionDate: at,
      createdAt: correction ? appliedAt : at,
      description: correction ? "Non-cash settlement reclassification run-1" : "Receipt",
      depositLocation: categoryName === "Cash" ? "cash" : null })
  }
  add("p-cash", "receipt", "root", "Cash", "debit", "1000000", "payment",
    "same-day-root", receiptDate, false)
  add("p-interest", "receipt", "root", "Interest Earned", "credit", "500000",
    "payment", "same-day-root", receiptDate, false)
  add("p-principal", "receipt", "root", "Loans Receivable", "credit", "500000",
    "payment", "same-day-root", receiptDate, false)
  add("p-fix-interest", "receipt-fix", "root", "Interest Earned", "credit", "500000",
    "payment", "same-day-root", receiptDate, true)
  add("p-fix-principal", "receipt-fix", "root", "Loans Receivable", "debit", "500000",
    "payment", "same-day-root", receiptDate, true)
  // The principal transfer rises by the principal no longer paid in cash.
  const prior = value.journals[0]
  value.journals.push(
    { ...prior, id: "transfer-fix-in", journalGroupId: "transfer-fix",
      loanId: "next", categoryName: "Loans Receivable", type: "debit",
      amount: "500000", referenceType: "rollover", referenceId: "root",
      transactionDate: day("2026-09-18"), createdAt: appliedAt,
      description: "Non-cash rollover correction run-1", depositLocation: null },
    { ...prior, id: "transfer-fix-out", journalGroupId: "transfer-fix",
      loanId: "root", categoryName: "Loans Receivable", type: "credit",
      amount: "500000", referenceType: "rollover", referenceId: "next",
      transactionDate: day("2026-09-18"), createdAt: appliedAt,
      description: "Non-cash rollover correction run-1", depositLocation: null },
  )
  value.runs[0].beforeSummary = JSON.stringify({ loans: [{ loanId: "next",
    principalAmount: "26550000.00", rolloverAmount: "16550000.00" }],
  settlements: [{ id: "same-day-root", loanId: "root", kind: "payment",
    interestPortion: "500000.00", principalPortion: "500000.00",
    overpaymentPortion: "0.00" }] })
  value.runs[0].afterSummary = JSON.stringify({ loans: [{ loanId: "next",
    principalAmount: "25500000.00", rolloverAmount: "15500000.00" }],
  settlements: [{ id: "same-day-root", loanId: "root", kind: "payment",
    interestPortion: "1000000.00", principalPortion: "0.00",
    overpaymentPortion: "0.00" }] })
  return value
}

describe("portfolio rollover source proof", () => {
  it("proves corrected same-day predecessor cash before closing the loan", () => {
    const value = sameDayCorrectedSource()
    const proof = provePortfolioRolloverSource(value, "root", day("2026-10-13"))
    expect(proof.carriedInterest).toBe("500000.00")
    expect(proof.accruedBeforeRollover).toBe("50000.00")
    expect(proof.minimumUplift).toBe("450000.00")
    expect(proof.settlementCorrectionGroupIds).toContain("receipt-fix")
  })

  it("re-proves the archived correction and keeps minimum interest at the rollover instant", () => {
    const proof = provePortfolioRolloverSource(source(), "root", day("2026-10-13"))
    expect(proof.closureDate).toEqual(day("2026-09-18"))
    expect(proof.carriedInterest).toBe("1500000.00")
    expect(proof.accruedBeforeRollover).toBe("1050000.00")
    expect(proof.minimumUplift).toBe("450000.00")
    expect(proof.chainLoanIds).toEqual(["root", "next"])
  })

  it("fails closed when the proven carry is less than accrued unpaid interest", () => {
    expect(() => assertRolloverCarryCoversAccrued("1049999.99", "1050000.00"))
      .toThrow(/carry.*below.*accrued/i)
    expect(assertRolloverCarryCoversAccrued("1050000.00", "1050000.00"))
      .toBe("0.00")
    const value = source()
    value.chain.loans[0].interestRate = "0.20"
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow(/carry|closure/i)
    const snapshot = portfolio(value, "root")
    expect(planPortfolioAccrualRepair(snapshot).classification).toBe("blocked")
    const valid = portfolio(source(), "root")
    const plan = planPortfolioAccrualRepair(valid)
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan))
      .toThrow()
  })

  it("proves every issue-date edge and independent successor accrual in a four-loan path", () => {
    const value = fourLoanSource()
    expect(provePortfolioRolloverSource(value, "root", day("2026-10-13")).closureDate)
      .toEqual(day("2026-09-18"))
    expect(provePortfolioRolloverSource(value, "next", day("2026-10-13")).closureDate)
      .toEqual(day("2026-10-01"))
    expect(provePortfolioRolloverSource(value, "middle", day("2026-10-13")).closureDate)
      .toEqual(day("2026-10-08"))
    expect(provePortfolioRolloverSource(value, "terminal", day("2026-10-13"))
      .openingPrincipal).toBe("33363461.00")
    for (const loan of value.chain.loans) {
      const plan = planPortfolioAccrualRepair(portfolio(value, loan.id))
      expect(["ready", "noop"]).toContain(plan.classification)
      expect(plan.policyVersion).toBe("portfolio-accrual-rollover-v1")
    }
    expect(planPortfolioAccrualRepair(portfolio(value, "middle")).classification).toBe("noop")
  })

  it.each(["v4", "v5"])("re-proves an agent-attributed %s run and rejects a stale or false review", (policyVersion) => {
    const value = source()
    const run = value.runs[0]
    run.policyVersion = policyVersion
    run.reviewedBy = null
    run.agentReviewId = "review-1"
    run.appliedByAgent = "agent:executor"
    run.beforeSummary = JSON.stringify({ ...JSON.parse(run.beforeSummary),
      backupSha256: "d".repeat(64) })
    for (const row of value.journals.filter((item) => item.id.startsWith("c"))) {
      row.recordedBy = "agent:executor"
    }
    const evidence = { chainRootId: "root", checked: true }
    value.reviews.push({ id: "review-1", kind: "rollover_correction",
      subjectId: "root", planHash: run.planHash, inputFingerprint: run.inputFingerprint,
      policyVersion, verdict: "pass", reviewerAgentId: "agent:reviewer",
      reviewedAt: new Date("2026-10-08T00:00:00.000Z"),
      consumedByRunId: run.id,
      consumedAt: new Date(appliedAt.getTime() + 8_000),
      evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence) })
    expect(provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toMatchObject({ correctionRunIds: [run.id], backupSha256s: ["d".repeat(64)] })
    value.reviews[0].evidenceSha256 = "0".repeat(64)
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow(/review/i)
    value.reviews[0].evidenceSha256 = hashReviewEvidence(evidence)
    value.reviews[0].reviewedAt = new Date("2026-10-10T00:00:00.000Z")
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow(/review/i)
    value.reviews[0].reviewedAt = new Date("2026-10-08T00:00:00.000Z")
    value.reviews[0].consumedAt = new Date(appliedAt.getTime() - 1)
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow(/review/i)
    value.reviews[0].consumedAt = new Date(appliedAt.getTime() + 8_000)
    run.beforeSummary = JSON.stringify({ ...JSON.parse(run.beforeSummary),
      backupSha256: "missing" })
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow(/backup/i)
  })

  it("allows only the archived whole-UGX rounding residual, while matching correction cents", () => {
    const value = source()
    for (const row of value.journals.filter((item) => item.journalGroupId === "interest")) {
      row.amount = "1550000.33"
    }
    for (const row of value.journals.filter((item) => item.journalGroupId === "correction")) {
      row.amount = "50000.33"
    }
    expect(provePortfolioRolloverSource(value, "root", day("2026-10-13"))
      .carriedInterest).toBe("1500000.00")
    value.journals.find((row) => row.id === "c1")!.amount = "50000.32"
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13")))
      .toThrow()
  })

  it("requires a reviewed applied run for every prior accrual pair", () => {
    const value = source()
    const sample = value.journals[0]
    value.journals.push(
      { ...sample, id: "accrual-ir", journalGroupId: "accrual", loanId: "root",
        referenceType: "portfolio_accrual_repair", referenceId: "portfolio-run",
        categoryName: "Interest Receivable", categoryType: "asset", type: "debit",
        amount: "100000", transactionDate: day("2026-08-31"),
        createdAt: appliedAt, description: "Portfolio interest repair portfolio-run",
        recordedBy: "agent:executor", depositLocation: null },
      { ...sample, id: "accrual-ie", journalGroupId: "accrual", loanId: "root",
        referenceType: "portfolio_accrual_repair", referenceId: "portfolio-run",
        categoryName: "Interest Earned", categoryType: "revenue", type: "credit",
        amount: "100000", transactionDate: day("2026-08-31"),
        createdAt: appliedAt, description: "Portfolio interest repair portfolio-run",
        recordedBy: "agent:executor", depositLocation: null },
    )
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*run/i)
    const checkpoint = { date: day("2026-08-31").toISOString(), period: "2026-08",
      accrued: "100000.00", settled: "0.00", existingReceivable: "0.00",
      delta: "100000.00", resultingReceivable: "100000.00" }
    const evidence = { loanId: "root", asOf: day("2026-09-01").toISOString(),
      checkpoints: [checkpoint] }
    value.portfolioRuns.push({ id: "portfolio-run", loanId: "root",
      planHash: "e".repeat(64), inputFingerprint: "f".repeat(64),
      policyVersion: "portfolio-accrual-v4", agentReviewId: "portfolio-review",
      appliedByAgent: "agent:executor", backupSha256: "d".repeat(64), appliedAt,
      beforeSummary: JSON.stringify({ asOf: day("2026-09-01"), entries: [{
        ...checkpoint, date: day("2026-08-31"),
      }] }), afterSummary: JSON.stringify({ classification: "noop" }) })
    value.portfolioReviews.push({ id: "portfolio-review", kind: "portfolio_accrual",
      subjectId: "root", planHash: "e".repeat(64), inputFingerprint: "f".repeat(64),
      policyVersion: "portfolio-accrual-v4", verdict: "pass",
      reviewerAgentId: "agent:reviewer", reviewedAt: day("2026-10-08"),
      consumedAt: new Date(appliedAt.getTime() + 8_000),
      consumedByRunId: "portfolio-run",
      evidenceJson: JSON.stringify(evidence), evidenceSha256: hashReviewEvidence(evidence) })
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .not.toThrow()
    const unmatched = { loanId: "root", asOf: day("2026-09-01").toISOString(),
      checkpoints: [] }
    value.portfolioReviews[0].evidenceJson = JSON.stringify(unmatched)
    value.portfolioReviews[0].evidenceSha256 = hashReviewEvidence(unmatched)
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*checkpoint/i)
    value.portfolioReviews[0].evidenceJson = JSON.stringify(evidence)
    value.portfolioReviews[0].evidenceSha256 = hashReviewEvidence(evidence)
    const postPreviewApply = new Date("2026-10-14T00:00:00.000Z")
    value.portfolioRuns[0].appliedAt = postPreviewApply
    value.portfolioReviews[0].consumedAt = new Date(postPreviewApply.getTime() + 8_000)
    for (const row of value.journals.filter((item) =>
      item.journalGroupId === "accrual")) row.createdAt = postPreviewApply
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .not.toThrow()
    value.portfolioRuns[0].appliedAt = appliedAt
    value.portfolioReviews[0].consumedAt = new Date(appliedAt.getTime() + 8_000)
    for (const row of value.journals.filter((item) =>
      item.journalGroupId === "accrual")) row.createdAt = appliedAt
    value.portfolioRuns[0].backupSha256 = "missing"
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*run/i)
    value.portfolioRuns[0].backupSha256 = "d".repeat(64)
    value.portfolioReviews[0].reviewedAt = new Date("2026-10-10T00:00:00.000Z")
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*review/i)
    value.portfolioReviews[0].reviewedAt = day("2026-10-08")
    value.portfolioReviews[0].consumedAt = new Date(appliedAt.getTime() - 1)
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*review/i)
    value.portfolioReviews[0].consumedAt = new Date(appliedAt.getTime() + 8_000)
    value.portfolioReviews[0].consumedByRunId = "different-run"
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*review/i)
    value.portfolioReviews[0].consumedByRunId = "portfolio-run"
    const summary = value.portfolioRuns[0].beforeSummary
    value.portfolioRuns[0].beforeSummary = JSON.stringify({ asOf: day("2026-09-01"),
      entries: [{ date: day("2026-08-30"), delta: "100000.00" }] })
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio review checkpoints differ/i)
    value.portfolioRuns[0].beforeSummary = JSON.stringify({ asOf: day("2026-09-01"),
      entries: [{ date: day("2026-08-31"), delta: "99999.00" }] })
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio review checkpoints differ/i)
    value.portfolioRuns[0].beforeSummary = summary
    value.journals.at(-1)!.recordedBy = "stranger"
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio.*journal/i)
    value.journals.at(-1)!.recordedBy = "agent:executor"
    value.journals.at(-1)!.amount = "99999"
    expect(() => provePortfolioRolloverSource(value, "next", day("2026-10-13")))
      .toThrow(/portfolio journal/i)
  })

  it.each([
    ["issue date", (value: PortfolioRolloverSource) => { value.chain.loans[1].startDate = day("2026-09-19") }],
    ["transfer", (value: PortfolioRolloverSource) => { value.journals.find((row) => row.id === "t1")!.amount = "15000001" }],
    ["closure", (value: PortfolioRolloverSource) => { value.journals.find((row) => row.id === "t2")!.amount = "14999999" }],
    ["correction amount", (value: PortfolioRolloverSource) => { value.journals.find((row) => row.id === "c1")!.amount = "49999" }],
    ["correction actor", (value: PortfolioRolloverSource) => { value.journals.find((row) => row.id === "c1")!.recordedBy = "stranger" }],
    ["run summary", (value: PortfolioRolloverSource) => { value.runs[0].afterSummary = "{}" }],
    ["missing run", (value: PortfolioRolloverSource) => { value.runs = [] }],
    ["inverted chronology", (value: PortfolioRolloverSource) => {
      value.chain.loans[1].startDate = day("2026-08-27")
    }],
    ["unattributed cash", (value: PortfolioRolloverSource) => {
      value.journals.find((row) => row.id === "c1")!.categoryName = "Cash"
    }],
  ])("rejects changed %s", (_label, mutate) => {
    const value = source()
    mutate(value)
    expect(() => provePortfolioRolloverSource(value, "root", day("2026-10-13"))).toThrow()
  })
})

function portfolio(source: PortfolioRolloverSource, loanId: string): PortfolioAccrualSnapshot {
  return { loan: source.chain.loans.find((row) => row.id === loanId)!, payments: [],
    waivers: [], receivableJournals: [], receivableCategory: null,
    rolloverSource: source, sourceExceptions: [], sourceDigest: "d".repeat(64),
    asOf: day("2026-10-13") }
}

describe("rollover-aware portfolio accrual", () => {
  it("accrues only elapsed days, reverses receivable at closure, then opens successor independently", () => {
    const chain = source()
    const predecessor = planPortfolioAccrualRepair(portfolio(chain, "root"))
    const successor = planPortfolioAccrualRepair(portfolio(chain, "next"))
    expect(predecessor.policyVersion).toBe("portfolio-accrual-rollover-v1")
    expect(predecessor.classification).toBe("ready")
    expect(predecessor.entries.at(-1)).toEqual(expect.objectContaining({
      date: day("2026-09-18"), resultingReceivable: "0.00",
      capitalized: "1050000.00",
    }))
    expect(predecessor.entries.some((entry) => entry.accrued === "1500000.00"))
      .toBe(false)
    expect(successor.policyVersion).toBe("portfolio-accrual-rollover-v1")
    expect(successor.classification).toBe("ready")
    expect(successor.entries.at(-1)?.resultingReceivable).toBe("2208333.00")
    expect(verifyPortfolioAccrualEvidence(portfolio(chain, "root"), predecessor)
      .rolloverCorrectionRunIds).toEqual(["run-1"])
    expect(() => verifyPortfolioAccrualEvidence(portfolio(chain, "next"), successor))
      .not.toThrow()
  })

  it("keeps v4 identity for unrelated loans and blocks rollover without raw proof", () => {
    const value = portfolio(source(), "root")
    delete value.rolloverSource
    expect(planPortfolioAccrualRepair(value).classification).toBe("blocked")
    value.loan.status = "active"
    const original = planPortfolioAccrualRepair(value)
    expect(original.policyVersion).toBe("portfolio-accrual-v4")
    expect(planPortfolioAccrualRepair({ ...value, rolloverSource: undefined }).planHash)
      .toBe(original.planHash)
  })

  it("blocks a snapshot that diverges from the proven chain, and verifies capitalized accrual", () => {
    const value = portfolio(source(), "root")
    const plan = planPortfolioAccrualRepair(value)
    plan.entries.at(-1)!.capitalized = "1500000.00"
    expect(() => verifyPortfolioAccrualEvidence(value, plan)).toThrow(/checkpoint/i)
    expect(planPortfolioAccrualRepair({ ...value,
      loan: { ...value.loan, principalAmount: "15000001.00" } }).classification)
      .toBe("blocked")
    expect(planPortfolioAccrualRepair({ ...value, payments: [{ id: "unknown",
      paymentDate: day("2026-09-01"), amount: "1.00",
      interestPortion: "1.00", principalPortion: "0.00" }] }).classification)
      .toBe("blocked")
  })
})
