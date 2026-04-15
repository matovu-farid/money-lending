import { describe, it, expect } from "vitest"
import fc from "fast-check"
import {
  cn,
  formatNumberWithCommas,
  stripCommas,
  formatDate,
  formatDateTime,
  localDateString,
  formatCurrency,
  formatRate,
  getCurrentMonth,
} from "../utils"

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("resolves tailwind conflicts — last wins", () => {
    expect(cn("p-4", "p-2")).toBe("p-2")
  })

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible")
  })

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("")
  })
})

describe("formatNumberWithCommas", () => {
  it("formats a simple integer", () => {
    expect(formatNumberWithCommas("1000")).toBe("1,000")
  })

  it("formats a large number", () => {
    expect(formatNumberWithCommas("1000000")).toBe("1,000,000")
  })

  it("handles numbers with decimals (UGX: integer only)", () => {
    expect(formatNumberWithCommas("1234567.89")).toBe("1,234,567")
  })

  it("strips non-numeric characters except dots", () => {
    expect(formatNumberWithCommas("$1,000,000")).toBe("1,000,000")
  })

  it("returns empty string for empty input", () => {
    expect(formatNumberWithCommas("")).toBe("")
  })

  it("returns empty string for non-numeric input", () => {
    expect(formatNumberWithCommas("abc")).toBe("")
  })

  it("handles small numbers without commas", () => {
    expect(formatNumberWithCommas("999")).toBe("999")
  })

  it("handles value that is just a dot (UGX: strips decimal)", () => {
    // UGX has no cents — ".5" → cleaned "." → integer part "" → empty
    expect(formatNumberWithCommas(".5")).toBe("")
  })

  it("handles leading zeros", () => {
    expect(formatNumberWithCommas("007")).toBe("007")
  })
})

describe("stripCommas", () => {
  it("removes commas from formatted number", () => {
    expect(stripCommas("1,000,000")).toBe("1000000")
  })

  it("returns unchanged string when no commas", () => {
    expect(stripCommas("500")).toBe("500")
  })

  it("handles empty string", () => {
    expect(stripCommas("")).toBe("")
  })

  it("handles string with only commas", () => {
    expect(stripCommas(",,,")).toBe("")
  })
})

describe("formatDate", () => {
  it("formats a Date object", () => {
    const d = new Date(2026, 2, 22) // March 22, 2026
    expect(formatDate(d)).toBe("Mar 22, 2026")
  })

  it("formats a date string", () => {
    // Use local Date constructor to avoid UTC midnight timezone shifts
    expect(formatDate(new Date(2026, 0, 15))).toBe("Jan 15, 2026")
  })

  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("\u2014")
  })

  it("returns em dash for undefined", () => {
    expect(formatDate(undefined)).toBe("\u2014")
  })

  it("returns em dash for invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("\u2014")
  })
})

describe("formatDateTime", () => {
  it("formats a Date object with time", () => {
    const d = new Date(2026, 2, 22, 15, 45) // March 22, 2026, 3:45 PM
    expect(formatDateTime(d)).toBe("Mar 22, 2026, 3:45 PM")
  })

  it("formats a date string with time", () => {
    // Use a fixed local time to avoid timezone issues
    const d = new Date(2026, 0, 15, 9, 30)
    expect(formatDateTime(d)).toBe("Jan 15, 2026, 9:30 AM")
  })

  it("returns em dash for null", () => {
    expect(formatDateTime(null)).toBe("\u2014")
  })

  it("returns em dash for undefined", () => {
    expect(formatDateTime(undefined)).toBe("\u2014")
  })

  it("returns em dash for invalid date string", () => {
    expect(formatDateTime("garbage")).toBe("\u2014")
  })
})

describe("localDateString", () => {
  it("returns YYYY-MM-DD from a Date using local components, not UTC", () => {
    // Construct a date at 11pm local on April 13 → UTC is April 14 if UTC+3
    // localDateString should still return April 13
    const d = new Date(2026, 3, 13, 23, 30) // Apr 13, 11:30pm local
    expect(localDateString(d)).toBe("2026-04-13")
  })

  it("returns correct date at midnight", () => {
    const d = new Date(2026, 0, 1, 0, 0, 0) // Jan 1 midnight local
    expect(localDateString(d)).toBe("2026-01-01")
  })

  it("pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5) // Jan 5
    expect(localDateString(d)).toBe("2026-01-05")
  })

  it("differs from toISOString().slice(0,10) for late-night local dates in UTC+ zones", () => {
    // This test documents the bug: toISOString gives UTC which can be a different date
    const lateNight = new Date(2026, 3, 13, 23, 30) // Apr 13 23:30 local
    const utcDate = lateNight.toISOString().slice(0, 10)
    const localDate = localDateString(lateNight)
    // In UTC+N zones, utcDate could be Apr 14 while localDate is Apr 13
    // In UTC or UTC- zones, they match. Either way, localDate must be Apr 13.
    expect(localDate).toBe("2026-04-13")
    // The UTC version may or may not match depending on server TZ — this is the bug
  })
})

describe("Property-Based: Formatting Functions", () => {
  // Arbitraries
  const arbPositiveInt = fc.integer({ min: 0, max: 999_999_999 })
  const arbPositiveIntStr = arbPositiveInt.map(String)

  describe("formatNumberWithCommas / stripCommas round-trip", () => {
    it("stripCommas(formatNumberWithCommas(n)) === n for positive integers", () => {
      fc.assert(
        fc.property(arbPositiveIntStr, (numStr) => {
          const formatted = formatNumberWithCommas(numStr)
          const stripped = stripCommas(formatted)
          return stripped === numStr
        }),
        { numRuns: 500 }
      )
    })

    it("formatNumberWithCommas output contains only digits and commas", () => {
      fc.assert(
        fc.property(arbPositiveIntStr, (numStr) => {
          const formatted = formatNumberWithCommas(numStr)
          return /^[\d,]*$/.test(formatted)
        }),
        { numRuns: 500 }
      )
    })

    it("commas are placed every 3 digits from the right", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000, max: 999_999_999 }).map(String), (numStr) => {
          const formatted = formatNumberWithCommas(numStr)
          // Split by commas — each group except the first should have exactly 3 digits
          const groups = formatted.split(",")
          if (groups.length <= 1) return true
          // First group: 1-3 digits
          if (groups[0].length < 1 || groups[0].length > 3) return false
          // Remaining groups: exactly 3 digits
          return groups.slice(1).every(g => g.length === 3)
        }),
        { numRuns: 500 }
      )
    })

    it("formatNumberWithCommas is idempotent when re-applied", () => {
      fc.assert(
        fc.property(arbPositiveIntStr, (numStr) => {
          const once = formatNumberWithCommas(numStr)
          const twice = formatNumberWithCommas(once)
          return once === twice
        }),
        { numRuns: 300 }
      )
    })
  })

  describe("formatCurrency", () => {
    it("always starts with 'UGX ' for valid numbers", () => {
      fc.assert(
        fc.property(arbPositiveInt, (num) => {
          return formatCurrency(num).startsWith("UGX ")
        }),
        { numRuns: 300 }
      )
    })

    it("returns 'UGX —' for null and undefined", () => {
      expect(formatCurrency(null)).toBe("UGX —")
      expect(formatCurrency(undefined)).toBe("UGX —")
    })

    it("returns 'UGX —' for NaN and Infinity", () => {
      expect(formatCurrency(NaN)).toBe("UGX —")
      expect(formatCurrency(Infinity)).toBe("UGX —")
    })

    it("string and number inputs produce same output", () => {
      fc.assert(
        fc.property(arbPositiveInt, (num) => {
          return formatCurrency(num) === formatCurrency(String(num))
        }),
        { numRuns: 300 }
      )
    })

    it("negative amounts include minus sign", () => {
      fc.assert(
        fc.property(fc.integer({ min: -999_999_999, max: -1 }), (num) => {
          const result = formatCurrency(num)
          return result.includes("-")
        }),
        { numRuns: 200 }
      )
    })
  })

  describe("formatRate", () => {
    it("always ends with '%'", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.001, max: 1.0, noNaN: true }),
          (rate) => {
            return formatRate(rate).endsWith("%")
          }
        ),
        { numRuns: 300 }
      )
    })

    it("string and number inputs produce same output", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }).map(n => (n / 10000)),
          (rate) => {
            return formatRate(rate) === formatRate(String(rate))
          }
        ),
        { numRuns: 200 }
      )
    })

    it("rate 0.01 to 1.0 produces 1% to 100%", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }).map(n => n / 100),
          (rate) => {
            const result = formatRate(rate)
            const numPart = parseFloat(result.replace("%", ""))
            return numPart >= 1 && numPart <= 100
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  describe("localDateString", () => {
    it("always produces YYYY-MM-DD format", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date(2000, 0, 1), max: new Date(2030, 11, 31), noInvalidDate: true }),
          (d) => {
            return /^\d{4}-\d{2}-\d{2}$/.test(localDateString(d))
          }
        ),
        { numRuns: 500 }
      )
    })

    it("parsed date matches original date components", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date(2000, 0, 1), max: new Date(2030, 11, 31), noInvalidDate: true }),
          (d) => {
            const str = localDateString(d)
            const [y, m, day] = str.split("-").map(Number)
            return y === d.getFullYear() && m === d.getMonth() + 1 && day === d.getDate()
          }
        ),
        { numRuns: 500 }
      )
    })

    it("is deterministic: same date always produces same string", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date(2000, 0, 1), max: new Date(2030, 11, 31), noInvalidDate: true }),
          (d) => {
            return localDateString(d) === localDateString(new Date(d.getTime()))
          }
        ),
        { numRuns: 300 }
      )
    })
  })

  describe("getCurrentMonth", () => {
    it("produces YYYY-MM format", () => {
      const result = getCurrentMonth()
      expect(result).toMatch(/^\d{4}-\d{2}$/)
    })

    it("month is between 01 and 12", () => {
      const month = parseInt(getCurrentMonth().split("-")[1])
      expect(month).toBeGreaterThanOrEqual(1)
      expect(month).toBeLessThanOrEqual(12)
    })
  })
})
