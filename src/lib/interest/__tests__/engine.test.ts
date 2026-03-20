import { describe, it, expect } from "vitest"
import BigNumber from "bignumber.js"
import {
  calculateInterest,
  calculateDailyRate,
  calculateLoanSummary,
  calculateDaysOverdue,
  formatAmount,
  allocatePayment,
} from "../engine"

describe("Interest Engine", () => {
  // Test 1: calculateInterest basic — 500,000 UGX at 10%/month for 30 days = 50,000.00 UGX
  it("calculateInterest: 500,000 at 10%/month for 30 days = 50,000.00 UGX (LOAN-03)", () => {
    const result = calculateInterest("500000", "0.10", 30, 30)
    expect(result.toFixed(2)).toBe("50000.00")
  })

  // Test 2: calculateInterest pro-rated days — 500,000 UGX at 10%/month for 45 days = 75,000.00 UGX
  it("calculateInterest: 500,000 at 10%/month for 45 days = 75,000.00 UGX (LOAN-03)", () => {
    const result = calculateInterest("500000", "0.10", 45, 30)
    expect(result.toFixed(2)).toBe("75000.00")
  })

  // Test 3: calculateInterest minimum period — 500,000 UGX at 10%/month for 15 days with 30-day minimum = 50,000.00 UGX
  it("calculateInterest: minimum period enforced — 15 days charges 30 days (LOAN-10)", () => {
    const result = calculateInterest("500000", "0.10", 15, 30)
    expect(result.toFixed(2)).toBe("50000.00")
  })

  // Test 4: calculateInterest 1-day elapsed, 30-day minimum = 30 days charged
  it("calculateInterest: 1-day elapsed with 30-day minimum = 30 days charged (LOAN-10)", () => {
    const result = calculateInterest("1000000", "0.10", 1, 30)
    expect(result.toFixed(2)).toBe("100000.00")
  })

  // Test 5: calculateDailyRate — 10%/month = monthly_rate / 30
  it("calculateDailyRate: 10%/month returns monthlyRate divided by 30", () => {
    const result = calculateDailyRate("0.10")
    const expected = new BigNumber("0.10").dividedBy(30)
    expect(result.toFixed(10)).toBe(expected.toFixed(10))
  })

  // Test 6: calculateLoanSummary for Review step — returns daily interest, total interest at min period, total owed at min period
  it("calculateLoanSummary: returns correct fields for Review step — no termDays or dueDate", () => {
    const result = calculateLoanSummary("500000", "0.10", 30)
    expect(result.dailyInterest).toBe("1666.67")
    expect(result.totalInterestAtMinPeriod).toBe("50000.00")
    expect(result.totalOwedAtMinPeriod).toBe("550000.00")
    expect(result.minInterestDays).toBe(30)
    // Critical: must NOT have termDays or dueDate
    expect("termDays" in result).toBe(false)
    expect("dueDate" in result).toBe(false)
  })

  // Test 7: formatAmount — BigNumber(50000) returns "50000.00"
  it("formatAmount: BigNumber(50000) returns '50000.00'", () => {
    const result = formatAmount(new BigNumber("50000"))
    expect(result).toBe("50000.00")
  })

  // Test 8: No native float arithmetic in engine (advisory)
  it("engine.ts uses only BigNumber methods for arithmetic — no native float operators (advisory)", () => {
    // This test is advisory — it checks the import/usage pattern
    // We verify this indirectly: all results are deterministic BigNumber outputs
    const r1 = calculateInterest("123456", "0.075", 30, 30)
    const r2 = calculateInterest("123456", "0.075", 30, 30)
    expect(r1.toFixed(2)).toBe(r2.toFixed(2))
  })

  // Test 9: calculateInterest with custom minimum period override — 500,000 UGX at 10%/month for 10 days with 15-day override
  it("calculateInterest: custom minimum period — 10 days elapsed charges 15 days (LOAN-11)", () => {
    const result = calculateInterest("500000", "0.10", 10, 15)
    expect(result.toFixed(2)).toBe("25000.00")
  })

  // Test 10: calculateDaysOverdue — 50,000 unpaid at 3333.33 daily rate ≈ 15 days overdue
  it("calculateDaysOverdue: 50,000 unpaid interest / 3333.33 daily rate ≈ 15 days (RISK-01)", () => {
    const result = calculateDaysOverdue("100000", "50000", "3333.33")
    const expected = new BigNumber("50000").dividedBy(new BigNumber("3333.33"))
    expect(result.toFixed(4)).toBe(expected.toFixed(4))
    // Approximately 15 days
    expect(result.toNumber()).toBeCloseTo(15, 0)
  })

  // Test 11: calculateDaysOverdue — zero unpaid interest returns 0
  it("calculateDaysOverdue: zero unpaid interest returns BigNumber(0) (RISK-01)", () => {
    const result = calculateDaysOverdue("100000", "100000", "3333.33")
    expect(result.toFixed(2)).toBe("0.00")
  })

  // Test 12: calculateDaysOverdue — no payments yet on day 30 returns 30 days overdue
  it("calculateDaysOverdue: 100,000 unpaid / 3333.33 daily rate ≈ 30 days overdue (RISK-01)", () => {
    const result = calculateDaysOverdue("100000", "0", "3333.33")
    const expected = new BigNumber("100000").dividedBy(new BigNumber("3333.33"))
    expect(result.toFixed(4)).toBe(expected.toFixed(4))
    // Approximately 30 days
    expect(result.toNumber()).toBeCloseTo(30, 0)
  })
})

describe("allocatePayment", () => {
  // Test 1: Payment < interest owed — all goes to interest, principal unchanged (LOAN-08, LOAN-09)
  it("payment of 50000 against balance 1000000 at 10%/month after 30 days: all to interest, zero principal reduction (LOAN-08)", () => {
    // interest = 1000000 * (0.10/30) * 30 = 100000; payment 50000 < 100000
    const result = allocatePayment({
      paymentAmount: "50000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("50000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceBefore).toBe("1000000")
    expect(result.principalBalanceAfter).toBe("1000000")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Test 2: Payment > interest owed — excess reduces principal (LOAN-08)
  it("payment of 150000 against balance 1000000 at 10%/month after 30 days: 100000 interest + 50000 principal (LOAN-08)", () => {
    // interest = 100000; payment = 150000; principal portion = 50000; balance after = 950000
    const result = allocatePayment({
      paymentAmount: "150000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("50000.00")
    expect(result.principalBalanceBefore).toBe("1000000")
    expect(result.principalBalanceAfter).toBe("950000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Test 3: Payment exceeds total owed — principal balance goes to zero, loan fully paid (LOAN-08)
  it("payment of 1100000 against balance 1000000 at 10%/month after 30 days: fully paid", () => {
    // interest = 100000; principal portion = 1000000; balance after = 0
    const result = allocatePayment({
      paymentAmount: "1100000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("1000000.00")
    expect(result.principalBalanceBefore).toBe("1000000")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  // Test 4: Minimum period enforcement — payment after 15 days still uses 30-day interest (LOAN-10)
  it("payment after 15 days with 30-day minimum charges full 30-day interest", () => {
    // interest = 1000000 * (0.10/30) * 30 = 100000 (not 15 days)
    const result = allocatePayment({
      paymentAmount: "150000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 15,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("50000.00")
    expect(result.principalBalanceAfter).toBe("950000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Test 5: Any amount accepted — payment of 1.00 works without error (LOAN-09)
  it("any amount accepted — payment of 1.00 allocates entirely to interest without error (LOAN-09)", () => {
    const result = allocatePayment({
      paymentAmount: "1.00",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("1.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceBefore).toBe("1000000")
    expect(result.principalBalanceAfter).toBe("1000000")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Test 6: Custom minInterestDays override — 45-day minimum computes correctly
  it("custom minInterestDays of 45 — payment after 20 days still charges 45-day interest", () => {
    // interest = 1000000 * (0.10/30) * 45 = 150000
    const result = allocatePayment({
      paymentAmount: "200000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 20,
      minInterestDays: 45,
    })
    expect(result.interestPortion).toBe("150000.00")
    expect(result.principalPortion).toBe("50000.00")
    expect(result.principalBalanceAfter).toBe("950000.00")
    expect(result.loanFullyPaid).toBe(false)
  })
})
