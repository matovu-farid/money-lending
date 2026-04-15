/**
 * Property-Based Fuzz Tests for date-utils.ts
 *
 * Uses fast-check to verify invariants of periodBoundsUTC and asOfDateUTC
 * across thousands of random date inputs, with automatic shrinking on failure.
 */
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { periodBoundsUTC, asOfDateUTC } from "../date-utils"

// ─── Custom Arbitraries ───────────────────────────────────────────

const arbYear = fc.integer({ min: 2000, max: 2099 })
const arbMonth = fc.integer({ min: 1, max: 12 })
const arbPeriod = fc
  .tuple(arbYear, arbMonth)
  .map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`)
const arbDay = fc.integer({ min: 1, max: 28 }) // safe for all months
const arbFullDate = fc
  .tuple(arbYear, arbMonth, arbDay)
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  )

// ─── Helper: expected days in month ──────────────────────────────

function expectedDaysInMonth(year: number, month: number): number {
  // month is 1-based
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// ─── Tests ────────────────────────────────────────────────────────

describe("date-utils fuzz tests", () => {
  it("periodStart is always the 1st of the month at midnight UTC", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const { periodStart } = periodBoundsUTC(period)
        expect(periodStart.getUTCDate()).toBe(1)
        expect(periodStart.getUTCHours()).toBe(0)
        expect(periodStart.getUTCMinutes()).toBe(0)
        expect(periodStart.getUTCSeconds()).toBe(0)
        expect(periodStart.getUTCMilliseconds()).toBe(0)
      }),
      { numRuns: 200 }
    )
  })

  it("periodEnd is always the last day of the month at 23:59:59.999 UTC", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const { periodEnd } = periodBoundsUTC(period)
        expect(periodEnd.getUTCHours()).toBe(23)
        expect(periodEnd.getUTCMinutes()).toBe(59)
        expect(periodEnd.getUTCSeconds()).toBe(59)
        expect(periodEnd.getUTCMilliseconds()).toBe(999)
      }),
      { numRuns: 200 }
    )
  })

  it("periodEnd is always >= periodStart (chronological ordering)", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const { periodStart, periodEnd } = periodBoundsUTC(period)
        expect(periodEnd.getTime()).toBeGreaterThanOrEqual(
          periodStart.getTime()
        )
      }),
      { numRuns: 200 }
    )
  })

  it("periodEnd.getUTCDate() matches expected days in month", () => {
    fc.assert(
      fc.property(arbYear, arbMonth, (year, month) => {
        const period = `${year}-${String(month).padStart(2, "0")}`
        const { periodEnd } = periodBoundsUTC(period)
        const expected = expectedDaysInMonth(year, month)
        expect(periodEnd.getUTCDate()).toBe(expected)

        // Specific checks for well-known cases
        if (month === 2) {
          const isLeap =
            (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
          expect(periodEnd.getUTCDate()).toBe(isLeap ? 29 : 28)
        } else if ([4, 6, 9, 11].includes(month)) {
          expect(periodEnd.getUTCDate()).toBe(30)
        } else {
          expect(periodEnd.getUTCDate()).toBe(31)
        }
      }),
      { numRuns: 200 }
    )
  })

  it("periodStart and periodEnd are in the same month and year", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const { periodStart, periodEnd } = periodBoundsUTC(period)
        expect(periodStart.getUTCMonth()).toBe(periodEnd.getUTCMonth())
        expect(periodStart.getUTCFullYear()).toBe(periodEnd.getUTCFullYear())
      }),
      { numRuns: 200 }
    )
  })

  it("asOfDateUTC with YYYY-MM returns same as periodBoundsUTC().periodEnd", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const fromAsOf = asOfDateUTC(period)
        const fromBounds = periodBoundsUTC(period).periodEnd
        expect(fromAsOf.getTime()).toBe(fromBounds.getTime())
      }),
      { numRuns: 200 }
    )
  })

  it("asOfDateUTC with YYYY-MM-DD returns end of that day (23:59:59.999)", () => {
    fc.assert(
      fc.property(arbFullDate, (fullDate) => {
        const result = asOfDateUTC(fullDate)
        const [year, month, day] = fullDate.split("-").map(Number)

        // Time components are always 23:59:59.999
        expect(result.getUTCHours()).toBe(23)
        expect(result.getUTCMinutes()).toBe(59)
        expect(result.getUTCSeconds()).toBe(59)
        expect(result.getUTCMilliseconds()).toBe(999)

        // Date components match input
        expect(result.getUTCFullYear()).toBe(year)
        expect(result.getUTCMonth()).toBe(month - 1)
        expect(result.getUTCDate()).toBe(day)
      }),
      { numRuns: 200 }
    )
  })

  it("consecutive months: next month's start = this month's end + 1ms (no gaps, no overlaps)", () => {
    fc.assert(
      fc.property(
        arbYear,
        fc.integer({ min: 1, max: 11 }), // max 11 so month+1 stays <= 12
        (year, month) => {
          const currentPeriod = `${year}-${String(month).padStart(2, "0")}`
          const nextMonth = month + 1
          const nextYear = year
          const nextPeriod = `${nextYear}-${String(nextMonth).padStart(2, "0")}`

          const currentEnd = periodBoundsUTC(currentPeriod).periodEnd
          const nextStart = periodBoundsUTC(nextPeriod).periodStart

          expect(nextStart.getTime()).toBe(currentEnd.getTime() + 1)
        }
      ),
      { numRuns: 200 }
    )
  })

  it("idempotency: periodBoundsUTC(period) called twice gives same result", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const first = periodBoundsUTC(period)
        const second = periodBoundsUTC(period)
        expect(first.periodStart.getTime()).toBe(second.periodStart.getTime())
        expect(first.periodEnd.getTime()).toBe(second.periodEnd.getTime())
      }),
      { numRuns: 200 }
    )
  })
})
