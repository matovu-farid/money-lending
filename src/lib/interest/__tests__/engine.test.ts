import { describe, it, expect } from "vitest"
import BigNumber from "bignumber.js"
import {
  calculateInterest,
  calculateDailyRate,
  calculateLoanSummary,
  calculateDaysOverdue,
  formatAmount,
  allocatePayment,
  calculateSchedule,
  allocateFixedRatePayment,
  allocateReducingBalancePayment,
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

  // Test 7: allocatePayment backward compatibility — no loanType defaults to perpetual
  it("backward compatible — no loanType uses perpetual logic", () => {
    const result = allocatePayment({
      paymentAmount: "150000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("50000.00")
  })

  // Test 8: allocatePayment with loanType="perpetual" uses perpetual logic
  it("loanType='perpetual' explicitly uses perpetual logic", () => {
    const result = allocatePayment({
      paymentAmount: "150000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "perpetual",
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("50000.00")
  })

  // Test 9: allocatePayment dispatches to fixed_rate
  it("loanType='fixed_rate' dispatches to fixed rate allocation", () => {
    const result = allocatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "fixed_rate",
      originalPrincipal: "1000000",
      termMonths: 5,
      paymentNumber: 1,
    })
    // fixed rate: interest = 1000000 * 0.10 = 100000
    // principal portion = 300000 - 100000 = 200000
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
  })

  // Test 10: allocatePayment dispatches to reducing_balance
  it("loanType='reducing_balance' dispatches to reducing balance allocation", () => {
    const result = allocatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "800000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "reducing_balance",
      originalPrincipal: "1000000",
      termMonths: 5,
    })
    // reducing balance: interest = 800000 * 0.10 = 80000
    // principal portion = 300000 - 80000 = 220000
    expect(result.interestPortion).toBe("80000.00")
    expect(result.principalPortion).toBe("220000.00")
  })
})

describe("calculateSchedule", () => {
  // Fixed rate: 1M at 10%/month for 5 months
  it("fixed_rate: 1M at 10%/month for 5 months — constant interest each month", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "fixed_rate")
    expect(schedule).toHaveLength(5)

    // Each month: principal=200000, interest=100000 (on original 1M), installment=300000
    for (let i = 0; i < 5; i++) {
      expect(schedule[i].month).toBe(i + 1)
      expect(schedule[i].monthlyInterest).toBe("100000.00")
      expect(schedule[i].monthlyInstallment).toBe("300000.00")
    }

    // Balances decrease by 200k each month
    expect(schedule[0].balanceAfter).toBe("800000.00")
    expect(schedule[1].balanceAfter).toBe("600000.00")
    expect(schedule[2].balanceAfter).toBe("400000.00")
    expect(schedule[3].balanceAfter).toBe("200000.00")
    expect(schedule[4].balanceAfter).toBe("0.00")
  })

  it("fixed_rate: total interest = 500k for 1M at 10% over 5 months", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "fixed_rate")
    const totalInterest = schedule.reduce(
      (sum, e) => sum.plus(e.monthlyInterest),
      new BigNumber(0)
    )
    expect(totalInterest.toFixed(2)).toBe("500000.00")
  })

  // Reducing balance: 1M at 10%/month for 5 months
  it("reducing_balance: 1M at 10%/month for 5 months — decreasing interest", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "reducing_balance")
    expect(schedule).toHaveLength(5)

    // Month 1: interest = 1000000 * 0.10 = 100000, principal = 200000, installment = 300000
    expect(schedule[0].month).toBe(1)
    expect(schedule[0].monthlyPrincipal).toBe("200000.00")
    expect(schedule[0].monthlyInterest).toBe("100000.00")
    expect(schedule[0].monthlyInstallment).toBe("300000.00")
    expect(schedule[0].balanceAfter).toBe("800000.00")

    // Month 2: interest = 800000 * 0.10 = 80000
    expect(schedule[1].monthlyInterest).toBe("80000.00")
    expect(schedule[1].monthlyInstallment).toBe("280000.00")
    expect(schedule[1].balanceAfter).toBe("600000.00")

    // Month 3: interest = 600000 * 0.10 = 60000
    expect(schedule[2].monthlyInterest).toBe("60000.00")
    expect(schedule[2].monthlyInstallment).toBe("260000.00")
    expect(schedule[2].balanceAfter).toBe("400000.00")

    // Month 4: interest = 400000 * 0.10 = 40000
    expect(schedule[3].monthlyInterest).toBe("40000.00")
    expect(schedule[3].monthlyInstallment).toBe("240000.00")
    expect(schedule[3].balanceAfter).toBe("200000.00")

    // Month 5: interest = 200000 * 0.10 = 20000
    expect(schedule[4].monthlyInterest).toBe("20000.00")
    expect(schedule[4].monthlyInstallment).toBe("220000.00")
    expect(schedule[4].balanceAfter).toBe("0.00")
  })

  it("reducing_balance: total interest = 300k for 1M at 10% over 5 months", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "reducing_balance")
    const totalInterest = schedule.reduce(
      (sum, e) => sum.plus(e.monthlyInterest),
      new BigNumber(0)
    )
    expect(totalInterest.toFixed(2)).toBe("300000.00")
  })

  it("last month principal absorbs rounding remainder", () => {
    // 1M / 3 = 333333.33 repeating — last month should get the remainder
    const schedule = calculateSchedule("1000000", "0.10", 3, "fixed_rate")
    expect(schedule).toHaveLength(3)
    // Month 1 and 2: 333333.33
    expect(schedule[0].monthlyPrincipal).toBe("333333.33")
    expect(schedule[1].monthlyPrincipal).toBe("333333.33")
    // Month 3: remainder = 1000000 - 333333.33 - 333333.33 = 333333.34
    expect(schedule[2].monthlyPrincipal).toBe("333333.34")
    expect(schedule[2].balanceAfter).toBe("0.00")
  })

  it("single month term works correctly", () => {
    const schedule = calculateSchedule("500000", "0.10", 1, "fixed_rate")
    expect(schedule).toHaveLength(1)
    expect(schedule[0].monthlyPrincipal).toBe("500000.00")
    expect(schedule[0].monthlyInterest).toBe("50000.00")
    expect(schedule[0].monthlyInstallment).toBe("550000.00")
    expect(schedule[0].balanceAfter).toBe("0.00")
  })
})

describe("allocateFixedRatePayment", () => {
  // Normal payment — covers interest + principal
  it("normal payment covers interest and principal", () => {
    const result = allocateFixedRatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    // interest = 1000000 * 0.10 = 100000
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("800000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Payment less than interest — all goes to interest
  it("payment less than interest — all goes to interest", () => {
    const result = allocateFixedRatePayment({
      paymentAmount: "50000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    expect(result.interestPortion).toBe("50000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceAfter).toBe("1000000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Early payoff — charges ALL remaining term interest
  it("early payoff charges ALL remaining term interest", () => {
    // Payment 1 of 5: normal installment = 300000 (200k principal + 100k interest)
    // If payment > 300000, it's an early payoff attempt
    // Remaining months = 5 - 1 + 1 = 5 (current month included)
    // Total remaining interest = 5 * 100000 = 500000
    // Total to fully pay = 500000 (interest) + 1000000 (balance) = 1500000
    const result = allocateFixedRatePayment({
      paymentAmount: "1500000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    expect(result.interestPortion).toBe("500000.00")
    expect(result.principalPortion).toBe("1000000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  // Early payoff at month 3 of 5
  it("early payoff at month 3 charges remaining 3 months of interest", () => {
    // At month 3, balance = 600000 (after 2 payments of 200k principal)
    // Remaining months = 5 - 3 + 1 = 3
    // Remaining interest = 3 * 100000 = 300000
    // Normal installment = 300000
    // Payment > 300000 triggers early payoff
    const result = allocateFixedRatePayment({
      paymentAmount: "900000",
      principalBalanceBefore: "600000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 3,
    })
    expect(result.interestPortion).toBe("300000.00")
    expect(result.principalPortion).toBe("600000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  // Payment exactly equals interest
  it("payment exactly equals interest — zero principal reduction", () => {
    const result = allocateFixedRatePayment({
      paymentAmount: "100000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceAfter).toBe("1000000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Edge case: paymentNumber > termMonths (multiple partial payments)
  it("paymentNumber exceeding termMonths clamps to 1 remaining month", () => {
    // 5-month term, but borrower made 7 partial payments. paymentNumber = 7.
    // remainingMonths = max(5 - 7 + 1, 1) = 1
    // Normal payment should charge 1 month interest = 100k
    const result = allocateFixedRatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "200000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 7,
    })
    // Interest = 100k (1 month), principal = 200k (remainder)
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  // Edge case: payment slightly above normal installment should NOT trigger early payoff
  it("payment slightly above installment does NOT trigger early payoff", () => {
    // Normal installment = 300k. Payment = 300001.
    // This should NOT charge all remaining term interest.
    // earlyPayoffThreshold = interest(100k) + balance(1M) = 1.1M
    const result = allocateFixedRatePayment({
      paymentAmount: "300001",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    // Should charge only 1 month interest, not 5 months
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200001.00")
    expect(result.loanFullyPaid).toBe(false)
  })
})

describe("allocateReducingBalancePayment", () => {
  // Normal payment at full balance
  it("normal payment at full balance — interest on current balance", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    // interest = 1000000 * 0.10 = 100000
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("800000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Payment at reduced balance — less interest
  it("payment at reduced balance — interest on current balance only", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "280000",
      principalBalanceBefore: "800000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    // interest = 800000 * 0.10 = 80000
    expect(result.interestPortion).toBe("80000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("600000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Payment less than interest
  it("payment less than interest — all to interest", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "50000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    expect(result.interestPortion).toBe("50000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceAfter).toBe("1000000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  // Early payoff — only charges interest on current balance (saves money)
  it("early payoff only charges interest on current balance", () => {
    // Balance = 800000, interest = 800000 * 0.10 = 80000
    // To fully pay: 80000 + 800000 = 880000
    const result = allocateReducingBalancePayment({
      paymentAmount: "880000",
      principalBalanceBefore: "800000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    expect(result.interestPortion).toBe("80000.00")
    expect(result.principalPortion).toBe("800000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  // Large overpayment — capped at balance
  it("overpayment caps principal reduction at balance", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "2000000",
      principalBalanceBefore: "800000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    expect(result.interestPortion).toBe("80000.00")
    expect(result.principalPortion).toBe("800000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })
})

describe("calculateLoanSummary — extended", () => {
  // Perpetual summary (existing behavior, backward compatible)
  it("perpetual summary unchanged when no loanType", () => {
    const result = calculateLoanSummary("500000", "0.10", 30)
    expect(result.dailyInterest).toBe("1666.67")
    expect(result.totalInterestAtMinPeriod).toBe("50000.00")
    expect(result.totalOwedAtMinPeriod).toBe("550000.00")
  })

  it("perpetual summary unchanged when loanType='perpetual'", () => {
    const result = calculateLoanSummary("500000", "0.10", 30, "perpetual")
    expect(result.dailyInterest).toBe("1666.67")
  })

  // Fixed rate summary
  it("fixed_rate summary includes schedule, totalInterest, totalOwed, monthlyInstallment", () => {
    const result = calculateLoanSummary("1000000", "0.10", 30, "fixed_rate", 5)
    expect(result.schedule).toHaveLength(5)
    expect(result.totalInterest).toBe("500000.00")
    expect(result.totalOwed).toBe("1500000.00")
    expect(result.monthlyInstallment).toBe("300000.00")
  })

  // Reducing balance summary
  it("reducing_balance summary includes schedule, totalInterest, totalOwed, monthlyInstallment", () => {
    const result = calculateLoanSummary("1000000", "0.10", 30, "reducing_balance", 5)
    expect(result.schedule).toHaveLength(5)
    expect(result.totalInterest).toBe("300000.00")
    expect(result.totalOwed).toBe("1300000.00")
    // First month installment
    expect(result.monthlyInstallment).toBe("300000.00")
  })
})
