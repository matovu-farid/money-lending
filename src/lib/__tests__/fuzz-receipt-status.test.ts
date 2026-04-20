import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { generateReceiptNumber } from "../receipt-number"
import {
  customerStatusVariant,
  customerStatusLabel,
  loanStatusVariant,
  loanStatusLabel,
  approvalStatusBadgeVariant,
} from "../status"

const KNOWN_CUSTOMER_STATUSES = ["active", "blacklisted", "inactive"]
const KNOWN_LOAN_STATUSES = [
  "active",
  "pending",
  "fully_paid",
  "settled_with_collateral",
  "rolled_over",
]
const KNOWN_APPROVAL_STATUSES = ["pending", "approved", "rejected"]
const ALL_KNOWN_STATUSES = [
  ...new Set([
    ...KNOWN_CUSTOMER_STATUSES,
    ...KNOWN_LOAN_STATUSES,
    ...KNOWN_APPROVAL_STATUSES,
  ]),
]

// Object.prototype property names can collide with Record<string,...> lookups
const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype)

const safeStringArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !PROTO_KEYS.includes(s))

const unknownStatusArb = safeStringArb.filter(
  (s) => !ALL_KNOWN_STATUSES.includes(s),
)

describe("Receipt Number — property-based tests", () => {
  it("format invariant: matches /^RCP-\\d{8}-[A-Z2-9]{4}$/", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const receipt = generateReceiptNumber()
        expect(receipt).toMatch(/^RCP-\d{8}-[A-Z2-9]{4}$/)
      }),
      { numRuns: 200 },
    )
  })

  it("no forbidden characters: random portion never contains 0, 1, I, or O", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const receipt = generateReceiptNumber()
        const randomPart = receipt.slice(-4)
        expect(randomPart).not.toMatch(/[01IO]/)
      }),
      { numRuns: 200 },
    )
  })

  it("uniqueness: 200 generated receipts are all unique", () => {
    const receipts = Array.from({ length: 200 }, () => generateReceiptNumber())
    const unique = new Set(receipts)
    expect(unique.size).toBe(200)
  })

  it("date portion is valid: 8-digit date parses to a valid date", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const receipt = generateReceiptNumber()
        const datePart = receipt.slice(4, 12)
        const year = Number(datePart.slice(0, 4))
        const month = Number(datePart.slice(4, 6))
        const day = Number(datePart.slice(6, 8))
        const parsed = new Date(year, month - 1, day)
        expect(parsed.getFullYear()).toBe(year)
        expect(parsed.getMonth() + 1).toBe(month)
        expect(parsed.getDate()).toBe(day)
      }),
      { numRuns: 200 },
    )
  })
})

describe("Status Mappers — property-based tests", () => {
  it("customerStatusVariant always returns a valid variant", () => {
    fc.assert(
      fc.property(safeStringArb, (s) => {
        const result = customerStatusVariant(s)
        expect(["default", "destructive", "secondary"]).toContain(result)
      }),
      { numRuns: 200 },
    )
  })

  it("customerStatusLabel never returns empty string", () => {
    fc.assert(
      fc.property(safeStringArb, (s) => {
        const result = customerStatusLabel(s)
        expect(result.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  it('loanStatusVariant always returns "default" or "outline"', () => {
    fc.assert(
      fc.property(safeStringArb, (s) => {
        const result = loanStatusVariant(s)
        expect(["default", "outline"]).toContain(result)
      }),
      { numRuns: 200 },
    )
  })

  it("loanStatusLabel never returns empty string", () => {
    fc.assert(
      fc.property(safeStringArb, (s) => {
        const result = loanStatusLabel(s)
        expect(result.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  it("loanStatusLabel for unknown status capitalizes first char", () => {
    fc.assert(
      fc.property(unknownStatusArb, (s) => {
        const result = loanStatusLabel(s)
        expect(result[0]).toBe(result[0].toUpperCase())
      }),
      { numRuns: 200 },
    )
  })

  it("approvalStatusBadgeVariant always returns a valid variant", () => {
    fc.assert(
      fc.property(safeStringArb, (s) => {
        const result = approvalStatusBadgeVariant(s)
        expect(["default", "outline", "secondary", "destructive"]).toContain(
          result,
        )
      }),
      { numRuns: 200 },
    )
  })

  it("known statuses are stable (determinism)", () => {
    for (const status of KNOWN_CUSTOMER_STATUSES) {
      const expected = customerStatusVariant(status)
      const expectedLabel = customerStatusLabel(status)
      for (let i = 0; i < 1000; i++) {
        expect(customerStatusVariant(status)).toBe(expected)
        expect(customerStatusLabel(status)).toBe(expectedLabel)
      }
    }

    for (const status of KNOWN_LOAN_STATUSES) {
      const expected = loanStatusVariant(status)
      const expectedLabel = loanStatusLabel(status)
      for (let i = 0; i < 1000; i++) {
        expect(loanStatusVariant(status)).toBe(expected)
        expect(loanStatusLabel(status)).toBe(expectedLabel)
      }
    }

    for (const status of KNOWN_APPROVAL_STATUSES) {
      const expected = approvalStatusBadgeVariant(status)
      for (let i = 0; i < 1000; i++) {
        expect(approvalStatusBadgeVariant(status)).toBe(expected)
      }
    }
  })
})
