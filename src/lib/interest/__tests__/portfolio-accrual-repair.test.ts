import { describe, expect, it } from "vitest"
import { planPortfolioAccrualRepair, type PortfolioAccrualSnapshot } from "../portfolio-accrual-repair"

const janEnd = new Date("2025-01-31T23:59:59.999Z")

function snapshot(overrides: Partial<PortfolioAccrualSnapshot> = {}): PortfolioAccrualSnapshot {
  return {
    loan: {
      id: "loan-1", principalAmount: "1000000.00", interestRate: "0.1000",
      interestRateOverride: null, penaltyMultiplier: "0.1000",
      penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
      minInterestDays: 30, minPeriodOverride: null, rolledOverFrom: null,
      issuanceFee: "0.00", loanType: "perpetual", status: "active",
      startDate: new Date("2025-01-01T00:00:00.000Z"),
    },
    payments: [], waivers: [], receivableJournals: [],
    receivableCategory: null, sourceExceptions: [], asOf: janEnd, ...overrides,
  }
}

describe("portfolio accrual repair planner", () => {
  it("accrues elapsed interest at the closed month end for a backdated start", () => {
    const plan = planPortfolioAccrualRepair(snapshot())
    expect(plan.classification).toBe("ready")
    expect(plan.entries).toEqual([expect.objectContaining({
      date: janEnd, delta: "100000.00", resultingReceivable: "100000.00",
    })])
  })

  it("uses recorded interest allocations when a payment precedes month end", () => {
    const plan = planPortfolioAccrualRepair(snapshot({ payments: [{
      id: "payment-1", paymentDate: new Date("2025-01-16T00:00:00.000Z"),
      amount: "50000.00", interestPortion: "50000.00", principalPortion: "0.00",
    }] }))
    expect(plan.classification).toBe("ready")
    expect(plan.entries.at(-1)).toEqual(expect.objectContaining({
      date: janEnd, delta: "50000.00", resultingReceivable: "50000.00",
    }))
  })

  it("reverses a prior month's receivable when later cash interest settles it", () => {
    const plan = planPortfolioAccrualRepair(snapshot({
      asOf: new Date("2025-02-01T00:00:00.000Z"),
      payments: [{ id: "payment-1", paymentDate: new Date("2025-02-01T00:00:00.000Z"),
        amount: "100000.00", interestPortion: "100000.00", principalPortion: "0.00" }],
    }))
    expect(plan.classification).toBe("ready")
    expect(plan.entries).toEqual([
      expect.objectContaining({ date: janEnd, delta: "100000.00" }),
      expect.objectContaining({ date: new Date("2025-02-01T00:00:00.000Z"),
        delta: "-96667.00", resultingReceivable: "3333.00" }),
    ])
  })

  it("is a no-op when a balanced receivable accrual already exists", () => {
    const plan = planPortfolioAccrualRepair(snapshot({ receivableJournals: [{
      id: "journal-1", date: janEnd, amount: "100000.00", type: "debit",
      journalGroupId: "group-1", earnedCounterpartAmount: "100000.00",
      earnedCounterpartType: "credit",
    }] }))
    expect(plan.classification).toBe("noop")
    expect(plan.entries).toEqual([])
  })

  it("becomes a no-op after posting its exact accrual and settlement reversal", () => {
    const source = snapshot({
      asOf: new Date("2025-02-01T00:00:00.000Z"),
      payments: [{ id: "payment-1", paymentDate: new Date("2025-02-01T00:00:00.000Z"),
        amount: "100000.00", interestPortion: "100000.00", principalPortion: "0.00" }],
    })
    const first = planPortfolioAccrualRepair(source)
    expect(first.classification).toBe("ready")
    const replay = planPortfolioAccrualRepair({ ...source,
      receivableJournals: first.entries.map((entry, index) => ({
        id: `journal-${index}`, date: entry.date,
        amount: entry.delta.replace("-", ""),
        type: entry.delta.startsWith("-") ? "credit" as const : "debit" as const,
        journalGroupId: `group-${index}`,
        earnedCounterpartAmount: entry.delta.replace("-", ""),
        earnedCounterpartType: entry.delta.startsWith("-") ? "debit" as const : "credit" as const,
      })),
    })
    expect(replay.classification).toBe("noop")
    expect(replay.entries).toEqual([])
  })

  it("blocks ambiguous or unsupported loan histories instead of guessing", () => {
    for (const patch of [
      { loan: { ...snapshot().loan, loanType: "fixed_rate" } },
      { loan: { ...snapshot().loan, rolledOverFrom: "predecessor" } },
      { sourceExceptions: ["Unrepaired rate change"] },
    ]) {
      const plan = planPortfolioAccrualRepair(snapshot(patch))
      expect(plan.classification).toBe("blocked")
      expect(plan.entries).toEqual([])
    }
  })

  it("blocks a settlement in the start-day interval the statement does not replay", () => {
    const plan = planPortfolioAccrualRepair(snapshot({ payments: [{
      id: "payment-day-zero", paymentDate: new Date("2025-01-01T12:00:00.000Z"),
      amount: "1000.00", interestPortion: "1000.00", principalPortion: "0.00",
    }] }))
    expect(plan.classification).toBe("blocked")
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringContaining("start-day"),
    ]))
  })

  it("has the same fingerprint regardless of source-row input order", () => {
    const a = { id: "a", paymentDate: new Date("2025-01-10T00:00:00.000Z"),
      amount: "100.00", interestPortion: "100.00", principalPortion: "0.00" }
    const b = { ...a, id: "b", paymentDate: new Date("2025-01-11T00:00:00.000Z") }
    const first = planPortfolioAccrualRepair(snapshot({ payments: [a, b] }))
    const second = planPortfolioAccrualRepair(snapshot({ payments: [b, a] }))
    expect(first.inputFingerprint).toBe(second.inputFingerprint)
    expect(first.planHash).toBe(second.planHash)
  })
})
