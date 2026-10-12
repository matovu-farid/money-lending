import { describe, expect, it } from "vitest"
import { planPortfolioAccrualRepair, type PortfolioAccrualSnapshot } from
  "@/lib/interest/portfolio-accrual-repair"
import { verifyPortfolioAccrualEvidence } from "../portfolio-verifier"

function source(): PortfolioAccrualSnapshot {
  return {
    loan: {
      id: "loan-1", principalAmount: "1000000.00", interestRate: "0.1000",
      interestRateOverride: null, penaltyMultiplier: "0.1000",
      penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
      minInterestDays: 30, minPeriodOverride: null, rolledOverFrom: null,
      issuanceFee: "0.00", loanType: "perpetual", status: "active",
      startDate: new Date("2025-01-01T00:00:00.000Z"),
    },
    payments: [], waivers: [], receivableJournals: [], receivableCategory: null,
    sourceExceptions: [], asOf: new Date("2025-01-31T23:59:59.999Z"),
  }
}

function priorJournal(snapshot: PortfolioAccrualSnapshot) {
  return {
    id: "receivable-1", date: snapshot.asOf, amount: "50000.00", type: "debit" as const,
    journalGroupId: "group-1", earnedCounterpartAmount: "50000.00",
    earnedCounterpartType: "credit" as const, loanId: snapshot.loan.id,
    referenceType: "interest_accrual", referenceId: snapshot.loan.id,
    categoryName: "Interest Receivable", categoryType: "asset",
    depositLocation: null as string | null,
    subLocationId: null as string | null, groupEntryCount: 2,
    earnedCounterpart: { id: "earned-1", journalGroupId: "group-1",
      loanId: snapshot.loan.id,
      referenceType: "interest_accrual", referenceId: snapshot.loan.id,
      date: snapshot.asOf, amount: "50000.00", type: "credit" as const,
      categoryName: "Interest Earned", categoryType: "revenue",
      depositLocation: null as string | null,
      subLocationId: null as string | null },
  }
}

describe("independent portfolio accrual evidence", () => {
  it("requires a source digest for independent review of a corrected-rate plan", () => {
    const snapshot = source()
    snapshot.loan.interestRateOverride = "0.1500"
    snapshot.sourceDigest = "a".repeat(64)
    snapshot.historicalRateCorrection = {
      run: { id: "run-1", loanId: snapshot.loan.id, planHash: "historical-plan",
        inputFingerprint: "historical-input", policyVersion: "v2",
        agentReviewId: "review-1", appliedByAgent: "agent:executor",
        backupSha256: "b".repeat(64), appliedAt: new Date("2025-02-02T00:00:00.000Z"),
        beforeSummary: JSON.stringify({ loanId: snapshot.loan.id,
          classification: "review", planHash: "historical-plan",
          inputFingerprint: "historical-input", policyVersion: "v2",
          correctedRate: "0.1500", asOf: snapshot.asOf,
          changes: [] }),
        afterSummary: JSON.stringify({ loanId: snapshot.loan.id,
          classification: "noop", policyVersion: "v2",
          correctedRate: "0.1500", asOf: snapshot.asOf,
          accrualJournalDelta: "0.00", accrualJournalTarget: "150000.00",
          endingPrincipal: "1000000.00", exceptions: [], changes: [] }) },
      review: { id: "review-1", kind: "historical_rate", subjectId: snapshot.loan.id,
        planHash: "historical-plan", inputFingerprint: "historical-input",
        policyVersion: "v2", verdict: "pass", reviewerAgentId: "agent:reviewer",
        consumedByRunId: "run-1", consumedAt: new Date("2025-02-02T00:00:00.000Z") },
      audit: { id: "audit-1", action: "historical_rate_corrected_by_agent",
        entityType: "loan", entityId: snapshot.loan.id,
        occurredAt: new Date("2025-02-02T00:00:00.000Z"), beforeValue: null,
        afterValue: JSON.stringify({ interestRateOverride: "0.1500",
          rateSemantics: "correction", effectiveFrom: snapshot.loan.startDate.toISOString(),
          repairedPlanHash: "historical-plan", agentReviewId: "review-1",
          reviewerAgentId: "agent:reviewer", executorAgentId: "agent:executor",
          repairRunId: "run-1" }) },
    }
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(verifyPortfolioAccrualEvidence(snapshot, plan).historicalCorrectionRunId).toBe("run-1")
    snapshot.sourceDigest = undefined
    const unbound = planPortfolioAccrualRepair(snapshot)
    expect(unbound.classification).toBe("ready")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, unbound)).toThrow(/source digest/i)
  })
  it("checks the exact hand-calculated 30-day receivable", () => {
    const snapshot = source()
    const plan = planPortfolioAccrualRepair(snapshot)
    const evidence = verifyPortfolioAccrualEvidence(snapshot, plan)
    expect(evidence.checkpoints).toEqual([expect.objectContaining({
      accrued: "100000.00", settled: "0.00", delta: "100000.00",
      resultingReceivable: "100000.00",
    })])
  })

  it("checks a fully attributed prior journal against the remaining accrual", () => {
    const snapshot = source()
    snapshot.receivableJournals.push(priorJournal(snapshot))
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(verifyPortfolioAccrualEvidence(snapshot, plan).checkedPriorJournalCount).toBe(1)
  })

  it.each([
    ["another loan", { loanId: "another-loan" }],
    ["another reference type", { referenceType: "other_accrual" }],
    ["another reference id", { referenceId: "other-loan" }],
    ["another effective date", { date: new Date("2025-01-30T23:59:59.999Z") }],
    ["a cash deposit", { depositLocation: "cash" }],
    ["a bank sub-location", { subLocationId: "bank-account-1" }],
    ["another journal group", { journalGroupId: "group-2" }],
    ["another revenue account", { categoryName: "Fees Earned" }],
  ])("rejects a balanced prior journal counterpart attributed to %s", (_case, patch) => {
    const snapshot = source()
    const row = priorJournal(snapshot)
    Object.assign(row.earnedCounterpart, patch)
    snapshot.receivableJournals.push(row)
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).toThrow(/prior journal/i)
  })

  it.each([
    ["another loan", { loanId: "another-loan" }],
    ["a different reference", { referenceId: "other-loan" }],
    ["a cash deposit", { depositLocation: "cash" }],
    ["a bank sub-location", { subLocationId: "bank-account-1" }],
  ])("rejects a receivable leg attributed to %s", (_case, patch) => {
    const snapshot = source()
    const row = priorJournal(snapshot)
    Object.assign(row, patch)
    snapshot.receivableJournals.push(row)
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).toThrow(/prior journal/i)
  })

  it("rejects a prior journal with only the reduced planner fields", () => {
    const snapshot = source()
    const { id, date, amount, type, journalGroupId,
      earnedCounterpartAmount, earnedCounterpartType } = priorJournal(snapshot)
    snapshot.receivableJournals.push({ id, date, amount, type, journalGroupId,
      earnedCounterpartAmount, earnedCounterpartType })
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).toThrow(/prior journal/i)
  })

  it.each(["accrued", "settled", "delta", "existingReceivable", "resultingReceivable"] as const)(
    "rejects a changed %s even if the final plan hash is unchanged", (field) => {
      const snapshot = source()
      const plan = planPortfolioAccrualRepair(snapshot)
      plan.entries[0][field] = "999999.00"
      expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).toThrow(/checkpoint|entry/i)
    })

  it("checks a payment-day reversal and the following month's accrual", () => {
    const snapshot = source()
    snapshot.asOf = new Date("2025-02-28T23:59:59.999Z")
    snapshot.payments.push({ id: "payment-1",
      paymentDate: new Date("2025-02-01T00:00:00.000Z"), amount: "100000.00",
      interestPortion: "100000.00", principalPortion: "0.00" })
    const plan = planPortfolioAccrualRepair(snapshot)
    const evidence = verifyPortfolioAccrualEvidence(snapshot, plan)
    expect(evidence.checkpoints.some((row) => row.delta.startsWith("-"))).toBe(true)
    expect(evidence.checkpoints.at(-1)?.date).toBe("2025-02-28T23:59:59.999Z")
  })

  it("uses one rounding of accrued interest net of fractional settlement", () => {
    const snapshot = source()
    snapshot.loan.principalAmount = "1001.00"
    snapshot.asOf = new Date("2025-02-01T00:00:00.000Z")
    snapshot.payments.push({ id: "fractional-payment", paymentDate: snapshot.asOf,
      amount: "0.51", interestPortion: "0.51", principalPortion: "0.00" })
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.entries.at(-1)?.resultingReceivable).toBe("103.00")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).not.toThrow()
  })

  it("returns to base-rate accrual after overdue interest is fully paid", () => {
    const snapshot = source()
    snapshot.asOf = new Date("2025-03-13T00:00:00.000Z")
    snapshot.payments.push({ id: "cure", paymentDate: new Date("2025-03-12T00:00:00.000Z"),
      amount: "236667.00", interestPortion: "236667.00", principalPortion: "0.00" })
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(plan.classification).toBe("ready")
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).not.toThrow()
  })

  it("rejects unsupported rollover and source exceptions", () => {
    const snapshot = source()
    snapshot.loan.rolledOverFrom = "predecessor"
    const plan = planPortfolioAccrualRepair(snapshot)
    expect(() => verifyPortfolioAccrualEvidence(snapshot, plan)).toThrow(/ready/i)
  })

  it("agrees across varied elapsed days, penalties, rates, and dated settlements", () => {
    const start = new Date("2025-01-01T00:00:00.000Z")
    for (let caseIndex = 1; caseIndex <= 48; caseIndex++) {
      const snapshot = source()
      const days = caseIndex * 5
      snapshot.loan.principalAmount = String(150000 + caseIndex * 37691)
      snapshot.loan.interestRate = (0.04 + caseIndex * 0.003).toFixed(4)
      snapshot.asOf = new Date(start.getTime() + days * 86_400_000)
      if (caseIndex % 3 === 0) {
        snapshot.payments.push({ id: `payment-${caseIndex}`,
          paymentDate: new Date(start.getTime() + Math.floor(days / 2) * 86_400_000),
          amount: "10000.00", interestPortion: "7000.00", principalPortion: "3000.00" })
      }
      if (caseIndex % 5 === 0) {
        snapshot.waivers.push({ id: `waiver-${caseIndex}`,
          waiverDate: new Date(start.getTime() + Math.floor(days * 0.75) * 86_400_000),
          amount: "2000.00", interestPortion: "1000.00", principalPortion: "1000.00",
          reason: "Test waiver" })
      }
      const plan = planPortfolioAccrualRepair(snapshot)
      if (plan.classification === "noop") continue
      expect(plan.classification, `case ${caseIndex}`).toBe("ready")
      expect(() => verifyPortfolioAccrualEvidence(snapshot, plan),
        `case ${caseIndex}, days=${days}`).not.toThrow()
    }
  })
})
