import { describe, it, expect } from "vitest"
import { computeLoanOverdueInfo, shouldResetPenaltyWaiver } from "../overdue"

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
      // The runtime branch `!loanType` defaults to perpetual; expose it.
      loanType: null as unknown as "perpetual",
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

describe("computeLoanOverdueInfo — Perpetual: BUG-2 outstanding balance", () => {
  it("uses outstanding balance (not original principal) for interest accrual", () => {
    // Loan: 1M principal, 10%/month, 60 days elapsed
    // Borrower has paid down 500k of principal, so outstandingBalance = 500k
    // Interest should accrue on 500k, not 1M
    // Correct: 500k * (0.10/30) * 60 = 100,000
    // Buggy:   1M  * (0.10/30) * 60 = 200,000
    // If borrower paid 100k interest, correct daysOverdue = 0, buggy = ~30
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(60),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "100000",
      paymentCount: 2,
      outstandingBalance: "500000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    // With outstanding balance = 500k, interest accrued over 60 days = 100k
    // Paid 100k → 0 days overdue
    expect(result.daysOverdue).toBe(0)
    expect(result.unpaidInterest).toBe("0")
    expect(result.penaltyActive).toBe(false)
  })

  it("does not falsely trigger penalty when principal has been partially repaid", () => {
    // 1M loan, 50% principal repaid, 90 days elapsed
    // Outstanding = 500k, interest accrued = 500k * 0.10/30 * 90 = 150k
    // If borrower paid 150k interest → 0 days overdue, no penalty
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: daysAgo(90),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "150000",
      paymentCount: 3,
      outstandingBalance: "500000",
      penaltyWaived: false,
      loan: baseLoan,
    })
    expect(result.daysOverdue).toBe(0)
    expect(result.penaltyActive).toBe(false)
  })
})

describe("computeLoanOverdueInfo — Term Loans: BUG-3 month boundary", () => {
  it("loan starting Jan 31 counts 1 month elapsed by Feb 28", () => {
    // Loan starts Jan 31 2025. On Feb 28 2025, one full month has elapsed.
    // With 0 payments, expectedPayments = 1, missed = 1, daysOverdue = 30
    const startDate = new Date(2025, 0, 31) // Jan 31
    const asOf = new Date(2025, 1, 28) // Feb 28
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "fixed_rate",
      termMonths: 12,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf,
    })
    expect(result.daysOverdue).toBe(30)
  })

  it("loan starting Mar 31 counts 1 month elapsed by Apr 30", () => {
    const startDate = new Date(2025, 2, 31) // Mar 31
    const asOf = new Date(2025, 3, 30) // Apr 30
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "fixed_rate",
      termMonths: 12,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf,
    })
    expect(result.daysOverdue).toBe(30)
  })

  it("loan starting Jan 29 in leap year counts 1 month by Feb 29", () => {
    const startDate = new Date(2024, 0, 29) // Jan 29 2024 (leap year)
    const asOf = new Date(2024, 1, 29) // Feb 29
    const result = computeLoanOverdueInfo({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate,
      loanType: "fixed_rate",
      termMonths: 12,
      totalInterestPaid: "0",
      paymentCount: 0,
      outstandingBalance: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf,
    })
    expect(result.daysOverdue).toBe(30)
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

describe("shouldResetPenaltyWaiver", () => {
  it("should NOT reset waiver when borrower is 55 days overdue", () => {
    // A borrower who dropped from 65 to 55 days overdue still owes money.
    // The admin-approved waiver must stay in place.
    expect(shouldResetPenaltyWaiver(55, true)).toBe(false)
  })

  it("should NOT reset waiver when borrower is 30 days overdue", () => {
    // Still behind on payments — waiver should remain.
    expect(shouldResetPenaltyWaiver(30, true)).toBe(false)
  })

  it("SHOULD reset waiver when borrower reaches 0 days overdue", () => {
    // Fully current — waiver served its purpose, reset for future episodes.
    expect(shouldResetPenaltyWaiver(0, true)).toBe(true)
  })

  it("should NOT reset when penaltyWaived is already false", () => {
    // Nothing to reset.
    expect(shouldResetPenaltyWaiver(0, false)).toBe(false)
  })

  it("should NOT reset when overdue and penaltyWaived is false", () => {
    expect(shouldResetPenaltyWaiver(55, false)).toBe(false)
  })

  it("should NOT reset waiver at exactly 59 days overdue", () => {
    // Edge case: just below the 60-day penalty threshold but still overdue.
    expect(shouldResetPenaltyWaiver(59, true)).toBe(false)
  })

  it("should NOT reset waiver at exactly 1 day overdue", () => {
    // Even slightly overdue — waiver must stay.
    expect(shouldResetPenaltyWaiver(1, true)).toBe(false)
  })
})
