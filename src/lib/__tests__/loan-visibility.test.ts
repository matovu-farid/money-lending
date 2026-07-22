import { describe, it, expect } from "vitest"
import {
  OPERATIONAL_LOAN_STATUS,
  isOperationalLoan,
  isHistoricalLoan,
  isTerminalLoanStatus,
  isLoanReadOnly,
  assertLoanOperational,
} from "../loan-visibility"
import { ValidationError } from "../errors"
import type { LoanStatus } from "@/types/loan"

const ALL_STATUSES: LoanStatus[] = [
  "pending",
  "active",
  "fully_paid",
  "settled_with_collateral",
  "rolled_over",
]

describe("loan-visibility", () => {
  describe("isOperationalLoan", () => {
    it("is true only for active", () => {
      expect(OPERATIONAL_LOAN_STATUS).toBe("active")
      for (const status of ALL_STATUSES) {
        expect(isOperationalLoan(status)).toBe(status === "active")
      }
    })
  })

  describe("isHistoricalLoan", () => {
    it("excludes active and pending", () => {
      expect(isHistoricalLoan("active")).toBe(false)
      expect(isHistoricalLoan("pending")).toBe(false)
      expect(isHistoricalLoan("rolled_over")).toBe(true)
      expect(isHistoricalLoan("fully_paid")).toBe(true)
      expect(isHistoricalLoan("settled_with_collateral")).toBe(true)
    })
  })

  describe("isTerminalLoanStatus", () => {
    it("covers rolled_over, fully_paid, settled_with_collateral", () => {
      expect(isTerminalLoanStatus("rolled_over")).toBe(true)
      expect(isTerminalLoanStatus("fully_paid")).toBe(true)
      expect(isTerminalLoanStatus("settled_with_collateral")).toBe(true)
      expect(isTerminalLoanStatus("active")).toBe(false)
      expect(isTerminalLoanStatus("pending")).toBe(false)
    })
  })

  describe("isLoanReadOnly", () => {
    it("is inverse of operational", () => {
      for (const status of ALL_STATUSES) {
        expect(isLoanReadOnly(status)).toBe(!isOperationalLoan(status))
      }
    })
  })

  describe("assertLoanOperational", () => {
    it("passes for active", () => {
      expect(() => assertLoanOperational({ status: "active" })).not.toThrow()
    })

    it("throws ValidationError for non-active", () => {
      for (const status of ALL_STATUSES.filter((s) => s !== "active")) {
        expect(() => assertLoanOperational({ status })).toThrow(ValidationError)
        try {
          assertLoanOperational({ status })
        } catch (e) {
          expect(e).toBeInstanceOf(ValidationError)
          expect((e as ValidationError).message).toBe("Loan is not active")
        }
      }
    })
  })
})
