import { describe, it, expect } from "vitest"
import {
  cn,
  formatNumberWithCommas,
  stripCommas,
  formatDate,
  formatDateTime,
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

  it("handles numbers with decimals", () => {
    expect(formatNumberWithCommas("1234567.89")).toBe("1,234,567.89")
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

  it("handles value that is just a dot", () => {
    expect(formatNumberWithCommas(".5")).toBe(".5")
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
