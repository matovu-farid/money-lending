import { describe, it, expect } from "vitest"
import BigNumber from "bignumber.js"
import { computeDaysOverdue, computeUnpaidInterest } from "../overdue-client"
import { computeLoanOverdueInfo } from "../overdue"
import { getBaseRate } from "../effective-rate"

// Match the server's BigNumber config (set in engine.ts)
BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

// ─── helpers ─────────────────────────────────────────────────────────────────

const baseLoan = {
  status: "active" as const,
  loanType: "perpetual" as const,
  principalAmount: "1000000",
  interestRate: "0.10",
  interestRateOverride: null as string | null,
  minInterestDays: 30,
  startDate: new Date("2026-01-01"),
}

function dateDiff(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── plan starter cases ───────────────────────────────────────────────────────

describe("computeDaysOverdue — plan starter cases", () => {
  const today = new Date("2026-03-02") // 60 days after Jan 1

  // Second arg is `totalInterestPaid` (cumulative) — when borrower has paid
  // enough to cover all accrued, unpaid is 0.
  it("returns 0 when paid >= accrued (200,000 paid against 60-day accrual)", () => {
    expect(computeDaysOverdue(baseLoan, "200000", "1000000", today)).toBe(0)
  })

  it("returns 0 for non-active loans", () => {
    expect(
      computeDaysOverdue({ ...baseLoan, status: "fully_paid" }, "0", "1000000", today),
    ).toBe(0)
  })

  it("returns 0 for pending loans", () => {
    expect(
      computeDaysOverdue({ ...baseLoan, status: "pending" }, "0", "1000000", today),
    ).toBe(0)
  })

  it("returns 0 when today === startDate", () => {
    expect(computeDaysOverdue(baseLoan, "0", "1000000", baseLoan.startDate)).toBe(0)
  })

  // Day 0 with full month's interest already paid (the screenshot bug case).
  // Accrued at day 0 = 0, paid = 200,000, unpaid = max(0 − 200,000, 0) = 0.
  it("returns 0 for a same-day loan with prior interest payment", () => {
    const startDate = new Date("2026-04-28")
    const sameDay = new Date("2026-04-28")
    expect(
      computeDaysOverdue(
        { ...baseLoan, principalAmount: "2000000", startDate },
        "200000",
        "2000000",
        sameDay,
      ),
    ).toBe(0)
  })
})

// ─── equivalence with server computeLoanOverdueInfo (perpetual) ──────────────

describe("computeDaysOverdue — server equivalence (perpetual loans)", () => {
  it("60 days elapsed, zero paid → daysOverdue equals server", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-03-02") // exactly 60 days
    expect(dateDiff(startDate, today)).toBe(60)

    const totalInterestPaid = "0"
    const client = computeDaysOverdue({ ...baseLoan, startDate }, totalInterestPaid, "1000000", today)

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid,
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })

  it("90 days elapsed, 100k paid → daysOverdue equals server", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-04-01") // 90 days
    expect(dateDiff(startDate, today)).toBe(90)

    const totalInterestPaid = "100000"
    const client = computeDaysOverdue({ ...baseLoan, startDate }, totalInterestPaid, "1000000", today)

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid,
      paymentCount: 1,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })

  it("outstanding balance reduced → daysOverdue equals server (BUG-2)", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-03-02") // 60 days
    const outstandingBalance = "500000"
    const totalInterestPaid = "0"

    const client = computeDaysOverdue(
      { ...baseLoan, startDate },
      totalInterestPaid,
      outstandingBalance,
      today,
    )

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid,
      paymentCount: 0,
      outstandingBalance,
      penaltyWaived: false,
      loan: baseLoan,
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })

  it("interestRateOverride: uses override rate (getBaseRate semantics)", () => {
    const overrideLoan = {
      ...baseLoan,
      interestRate: "0.10",
      interestRateOverride: "0.08" as string | null,
    }
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-04-01") // 90 days

    const baseRate = getBaseRate(overrideLoan) // "0.08"
    const totalInterestPaid = "0"
    const client = computeDaysOverdue({ ...overrideLoan, startDate }, totalInterestPaid, "1000000", today)

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate,
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid,
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: overrideLoan,
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })

  it("fully paid → daysOverdue = 0 (paid covers full accrual)", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-03-02")
    // 60-day accrual on 1M at 10%/mo = 200,000. Paid 200K → unpaid 0.
    const client = computeDaysOverdue({ ...baseLoan, startDate }, "200000", "1000000", today)
    expect(client).toBe(0)
  })

  it("penalty threshold: 60+ days → daysOverdue >= 60", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-04-01") // 90 days, nothing paid
    const client = computeDaysOverdue({ ...baseLoan, startDate }, "0", "1000000", today)
    expect(client).toBeGreaterThanOrEqual(60)
  })
})

// ─── backdated startDate ──────────────────────────────────────────────────────

describe("computeDaysOverdue — backdated loan", () => {
  it("backdated 89 days with no payments", () => {
    const startDate = new Date("2025-11-01")
    const today = new Date("2026-01-29") // 89 days later
    expect(dateDiff(startDate, today)).toBe(89)

    const totalInterestPaid = "0"
    const client = computeDaysOverdue(
      { ...baseLoan, principalAmount: "2000000", startDate },
      totalInterestPaid,
      "2000000",
      today,
    )

    const srv = computeLoanOverdueInfo({
      principalAmount: "2000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid,
      paymentCount: 0,
      outstandingBalance: "2000000",
      penaltyWaived: false,
      loan: { interestRate: "0.10", interestRateOverride: null, penaltyMultiplier: null },
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })
})

// ─── edge cases ───────────────────────────────────────────────────────────────

describe("computeDaysOverdue — edge cases", () => {
  it("falls back to principalAmount when outstandingBalance is '0'", () => {
    const today = new Date("2026-03-02")
    // outstandingBalance = '0' → fallback to principalAmount
    const withZeroBalance = computeDaysOverdue(baseLoan, "0", "0", today)
    const withBalance = computeDaysOverdue(baseLoan, "0", "1000000", today)
    expect(withZeroBalance).toBe(withBalance)
  })

  it("zero interest rate → returns 0 (no division by zero)", () => {
    const today = new Date("2026-03-02")
    const zeroRateLoan = {
      ...baseLoan,
      interestRate: "0",
      interestRateOverride: null,
    }
    expect(computeDaysOverdue(zeroRateLoan, "100000", "1000000", today)).toBe(0)
  })

  it("startDate in the future → returns 0", () => {
    const future = new Date("2027-01-01")
    const today = new Date("2026-01-01")
    expect(computeDaysOverdue({ ...baseLoan, startDate: future }, "100000", "1000000", today)).toBe(0)
  })

  it("non-active statuses all return 0", () => {
    const today = new Date("2026-03-02")
    const statuses = ["pending", "fully_paid", "settled_with_collateral", "rolled_over"] as const
    for (const status of statuses) {
      expect(computeDaysOverdue({ ...baseLoan, status }, "0", "1000000", today)).toBe(0)
    }
  })
})

// ─── computeUnpaidInterest — penalty surcharge ──────────────────────────────

const baseLoanForUnpaid = {
  ...baseLoan,
  penaltyMultiplier: "0.1000",
  penaltyWaived: false,
}

describe("computeUnpaidInterest — penalty surcharge", () => {
  it("returns base-rate accrual when not yet 60 days overdue (penalty inactive)", () => {
    // 30 days at 10%/month on 1M = 100,000 — well under the 60-day threshold
    const today = new Date("2026-01-31")
    const unpaid = computeUnpaidInterest(baseLoanForUnpaid, "0", "1000000", today)
    expect(unpaid).toBe("100000")
  })

  it("matches base-rate calc when penalty is waived even past the threshold", () => {
    // 90 days at 10%/month — penalty would be active, but waived
    const today = new Date("2026-04-01")
    const baseAccrual = computeUnpaidInterest(
      { ...baseLoanForUnpaid, penaltyWaived: true },
      "0",
      "1000000",
      today,
    )
    expect(baseAccrual).toBe("300000") // 1,000,000 × 0.10 × 90 / 30
  })

  it("adds penalty surcharge for days past the crossover when penalty is active", () => {
    // 90 days since start, no payments → unpaidAtBase reaches 60-day threshold
    // around day 60. Days 0-60: base 10%; days 60-90 (30 days): effective 11%.
    // accruedAtBase     = 1,000,000 × 0.10 × 60 / 30 = 200,000
    // accruedAtEffective= 1,000,000 × 0.11 × 30 / 30 = 110,000
    // total accrued     = 310,000  (vs 300,000 without penalty)
    const today = new Date("2026-04-01")
    const unpaid = computeUnpaidInterest(baseLoanForUnpaid, "0", "1000000", today)
    expect(unpaid).toBe("310000")
  })

  it("pushes the crossover day later when interest has been partially paid", () => {
    // 200 days since start, 50,000 paid. dailyAtBase = 100,000/30 ≈ 3,333.33
    // crossover day = 60 + 50,000 / 3,333.33 = 60 + 15 = 75
    // days at base = 75, days at effective = 125
    // accruedAtBase      = 1,000,000 × 0.10 × 75 / 30 = 250,000
    // accruedAtEffective = 1,000,000 × 0.11 × 125 / 30 ≈ 458,333.33
    // total accrued      ≈ 708,333 — minus 50,000 paid = 658,333
    const today = new Date("2026-07-20") // 200 days after Jan 1
    const unpaid = computeUnpaidInterest(baseLoanForUnpaid, "50000", "1000000", today)
    expect(unpaid).toBe("658333")
  })

  it("uses interestRateOverride as the base rate when set", () => {
    // override to 5% — 90 days at 5% on 1M = 150,000 (below threshold-worth)
    // dailyAtBase = 50,000/30 ≈ 1,666.67; daysOverdueAtBase = 150,000/1,666.67 = 90
    // penalty active. crossover = 60. accruedAtBase = 1M × 0.05 × 60/30 = 100,000
    // accruedAtEffective = 1M × 0.055 × 30/30 = 55,000. total = 155,000.
    const today = new Date("2026-04-01")
    const overrideLoan = { ...baseLoanForUnpaid, interestRateOverride: "0.05" }
    const unpaid = computeUnpaidInterest(overrideLoan, "0", "1000000", today)
    expect(unpaid).toBe("155000")
  })
})
