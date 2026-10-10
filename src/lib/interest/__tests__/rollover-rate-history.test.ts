import { describe, expect, it } from "vitest"
import { reconstructRolloverRateHistory } from "../rollover-rate-history"

const startDate = new Date("2025-02-21T00:00:00.000Z")

describe("retroactive rate-correction history", () => {
  it("uses the corrected rate from a backdated loan's recorded start date", () => {
    const result = reconstructRolloverRateHistory({
      loan: { startDate, interestRate: "0.1500", interestRateOverride: "0.1000" },
      approvedRequests: [],
      audits: [{
        id: "corrected",
        action: "loan.rate_change.admin_adjusted",
        occurredAt: new Date("2026-08-03T12:00:00.000Z"),
        beforeValue: JSON.stringify({ interestRate: "0.1500" }),
        afterValue: JSON.stringify({
          interestRateOverride: "0.1000",
          rateSemantics: "correction",
          effectiveFrom: startDate.toISOString(),
        }),
      }],
    })
    expect(result).toEqual({ initialRate: "0.1000", changes: [], exceptions: [] })
  })

  it("lets the latest correction supersede prior corrected rates over the whole loan", () => {
    const result = reconstructRolloverRateHistory({
      loan: { startDate, interestRate: "0.1500", interestRateOverride: "0.0800" },
      approvedRequests: [],
      audits: [
        {
          id: "first", action: "loan.rate_change.admin_adjusted",
          occurredAt: new Date("2026-08-03T12:00:00.000Z"),
          beforeValue: JSON.stringify({ interestRate: "0.1500" }),
          afterValue: JSON.stringify({ interestRateOverride: "0.1000", rateSemantics: "correction", effectiveFrom: startDate.toISOString() }),
        },
        {
          id: "second", action: "loan.rate_change.admin_adjusted",
          occurredAt: new Date("2026-08-03T13:00:00.000Z"),
          beforeValue: JSON.stringify({ interestRate: "0.1000" }),
          afterValue: JSON.stringify({ interestRateOverride: "0.0800", rateSemantics: "correction", effectiveFrom: startDate.toISOString() }),
        },
      ],
    })
    expect(result).toEqual({ initialRate: "0.0800", changes: [], exceptions: [] })
  })
})
