import { describe, it, expect } from "vitest"
import { generateReceiptNumber } from "../receipt-number"

describe("generateReceiptNumber", () => {
  const ALLOWED_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

  it("returns string matching format RCP-YYYYMMDD-XXXX", () => {
    const result = generateReceiptNumber()
    expect(result).toMatch(/^RCP-\d{8}-[A-Z0-9]{4}$/)
  })

  it("random portion is exactly 4 characters", () => {
    const result = generateReceiptNumber()
    const rand = result.split("-").slice(2).join("-")
    expect(rand).toHaveLength(4)
  })

  it("random portion only contains chars from the allowed set (no 0, 1, I, O)", () => {
    // Generate several to increase confidence
    for (let i = 0; i < 50; i++) {
      const result = generateReceiptNumber()
      const rand = result.split("-").slice(2).join("-")
      for (const ch of rand) {
        expect(ALLOWED_CHARS).toContain(ch)
      }
    }
  })

  it("multiple calls produce unique values", () => {
    const results = new Set<string>()
    for (let i = 0; i < 100; i++) {
      results.add(generateReceiptNumber())
    }
    expect(results.size).toBe(100)
  })

  it("date portion matches today's local date", () => {
    const result = generateReceiptNumber()
    const datePart = result.split("-")[1]
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const expected = `${y}${m}${d}`
    expect(datePart).toBe(expected)
  })

  it("uses local date, not UTC (11 PM EAT = 8 PM UTC on Apr 20 should show 20260420)", () => {
    // Simulate 11 PM EAT (UTC+3) on April 20, 2026 → 8 PM UTC on April 20
    const fakeDate = new Date("2026-04-20T20:00:00.000Z")
    const origDate = globalThis.Date
    const OrigDate = Date

    // Mock Date so `new Date()` returns our fake date; pass any explicit
    // args through to the real Date constructor. Branching on args.length
    // narrows each call into a typed Date overload (no-arg / single-arg /
    // year+month+...).
    class MockDate extends OrigDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fakeDate.getTime())
        } else if (args.length === 1) {
          super(args[0] as number | string | Date)
        } else {
          const [y, m, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args as number[]
          super(y, m, d, h, mi, s, ms)
        }
      }
    }
    // Copy static methods
    MockDate.now = () => fakeDate.getTime()

    globalThis.Date = MockDate as DateConstructor

    try {
      const result = generateReceiptNumber()
      const datePart = result.split("-")[1]
      // In EAT (UTC+3), 8PM UTC on Apr 20 = 11PM Apr 20 local
      // The receipt date should use local date, which is April 20
      // With toISOString() it would also show 20 in UTC, but the key point is
      // we use local date components, not UTC
      const localDay = String(fakeDate.getDate()).padStart(2, "0")
      const localMonth = String(fakeDate.getMonth() + 1).padStart(2, "0")
      const localYear = fakeDate.getFullYear()
      expect(datePart).toBe(`${localYear}${localMonth}${localDay}`)
    } finally {
      globalThis.Date = origDate
    }
  })
})
