import { describe, expect, it } from "vitest"
import { resolveStatementRateHistory } from "../statement-rate-history"

const loan = {
  startDate: new Date("2025-02-21T00:00:00.000Z"),
  interestRate: "0.15",
  interestRateOverride: "0.10",
}

describe("statementRateChanges", () => {
  it("does not turn an applied correction into an earning-period transition", () => {
    expect(resolveStatementRateHistory({ loan, history: [
      {
        id: "legacy", fromRate: "0.15", toRate: "0.12",
        actorId: null, actorName: null,
        changedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: "correction", fromRate: "0.12", toRate: "0.10",
        actorId: null, actorName: null,
        changedAt: new Date("2026-08-01T00:00:00.000Z"),
        effectiveFrom: new Date("2025-02-21T00:00:00.000Z"),
      },
    ] })).toEqual({ rateChanges: [], issue: null })
  })

  it("preserves dated legacy rate changes when no correction marker exists", () => {
    const changedAt = new Date("2026-07-01T00:00:00.000Z")
    expect(resolveStatementRateHistory({ loan: { ...loan, interestRateOverride: "0.12" }, history: [{
      id: "legacy", fromRate: "0.15", toRate: "0.12",
      actorId: null, actorName: null, changedAt,
    }] })).toEqual({ rateChanges: [{ effectiveDate: changedAt, fromRate: "0.15", toRate: "0.12" }], issue: null })
  })

  it("refuses to guess interest periods for two legacy changes on the same day", () => {
    const history = [
      { id: "first", fromRate: "0.15", toRate: "0.12", actorId: null, actorName: null, changedAt: new Date("2026-07-01T08:00:00.000Z") },
      { id: "second", fromRate: "0.12", toRate: "0.10", actorId: null, actorName: null, changedAt: new Date("2026-07-01T10:00:00.000Z") },
    ]
    expect(resolveStatementRateHistory({ loan, history })).toEqual({
      rateChanges: [],
      issue: "Applied rate changes on the same day need review before interest can be calculated.",
    })
  })

  it("refuses a broken legacy rate chain rather than presenting a guessed statement", () => {
    const history = [{ id: "legacy", fromRate: "0.11", toRate: "0.10", actorId: null, actorName: null, changedAt: new Date("2026-07-01T08:00:00.000Z") }]
    expect(resolveStatementRateHistory({ loan, history }).issue).toMatch(/does not reconcile/)
  })

  it("refuses a correction marker with the wrong contractual start date", () => {
    const history = [{ id: "marked", fromRate: "0.15", toRate: "0.10", actorId: null, actorName: null,
      changedAt: new Date("2026-07-01T08:00:00.000Z"), effectiveFrom: new Date("2025-03-01T00:00:00.000Z") }]
    expect(resolveStatementRateHistory({ loan, history }).issue).toMatch(/start date/)
  })
})
