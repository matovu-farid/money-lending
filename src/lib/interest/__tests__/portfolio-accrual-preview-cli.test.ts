import { describe, expect, it } from "vitest"
import { assertCompleteLoanSelection, buildPreviewResult, parseLoanSelection } from
  "../../../../scripts/portfolio-accrual-preview"

const first = "298774cc-bff3-452c-b99b-5ed7ae2ea12e"
const second = "7a88260e-c46b-4c75-b3f9-18922d0d49d1"

describe("portfolio accrual preview loan selection", () => {
  it("accepts repeated exact loan IDs while retaining full-portfolio default", () => {
    expect(parseLoanSelection([])).toBeNull()
    expect(parseLoanSelection([`--loan-id=${first}`, `--loan-id=${second}`]))
      .toEqual([first, second])
  })

  it("rejects malformed and duplicate loan selection arguments", () => {
    for (const args of [
      ["--loan-id"],
      ["--loan-id="],
      ["--loan-id=not-a-uuid"],
      [`--loan-id=${first}`, `--loan-id=${first.toUpperCase()}`],
    ]) {
      expect(() => parseLoanSelection(args)).toThrow(/loan-id/i)
    }
  })

  it("rejects unknown selected loans and silently omitted plans", () => {
    expect(() => assertCompleteLoanSelection([first, second], [first], [first]))
      .toThrow(/not found|missing/i)
    expect(() => assertCompleteLoanSelection([first, second], [first, second], [first]))
      .toThrow(/missing/i)
    expect(() => assertCompleteLoanSelection([first], [first], [second]))
      .toThrow(/unexpected|missing/i)
    expect(() => assertCompleteLoanSelection([first], [first], [first])).not.toThrow()
  })

  it("marks selected scope without asserting global saved-period eligibility", () => {
    const report = {
      database: { host: "127.0.0.1", name: "isolated_test" },
      asOf: "2026-10-12T16:03:19.000Z",
      generatedAt: "2026-10-12T16:04:00.000Z",
      plans: [{ loanId: first, classification: "ready" as const,
        entries: [{ period: "2026-09", delta: "25.00" }] }],
      snapshotReadiness: [{ period: "2026-09", eligible: true }],
    }
    const selected = buildPreviewResult(report, [first])
    expect(selected.scope).toEqual({ kind: "selected_loans", loanIds: [first],
      savedSnapshotPeriods: "not_assessed" })
    expect(selected.snapshotReadiness).toEqual([])
    expect(selected.summary.savedPeriodsEligibleToRestate).toEqual([])
    expect(selected.database).toEqual(report.database)
    expect(selected.asOf).toBe(report.asOf)
    expect(selected.plans).toEqual(report.plans)
    const full = buildPreviewResult(report, null)
    expect(full).not.toHaveProperty("scope")
    expect(full.snapshotReadiness).toEqual(report.snapshotReadiness)
    expect(full.summary.savedPeriodsEligibleToRestate).toEqual(["2026-09"])
  })
})
