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

  it("date portion matches today's date", () => {
    const result = generateReceiptNumber()
    const datePart = result.split("-")[1]
    const expected = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    expect(datePart).toBe(expected)
  })
})
