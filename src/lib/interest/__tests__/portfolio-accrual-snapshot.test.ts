import { describe, expect, it } from "vitest"
import { assessPortfolioSnapshotPeriod } from "../portfolio-accrual-snapshot"

const mayEnd = new Date("2026-05-31T23:59:59.999Z")
const asOf = new Date("2026-10-10T00:00:00.000Z")

function loan(id: string, startDate = new Date("2026-01-01T00:00:00.000Z"),
  classification: "ready" | "noop" | "blocked" = "noop",
  entryDates: Date[] = []) {
  return { id, startDate, plan: { loanId: id, asOf, classification,
    inputFingerprint: id.padEnd(64, "a"), planHash: id.padEnd(64, "b"),
    entries: entryDates.map((date) => ({ date })) } }
}

describe("portfolio snapshot restatement eligibility", () => {
  it("permits a period only when every effective source has no pending entry", () => {
    expect(assessPortfolioSnapshotPeriod(mayEnd, [loan("a")]).eligible).toBe(true)
    expect(assessPortfolioSnapshotPeriod(mayEnd, [loan("a", undefined, "ready", [
      new Date("2026-06-30T23:59:59.999Z"),
    ])]).eligible).toBe(true)
    const pending = assessPortfolioSnapshotPeriod(mayEnd, [loan("a", undefined, "ready", [
      new Date("2026-05-31T23:59:59.999Z"),
    ])])
    expect(pending.eligible).toBe(false)
    expect(pending.pendingLoanIds).toEqual(["a"])
  })

  it("blocks a historical period for a backdated or ambiguous loan effective by then", () => {
    const result = assessPortfolioSnapshotPeriod(mayEnd, [
      loan("older", new Date("2025-01-01T00:00:00.000Z"), "blocked"),
      loan("later", new Date("2026-06-01T00:00:00.000Z"), "blocked"),
    ])
    expect(result.eligible).toBe(false)
    expect(result.blockedLoanIds).toEqual(["older"])
  })

  it("rejects a preview whose as-of instant predates the period end", () => {
    const source = loan("a")
    source.plan.asOf = new Date("2026-05-01T00:00:00.000Z")
    expect(assessPortfolioSnapshotPeriod(mayEnd, [source]).eligible).toBe(false)
  })
})
