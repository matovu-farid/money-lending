import { describe, it, expect } from "vitest"
import { getEffectiveRate, isPenaltyActive, getBaseRate } from "../effective-rate"

describe("getBaseRate", () => {
  it("returns interestRate when no override", () => {
    expect(getBaseRate({ interestRate: "0.1000", interestRateOverride: null })).toBe("0.1000")
  })

  it("returns override rate when set", () => {
    expect(getBaseRate({ interestRate: "0.1000", interestRateOverride: "0.0800" })).toBe("0.0800")
  })
})

describe("isPenaltyActive", () => {
  it("returns false when daysOverdue < 60", () => {
    expect(isPenaltyActive(59, false)).toBe(false)
  })

  it("returns true when daysOverdue >= 60 and not waived", () => {
    expect(isPenaltyActive(60, false)).toBe(true)
  })

  it("returns false when daysOverdue >= 60 but waived", () => {
    expect(isPenaltyActive(60, true)).toBe(false)
  })

  it("returns false when daysOverdue is 0", () => {
    expect(isPenaltyActive(0, false)).toBe(false)
  })

  it("returns true for large overdue values when not waived", () => {
    expect(isPenaltyActive(120, false)).toBe(true)
  })
})

describe("getEffectiveRate", () => {
  const baseLoan = {
    interestRate: "0.1000",
    interestRateOverride: null,
    penaltyMultiplier: "0.1000",
  }

  it("returns base rate when no override and no penalty", () => {
    expect(getEffectiveRate(baseLoan, false)).toBe("0.1000")
  })

  it("returns override rate when set and no penalty", () => {
    expect(getEffectiveRate({ ...baseLoan, interestRateOverride: "0.0800" }, false)).toBe("0.0800")
  })

  it("applies default 10% penalty bump on base rate", () => {
    // 0.10 + (0.10 * 0.10) = 0.10 + 0.01 = 0.11
    expect(getEffectiveRate(baseLoan, true)).toBe("0.1100")
  })

  it("applies penalty on override rate when both set", () => {
    // 0.08 + (0.08 * 0.10) = 0.08 + 0.008 = 0.088
    expect(getEffectiveRate({
      ...baseLoan,
      interestRateOverride: "0.0800",
    }, true)).toBe("0.0880")
  })

  it("uses custom penalty multiplier when provided", () => {
    // 0.10 + (0.10 * 0.20) = 0.10 + 0.02 = 0.12
    expect(getEffectiveRate({
      ...baseLoan,
      penaltyMultiplier: "0.2000",
    }, true)).toBe("0.1200")
  })

  it("uses default multiplier when penaltyMultiplier is null", () => {
    // 0.10 + (0.10 * 0.10) = 0.11
    expect(getEffectiveRate({
      ...baseLoan,
      penaltyMultiplier: null,
    }, true)).toBe("0.1100")
  })

  it("does not apply penalty when penaltyActive is false even with multiplier set", () => {
    expect(getEffectiveRate({
      ...baseLoan,
      penaltyMultiplier: "0.5000",
    }, false)).toBe("0.1000")
  })

  it("handles small rates correctly", () => {
    // 0.05 + (0.05 * 0.10) = 0.05 + 0.005 = 0.055
    expect(getEffectiveRate({
      ...baseLoan,
      interestRate: "0.0500",
    }, true)).toBe("0.0550")
  })

  it("handles large multiplier", () => {
    // 0.10 + (0.10 * 0.50) = 0.10 + 0.05 = 0.15
    expect(getEffectiveRate({
      ...baseLoan,
      penaltyMultiplier: "0.5000",
    }, true)).toBe("0.1500")
  })
})
