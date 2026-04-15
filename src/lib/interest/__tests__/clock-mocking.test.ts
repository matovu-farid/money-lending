/**
 * Clock-Mocking Tests
 *
 * Uses vi.useFakeTimers() to set the system clock to dangerous dates,
 * then tests that all date-dependent logic produces correct results.
 *
 * This catches:
 *   - Functions that use `new Date()` directly instead of `localDateString()`
 *   - UTC-shift bugs where server timezone causes wrong calendar date
 *   - Month-boundary edge cases in overdue, interest, and period calculations
 *   - Year-boundary issues (Dec 31 → Jan 1)
 *   - Leap year handling (Feb 29 → Mar 1)
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import BigNumber from "bignumber.js"
import {
  calculateInterest,
  calculateDailyRate,
  allocatePayment,
  computeSegmentedInterest,
} from "../engine"
import { computeLoanOverdueInfo } from "../overdue"
import { getEffectiveRate } from "../effective-rate"
import { daysBetween } from "@/lib/db/utils"
import { localDateString } from "@/lib/utils"
import { periodBoundsUTC, asOfDateUTC } from "@/lib/date-utils"

afterEach(() => {
  vi.useRealTimers()
})

const baseLoan = { interestRate: "0.10", interestRateOverride: null, penaltyMultiplier: null }

// ─── Helper ───────────────────────────────────────────────────────

function setSystemClock(date: Date) {
  vi.useFakeTimers()
  vi.setSystemTime(date)
}

// ═══════════════════════════════════════════════════════════════════
// 1. localDateString under fake clock
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: localDateString", () => {
  it("returns correct local date at 11pm (late evening)", () => {
    // Simulate 11pm on April 13 — in UTC+3 this would be April 14 UTC
    setSystemClock(new Date(2026, 3, 13, 23, 0, 0))

    const today = localDateString(new Date())
    expect(today).toBe("2026-04-13")
  })

  it("returns correct date at midnight boundary", () => {
    setSystemClock(new Date(2026, 3, 14, 0, 0, 0))
    expect(localDateString(new Date())).toBe("2026-04-14")
  })

  it("returns correct date on leap day", () => {
    setSystemClock(new Date(2024, 1, 29, 15, 0, 0))
    expect(localDateString(new Date())).toBe("2024-02-29")
  })

  it("returns correct date on Dec 31 → Jan 1 boundary", () => {
    setSystemClock(new Date(2025, 11, 31, 23, 59, 59))
    expect(localDateString(new Date())).toBe("2025-12-31")

    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0))
    expect(localDateString(new Date())).toBe("2026-01-01")
  })
})

// ═══════════════════════════════════════════════════════════════════
// 2. Overdue calculation with fake clock
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: Overdue at dangerous times", () => {
  it("overdue calculation at 11pm gives same result as noon", () => {
    const startDate = new Date(2025, 0, 1)

    // Check at noon
    setSystemClock(new Date(2025, 1, 1, 12, 0, 0))
    const noonResult = computeLoanOverdueInfo({
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
      asOf: new Date(),
    })

    // Check at 11pm same day
    vi.setSystemTime(new Date(2025, 1, 1, 23, 0, 0))
    const eveningResult = computeLoanOverdueInfo({
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
      asOf: new Date(),
    })

    // Same day = same overdue days
    expect(eveningResult.daysOverdue).toBe(noonResult.daysOverdue)
  })

  it("term loan overdue on Feb 28 for Jan 31 start (BUG-3 regression)", () => {
    // Pin clock to Feb 28 2025, 3pm
    setSystemClock(new Date(2025, 1, 28, 15, 0, 0))

    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: new Date(2025, 0, 31), // Jan 31
      loanType: "fixed_rate",
      termMonths: 12,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf: new Date(),
    })

    // BUG-3 was fixed: this should report 30 days overdue (1 month elapsed)
    expect(result.daysOverdue).toBe(30)
  })

  it("penalty threshold at exactly 60 days past midnight", () => {
    const startDate = new Date(2025, 0, 1)
    // Set clock to day 60 at midnight
    setSystemClock(new Date(2025, 2, 2, 0, 0, 0)) // Mar 2 = 60 days after Jan 1

    const result = computeLoanOverdueInfo({
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
      asOf: new Date(),
    })

    expect(result.daysOverdue).toBeGreaterThanOrEqual(60)
    expect(result.penaltyActive).toBe(true)
    expect(result.effectiveRate).toBe("0.1100")
  })

  it("penalty NOT active at day 59", () => {
    const startDate = new Date(2025, 0, 1)
    // Day 59
    setSystemClock(new Date(2025, 2, 1, 23, 59, 59)) // Mar 1 = 59 days

    const result = computeLoanOverdueInfo({
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
      asOf: new Date(),
    })

    expect(result.daysOverdue).toBeLessThan(60)
    expect(result.penaltyActive).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3. daysBetween under fake clock
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: daysBetween at boundaries", () => {
  it("daysBetween from Jan 31 to Feb 28 = 28 days", () => {
    setSystemClock(new Date(2025, 1, 28, 12, 0, 0))
    const from = new Date(2025, 0, 31)
    const to = new Date() // Feb 28
    expect(daysBetween(from, to)).toBe(28)
  })

  it("daysBetween across year boundary: Dec 31 to Jan 1 = 1", () => {
    setSystemClock(new Date(2026, 0, 1, 12, 0, 0))
    const from = new Date(2025, 11, 31)
    const to = new Date()
    expect(daysBetween(from, to)).toBe(1)
  })

  it("daysBetween across leap day: Feb 28 to Mar 1 in leap year = 2", () => {
    setSystemClock(new Date(2024, 2, 1, 12, 0, 0))
    const from = new Date(2024, 1, 28)
    const to = new Date()
    expect(daysBetween(from, to)).toBe(2) // Feb 28 → Feb 29 → Mar 1
  })

  it("daysBetween across leap day: Feb 28 to Mar 1 in non-leap year = 1", () => {
    setSystemClock(new Date(2025, 2, 1, 12, 0, 0))
    const from = new Date(2025, 1, 28)
    const to = new Date()
    expect(daysBetween(from, to)).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4. Period boundaries under fake clock
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: Period boundaries", () => {
  it("periodBoundsUTC for February in leap year", () => {
    setSystemClock(new Date(2024, 2, 15)) // We're "in March" looking at Feb
    const { periodStart, periodEnd } = periodBoundsUTC("2024-02")
    expect(periodStart.toISOString()).toBe("2024-02-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2024-02-29T23:59:59.999Z")
  })

  it("periodBoundsUTC for February in non-leap year", () => {
    setSystemClock(new Date(2025, 2, 15))
    const { periodStart, periodEnd } = periodBoundsUTC("2025-02")
    expect(periodStart.toISOString()).toBe("2025-02-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-02-28T23:59:59.999Z")
  })

  it("asOfDateUTC at year boundary", () => {
    setSystemClock(new Date(2026, 0, 2))
    const asOf = asOfDateUTC("2025-12")
    expect(asOf.toISOString()).toBe("2025-12-31T23:59:59.999Z")
  })

  it("asOfDateUTC for specific date", () => {
    setSystemClock(new Date(2025, 5, 15))
    const asOf = asOfDateUTC("2025-06-15")
    expect(asOf.toISOString()).toBe("2025-06-15T23:59:59.999Z")
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5. Interest calculation at time boundaries
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: Interest calculations at boundaries", () => {
  it("interest for exactly 30 days at month boundary", () => {
    setSystemClock(new Date(2025, 0, 31, 23, 59, 59))
    const startDate = new Date(2025, 0, 1)
    const now = new Date()
    const days = daysBetween(startDate, now)

    const interest = calculateInterest("1000000", "0.10", days, 30)
    // 30 days: 1M * 0.10/30 * 30 = 100,000
    expect(interest.toFixed(0)).toBe("100000")
  })

  it("interest for 28 days in Feb (non-leap) with 30-day min", () => {
    setSystemClock(new Date(2025, 1, 28, 12, 0, 0))
    const startDate = new Date(2025, 1, 1) // Feb 1
    const now = new Date() // Feb 28
    const days = daysBetween(startDate, now) // 27 days

    // With 30-day minimum: charges 30 days even though only 27 elapsed
    const interest = calculateInterest("1000000", "0.10", days, 30)
    expect(interest.toFixed(0)).toBe("100000") // 30 days minimum applied
  })

  it("segmented interest across year boundary", () => {
    setSystemClock(new Date(2026, 0, 15, 12, 0, 0))
    const startDate = new Date(2025, 11, 1) // Dec 1
    const asOfDate = new Date() // Jan 15

    const result = computeSegmentedInterest({
      principalAmount: "1000000",
      monthlyRateDecimal: "0.10",
      startDate,
      asOfDate,
      principalPayments: [
        { date: new Date(2025, 11, 31), principalPortion: "500000" }, // Dec 31: reduce by 500k
      ],
    })

    // Dec 1-31: 30 days on 1M = 100,000
    // Jan 1-15: 15 days on 500k = 25,000
    // Total ≈ 125,000
    const dailyRate = new BigNumber("0.10").dividedBy(30)
    const expected = new BigNumber("1000000").multipliedBy(dailyRate).multipliedBy(30)
      .plus(new BigNumber("500000").multipliedBy(dailyRate).multipliedBy(15))

    const diff = result.minus(expected).abs()
    expect(diff.isLessThanOrEqualTo(1)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6. Full scenario: loan lifecycle at dangerous clock positions
// ═══════════════════════════════════════════════════════════════════

describe("Clock Mock: Full lifecycle scenarios", () => {
  const dangerousClocks = [
    { name: "11:00pm local", date: new Date(2026, 3, 13, 23, 0, 0) },
    { name: "11:59pm local", date: new Date(2026, 3, 13, 23, 59, 59) },
    { name: "midnight", date: new Date(2026, 3, 14, 0, 0, 0) },
    { name: "00:01am", date: new Date(2026, 3, 14, 0, 1, 0) },
    { name: "leap day noon", date: new Date(2024, 1, 29, 12, 0, 0) },
    { name: "Dec 31 11pm", date: new Date(2025, 11, 31, 23, 0, 0) },
    { name: "Jan 1 midnight", date: new Date(2026, 0, 1, 0, 0, 0) },
    { name: "Feb 28 11pm (non-leap)", date: new Date(2025, 1, 28, 23, 0, 0) },
    { name: "Mar 1 midnight (non-leap)", date: new Date(2025, 2, 1, 0, 0, 0) },
  ]

  for (const { name, date } of dangerousClocks) {
    it(`allocation invariants hold at ${name}`, () => {
      setSystemClock(date)

      const principal = "1000000"
      const rate = "0.10"
      const startDate = new Date(date.getTime() - 45 * 86400000) // 45 days ago

      const days = daysBetween(startDate, new Date())
      expect(days).toBeGreaterThanOrEqual(44)
      expect(days).toBeLessThanOrEqual(46)

      const interest = calculateInterest(principal, rate, days, 30)
      expect(interest.isGreaterThan(0)).toBe(true)

      const totalOwed = interest.plus(new BigNumber(principal))
      const paymentAmount = totalOwed.dividedBy(2).integerValue().toFixed(0)

      const alloc = allocatePayment({
        paymentAmount,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      })

      // Conservation
      const sum = new BigNumber(alloc.interestPortion).plus(new BigNumber(alloc.principalPortion))
      expect(sum.minus(new BigNumber(paymentAmount)).abs().isLessThanOrEqualTo(1)).toBe(true)

      // Non-negative balance
      expect(new BigNumber(alloc.principalBalanceAfter).isGreaterThanOrEqualTo(0)).toBe(true)
    })

    it(`overdue calculation consistent at ${name}`, () => {
      setSystemClock(date)

      const startDate = new Date(date.getTime() - 90 * 86400000) // 90 days ago
      const result = computeLoanOverdueInfo({
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
        asOf: new Date(),
      })

      // 90 days with 0 paid → should be ~90 days overdue
      expect(result.daysOverdue).toBeGreaterThanOrEqual(88)
      expect(result.daysOverdue).toBeLessThanOrEqual(92)
      expect(result.penaltyActive).toBe(true)
      expect(Number(result.unpaidInterest)).toBeGreaterThan(0)
    })
  }
})
