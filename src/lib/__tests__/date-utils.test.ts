import { describe, it, expect } from "vitest"
import { periodBoundsUTC, asOfDateUTC } from "../date-utils"

describe("periodBoundsUTC", () => {
  it("January has 31 days", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-01")
    expect(periodStart.toISOString()).toBe("2025-01-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-01-31T23:59:59.999Z")
  })

  it("February non-leap year has 28 days", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-02")
    expect(periodStart.toISOString()).toBe("2025-02-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-02-28T23:59:59.999Z")
  })

  it("February leap year has 29 days", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2024-02")
    expect(periodStart.toISOString()).toBe("2024-02-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2024-02-29T23:59:59.999Z")
  })

  it("April has 30 days", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-04")
    expect(periodStart.toISOString()).toBe("2025-04-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-04-30T23:59:59.999Z")
  })

  it("December (year boundary)", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-12")
    expect(periodStart.toISOString()).toBe("2025-12-01T00:00:00.000Z")
    expect(periodEnd.toISOString()).toBe("2025-12-31T23:59:59.999Z")
  })

  it("start is midnight UTC and end is 23:59:59.999 UTC", () => {
    const { periodStart, periodEnd } = periodBoundsUTC("2025-06")
    expect(periodStart.getUTCHours()).toBe(0)
    expect(periodStart.getUTCMinutes()).toBe(0)
    expect(periodStart.getUTCSeconds()).toBe(0)
    expect(periodStart.getUTCMilliseconds()).toBe(0)
    expect(periodEnd.getUTCHours()).toBe(23)
    expect(periodEnd.getUTCMinutes()).toBe(59)
    expect(periodEnd.getUTCSeconds()).toBe(59)
    expect(periodEnd.getUTCMilliseconds()).toBe(999)
  })
})

describe("asOfDateUTC", () => {
  it("YYYY-MM format returns end of month", () => {
    const result = asOfDateUTC("2025-03")
    expect(result.toISOString()).toBe("2025-03-31T23:59:59.999Z")
  })

  it("YYYY-MM-DD format returns end of that day", () => {
    const result = asOfDateUTC("2025-03-15")
    expect(result.toISOString()).toBe("2025-03-15T23:59:59.999Z")
  })

  it("mid-month date", () => {
    const result = asOfDateUTC("2025-07-10")
    expect(result.toISOString()).toBe("2025-07-10T23:59:59.999Z")
  })
})
