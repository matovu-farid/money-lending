import { describe, expect, it } from "vitest"
import { summarizeRateCorrectionInventory } from "../rate-correction-inventory"

const startDate = new Date("2025-02-21T00:00:00.000Z")

describe("summarizeRateCorrectionInventory", () => {
  it("counts unique legacy loans and preserves permanent lock reasons", () => {
    const summary = summarizeRateCorrectionInventory([
      { loanId: "eligible", startDate, status: "active", action: "loan.rate_change.immediate", afterValue: '{"interestRateOverride":"0.08"}', paymentRecorded: false, waiverRecorded: false, successorRecorded: false },
      { loanId: "eligible", startDate, status: "active", action: "loan.rate_change.admin_adjusted", afterValue: '{"interestRateOverride":"0.09"}', paymentRecorded: false, waiverRecorded: false, successorRecorded: false },
      { loanId: "paid", startDate, status: "active", action: "loan.rate_change.approved", afterValue: '{"interestRateOverride":"0.08"}', paymentRecorded: true, waiverRecorded: false, successorRecorded: false },
      { loanId: "waived", startDate, status: "active", action: "loan.rate_change.admin_adjusted", afterValue: '{"interestRateOverride":"0.08"}', paymentRecorded: false, waiverRecorded: true, successorRecorded: false },
      { loanId: "rolled", startDate, status: "active", action: "loan.rate_change.immediate", afterValue: '{"interestRateOverride":"0.08"}', paymentRecorded: false, waiverRecorded: false, successorRecorded: true },
    ])
    expect(summary).toEqual({
      appliedAudits: 5,
      markedCorrections: 0,
      invalidMarkedCorrections: 0,
      unmarkedAppliedAudits: 5,
      loansWithUnmarkedAudits: 4,
      legacyLoansByLock: { eligible: 1, payment: 1, waiver: 1, rollover: 1 },
    })
  })

  it("recognizes only a marked correction effective from the recorded start", () => {
    const summary = summarizeRateCorrectionInventory([
      { loanId: "corrected", startDate, status: "active", action: "loan.rate_change.admin_adjusted", afterValue: JSON.stringify({ interestRateOverride: "0.10", rateSemantics: "correction", effectiveFrom: startDate.toISOString() }), paymentRecorded: false, waiverRecorded: false, successorRecorded: false },
      { loanId: "bad-marker", startDate, status: "active", action: "loan.rate_change.admin_adjusted", afterValue: JSON.stringify({ interestRateOverride: "0.10", rateSemantics: "correction", effectiveFrom: "2026-08-03T00:00:00.000Z" }), paymentRecorded: false, waiverRecorded: false, successorRecorded: false },
    ])
    expect(summary).toEqual({
      appliedAudits: 2,
      markedCorrections: 1,
      invalidMarkedCorrections: 1,
      unmarkedAppliedAudits: 0,
      loansWithUnmarkedAudits: 0,
      legacyLoansByLock: { eligible: 0, payment: 0, waiver: 0, rollover: 0 },
    })
  })

  it("does not count a direct loan edit with no rate field as a rate audit", () => {
    const summary = summarizeRateCorrectionInventory([
      { loanId: "loan", startDate, status: "active", action: "loan.update", afterValue: '{"principalAmount":"1000000"}', paymentRecorded: false, waiverRecorded: false, successorRecorded: false },
    ])
    expect(summary.appliedAudits).toBe(0)
  })
})
