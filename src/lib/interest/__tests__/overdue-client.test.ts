import { describe, it, expect } from "vitest"
import BigNumber from "bignumber.js"
import { computeDaysOverdue } from "../overdue-client"
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

/**
 * Compute the full-precision unpaidInterest that would be stored in the
 * loan_balances projection for a perpetual loan with no prior principal
 * repayments. This is what the projection would contain in production.
 *
 * Formula mirrors server perpetual path:
 *   accrued = balance × (rate / 30) × daysElapsed
 *   unpaid  = max(accrued − totalInterestPaid, 0)
 */
function analyticalUnpaidInterest(
  balance: string,
  rate: string,
  daysElapsed: number,
  totalInterestPaid: string,
): string {
  const dailyRate = new BigNumber(rate).dividedBy(30)
  const accrued = new BigNumber(balance).multipliedBy(dailyRate).multipliedBy(daysElapsed)
  return BigNumber.max(accrued.minus(totalInterestPaid), 0).toFixed(10)
}

function dateDiff(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── plan starter cases ───────────────────────────────────────────────────────

describe("computeDaysOverdue — plan starter cases", () => {
  const today = new Date("2026-03-02") // 60 days after Jan 1

  it("returns 0 when no interest is owed (unpaidInterest = '0')", () => {
    expect(computeDaysOverdue(baseLoan, "0", "1000000", today)).toBe(0)
  })

  it("returns 0 for non-active loans", () => {
    expect(
      computeDaysOverdue({ ...baseLoan, status: "fully_paid" }, "100000", "1000000", today),
    ).toBe(0)
  })

  it("returns 0 for pending loans", () => {
    expect(
      computeDaysOverdue({ ...baseLoan, status: "pending" }, "100000", "1000000", today),
    ).toBe(0)
  })

  it("returns 0 when today === startDate", () => {
    expect(computeDaysOverdue(baseLoan, "0", "1000000", baseLoan.startDate)).toBe(0)
  })

  it("returns 0 when unpaidInterest is negative", () => {
    expect(computeDaysOverdue(baseLoan, "-5000", "1000000", today)).toBe(0)
  })
})

// ─── equivalence with server computeLoanOverdueInfo (perpetual) ──────────────

describe("computeDaysOverdue — server equivalence (perpetual loans)", () => {
  it("60 days elapsed, zero paid → daysOverdue equals server", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-03-02") // exactly 60 days
    expect(dateDiff(startDate, today)).toBe(60)

    // The projection's unpaid_interest would hold full-precision accrued interest.
    const unpaid = analyticalUnpaidInterest("1000000", "0.10", 60, "0")
    const client = computeDaysOverdue({ ...baseLoan, startDate }, unpaid, "1000000", today)

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
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
    const unpaid = analyticalUnpaidInterest("1000000", "0.10", 90, totalInterestPaid)
    const client = computeDaysOverdue({ ...baseLoan, startDate }, unpaid, "1000000", today)

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

    // Server uses outstandingBalance for accrual
    const unpaid = analyticalUnpaidInterest(outstandingBalance, "0.10", 60, totalInterestPaid)
    const client = computeDaysOverdue(
      { ...baseLoan, startDate },
      unpaid,
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
    const unpaid = analyticalUnpaidInterest("1000000", baseRate, 90, "0")
    const client = computeDaysOverdue({ ...overrideLoan, startDate }, unpaid, "1000000", today)

    const srv = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate,
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: overrideLoan,
      asOf: today,
    })
    expect(client).toBe(srv.daysOverdue)
  })

  it("fully paid → daysOverdue = 0 (equals server)", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-03-02")
    // If totalInterestPaid = totalInterestAccrued, unpaid = 0
    const client = computeDaysOverdue({ ...baseLoan, startDate }, "0", "1000000", today)
    expect(client).toBe(0)
  })

  it("penalty threshold: 60+ days → daysOverdue >= 60", () => {
    const startDate = new Date("2026-01-01")
    const today = new Date("2026-04-01") // 90 days, nothing paid
    // accrued on 90 days = 1000000 * 0.10/30 * 90 = 299999.997 (BigNumber 10dp)
    // dailyRate = 3333.3333
    // daysOverdue = floor(299999.997 / 3333.3333) = floor(89.999...) = 89
    const unpaid = analyticalUnpaidInterest("1000000", "0.10", 90, "0")
    const client = computeDaysOverdue({ ...baseLoan, startDate }, unpaid, "1000000", today)
    expect(client).toBeGreaterThanOrEqual(60)
  })
})

// ─── backdated startDate ──────────────────────────────────────────────────────

describe("computeDaysOverdue — backdated loan", () => {
  it("backdated 89 days with no payments", () => {
    const startDate = new Date("2025-11-01")
    const today = new Date("2026-01-29") // 89 days later
    expect(dateDiff(startDate, today)).toBe(89)

    const unpaid = analyticalUnpaidInterest("2000000", "0.10", 89, "0")
    const client = computeDaysOverdue(
      { ...baseLoan, principalAmount: "2000000", startDate },
      unpaid,
      "2000000",
      today,
    )

    const srv = computeLoanOverdueInfo({
      principalAmount: "2000000",
      baseRate: "0.10",
      startDate,
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
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
    // 60 days of accrual on principalAmount = 1M
    const unpaid = analyticalUnpaidInterest("1000000", "0.10", 60, "0")
    // outstandingBalance = '0' → fallback to principalAmount
    const withZeroBalance = computeDaysOverdue(baseLoan, unpaid, "0", today)
    const withBalance = computeDaysOverdue(baseLoan, unpaid, "1000000", today)
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
    const unpaid = "100000"
    const statuses = ["pending", "fully_paid", "settled_with_collateral", "rolled_over"] as const
    for (const status of statuses) {
      expect(computeDaysOverdue({ ...baseLoan, status }, unpaid, "1000000", today)).toBe(0)
    }
  })
})
