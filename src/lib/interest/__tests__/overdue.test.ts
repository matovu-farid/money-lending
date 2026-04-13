import { describe, it, expect } from "vitest"
import { computeLoanOverdueInfo } from "../overdue"

// Helper to create a date N days ago
function daysAgo(n: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

// Helper to create a date with specific year/month offset
function monthsAgo(n: number, dayOffset = 0): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() - n)
  d.setDate(d.getDate() + dayOffset)
  return d
}

const baseLoan = {
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: null,
}

describe("computeLoanOverdueInfo — Perpetual Loans", () => {
  it("zero days overdue when all interest is paid", () => {
    // 1M at 10%/month for 30 days = 100k interest. Paid 100k.
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(30),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "100000",
      paymentCount: 1,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBe(0)
    expect(result.unpaidInterest).toBe("0")
    expect(result.penaltyActive).toBe(false)
    expect(result.effectiveRate).toBe("0.10")
  })

  it("calculates overdue days when no payments made", () => {
    // 1M at 10%/month for 30 days, zero paid
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(30),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBeGreaterThan(0)
    expect(Number(result.unpaidInterest)).toBeGreaterThan(0)
  })

  it("partial payment reduces overdue days", () => {
    // 1M at 10%/month for 60 days = 200k interest. Paid 100k → ~30 days overdue
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(60),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "100000",
      paymentCount: 1,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // Should be approximately 30 days overdue
    expect(result.daysOverdue).toBeGreaterThanOrEqual(28)
    expect(result.daysOverdue).toBeLessThanOrEqual(32)
  })

  it("penalty activates at 60+ days overdue", () => {
    // 1M at 10%/month for 90 days = 300k interest. Paid 0 → ~90 days overdue → penalty
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(90),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBeGreaterThanOrEqual(60)
    expect(result.penaltyActive).toBe(true)
    // effectiveRate should be bumped: 0.10 * (1 + 0.10) = 0.1100
    expect(result.effectiveRate).toBe("0.1100")
  })

  it("penalty is waived when penaltyWaived is true", () => {
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(90),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: true,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBeGreaterThanOrEqual(60)
    expect(result.penaltyActive).toBe(false)
    expect(result.effectiveRate).toBe("0.10")
  })

  it("uses custom penalty multiplier when provided", () => {
    const customLoan = {
      interestRate: "0.10",
      interestRateOverride: null,
      penaltyMultiplier: "0.2000", // 20% bump instead of default 10%
    }
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(90),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: customLoan,
    })
    expect(result.penaltyActive).toBe(true)
    // effectiveRate = 0.10 * (1 + 0.20) = 0.1200
    expect(result.effectiveRate).toBe("0.1200")
  })

  it("uses interestRateOverride as base rate when present", () => {
    const overrideLoan = {
      interestRate: "0.10",
      interestRateOverride: "0.08",
      penaltyMultiplier: null,
    }
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.08", // caller passes the override as baseRate
      startDate: daysAgo(30),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "80000", // matches 0.08 rate for 30 days
      paymentCount: 1,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: overrideLoan,
    })
    expect(result.daysOverdue).toBe(0)
    // effectiveRate uses overrideLoan which has override = "0.08"
    expect(result.effectiveRate).toBe("0.08")
  })

  it("returns dailyRate as a string integer", () => {
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(30),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // 1M * (0.10/30) = 3333.33... → rounded to "3333"
    expect(result.dailyRate).toBe("3333")
  })

  it("handles null loanType as perpetual", () => {
    const result = computeLoanOverdueInfo({
      principalAmount: "500000",
      baseRate: "0.10",
      startDate: daysAgo(30),
      loanType: null as any,
      termMonths: null,
      totalInterestPaid: "50000",
      paymentCount: 1,
      outstandingBalance: "500000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBe(0)
    expect(result.unpaidInterest).toBe("0")
  })

  it("unpaid interest is never negative", () => {
    // Overpaid interest scenario
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(30),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "200000", // more than 100k owed
      paymentCount: 2,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(Number(result.unpaidInterest)).toBeGreaterThanOrEqual(0)
  })
})

describe("computeLoanOverdueInfo — Term Loans (fixed_rate)", () => {
  it("zero days overdue when all expected payments are made", () => {
    // 3 months elapsed, 3 payments made
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: monthsAgo(3),
      loanType: "fixed_rate",
      termMonths: 6,
      totalInterestPaid: "300000", // 3 months * 100k
      paymentCount: 3,
      outstandingBalance: "500000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBe(0)
  })

  it("calculates overdue for missed payments", () => {
    // 3 months elapsed, only 1 payment made → 2 missed → 60 days overdue
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: monthsAgo(3),
      loanType: "fixed_rate",
      termMonths: 6,
      totalInterestPaid: "100000",
      paymentCount: 1,
      outstandingBalance: "800000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBe(60) // 2 missed * 30
    expect(result.penaltyActive).toBe(true)
  })

  it("caps expected payments at termMonths", () => {
    // 10 months elapsed but term is 6 → only 6 expected
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: monthsAgo(10),
      loanType: "fixed_rate",
      termMonths: 6,
      totalInterestPaid: "400000",
      paymentCount: 4,
      outstandingBalance: "300000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // Expected 6, actual 4, missed 2 → 60 days
    expect(result.daysOverdue).toBe(60)
  })

  it("uses original principal for fixed_rate interest calculation", () => {
    // Fixed rate: monthly interest = principalAmount * baseRate = 1M * 0.10 = 100k
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: monthsAgo(1),
      loanType: "fixed_rate",
      termMonths: 6,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // dailyRate = 1M * 0.10 / 30 = 3333
    expect(result.dailyRate).toBe("3333")
  })
})

describe("computeLoanOverdueInfo — Term Loans (reducing_balance)", () => {
  it("uses outstanding balance for reducing_balance interest", () => {
    // reducing_balance: monthly interest = outstandingBalance * baseRate
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: monthsAgo(3),
      loanType: "reducing_balance",
      termMonths: 6,
      totalInterestPaid: "80000",
      paymentCount: 3,
      outstandingBalance: "500000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // dailyRate = 500000 * 0.10 / 30 = 1667
    expect(result.dailyRate).toBe("1667")
    expect(result.daysOverdue).toBe(0)
  })
})
