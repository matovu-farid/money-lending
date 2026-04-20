import { describe, it, expect } from "vitest"
import { computeReceiptAllocation } from "../receipt-allocation"

describe("computeReceiptAllocation", () => {
  // --- Core invariant: outstandingBalanceAfter === totalBalance - paymentAmount ---
  // This is the exact bug that was fixed: the receipt used to show the PRE-payment
  // balance (totalBefore) instead of the POST-payment balance (balanceAfter).

  it("outstandingBalanceAfter equals totalBalance minus paymentAmount, not totalBalance itself", () => {
    // This test directly catches the bug: if outstandingBalanceAfter were set to
    // totalBefore (1100000) instead of balanceAfter (950000), it would fail.
    const result = computeReceiptAllocation("150000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.outstandingBalanceAfter).toBe("950000")
    // Must NOT be the pre-payment balance
    expect(result.outstandingBalanceAfter).not.toBe("1100000")
  })

  it("outstandingBalanceAfter is always less than totalBalance when payment > 0", () => {
    const balanceData = { accruedInterest: "50000", totalBalance: "500000" }
    const result = computeReceiptAllocation("100000", balanceData)
    expect(Number(result.outstandingBalanceAfter)).toBeLessThan(Number(balanceData.totalBalance))
  })

  it("outstandingBalanceAfter equals principalBalanceAfter (both are the post-payment balance)", () => {
    const result = computeReceiptAllocation("200000", {
      accruedInterest: "80000",
      totalBalance: "1080000",
    })
    expect(result.outstandingBalanceAfter).toBe(result.principalBalanceAfter)
  })

  // --- Interest-first allocation ---

  it("interest portion is capped at accrued interest (does not exceed it)", () => {
    const result = computeReceiptAllocation("300000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.interestPortion).toBe("100000")
    expect(result.principalPortion).toBe("200000")
  })

  it("when payment is less than accrued interest, entire payment goes to interest", () => {
    const result = computeReceiptAllocation("50000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.interestPortion).toBe("50000")
    expect(result.principalPortion).toBe("0")
    expect(result.outstandingBalanceAfter).toBe("1050000")
  })

  it("when payment equals accrued interest, principal portion is zero", () => {
    const result = computeReceiptAllocation("100000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.interestPortion).toBe("100000")
    expect(result.principalPortion).toBe("0")
    expect(result.outstandingBalanceAfter).toBe("1000000")
  })

  it("when accrued interest is zero, entire payment goes to principal", () => {
    const result = computeReceiptAllocation("200000", {
      accruedInterest: "0",
      totalBalance: "1000000",
    })
    expect(result.interestPortion).toBe("0")
    expect(result.principalPortion).toBe("200000")
    expect(result.outstandingBalanceAfter).toBe("800000")
  })

  // --- Balance clamping at zero ---

  it("balance after is clamped at zero when payment exceeds total balance", () => {
    const result = computeReceiptAllocation("1500000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.outstandingBalanceAfter).toBe("0")
    expect(result.principalBalanceAfter).toBe("0")
    // Interest portion is still capped at accrued
    expect(result.interestPortion).toBe("100000")
    // Principal portion absorbs the rest (even if overpaying)
    expect(result.principalPortion).toBe("1400000")
  })

  it("payment exactly equal to total balance results in zero balance", () => {
    const result = computeReceiptAllocation("1100000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.outstandingBalanceAfter).toBe("0")
    expect(result.principalBalanceAfter).toBe("0")
    expect(result.interestPortion).toBe("100000")
    expect(result.principalPortion).toBe("1000000")
  })

  // --- Null / missing balance data ---

  it("handles null balanceData by treating all values as zero", () => {
    const result = computeReceiptAllocation("100000", null)
    expect(result.interestPortion).toBe("0")
    expect(result.principalPortion).toBe("100000")
    expect(result.outstandingBalanceAfter).toBe("0")
    expect(result.principalBalanceAfter).toBe("0")
  })

  // --- Realistic scenarios ---

  it("typical partial payment: 150k against 1.1M total (100k interest + 1M principal)", () => {
    const result = computeReceiptAllocation("150000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.interestPortion).toBe("100000")
    expect(result.principalPortion).toBe("50000")
    expect(result.principalBalanceAfter).toBe("950000")
    expect(result.outstandingBalanceAfter).toBe("950000")
  })

  it("small payment of 1000 against large balance", () => {
    const result = computeReceiptAllocation("1000", {
      accruedInterest: "100000",
      totalBalance: "1100000",
    })
    expect(result.interestPortion).toBe("1000")
    expect(result.principalPortion).toBe("0")
    expect(result.outstandingBalanceAfter).toBe("1099000")
  })

  it("full payoff payment: customer pays entire outstanding", () => {
    const result = computeReceiptAllocation("550000", {
      accruedInterest: "50000",
      totalBalance: "550000",
    })
    expect(result.interestPortion).toBe("50000")
    expect(result.principalPortion).toBe("500000")
    expect(result.outstandingBalanceAfter).toBe("0")
    expect(result.principalBalanceAfter).toBe("0")
  })

  // --- Property: balance identity ---

  it("interestPortion + principalPortion always equals paymentAmount (when not overpaying)", () => {
    const scenarios = [
      { payment: "150000", accrued: "100000", total: "1100000" },
      { payment: "50000", accrued: "100000", total: "1100000" },
      { payment: "100000", accrued: "100000", total: "1100000" },
      { payment: "1000", accrued: "0", total: "500000" },
      { payment: "500000", accrued: "50000", total: "550000" },
    ]

    for (const { payment, accrued, total } of scenarios) {
      const result = computeReceiptAllocation(payment, {
        accruedInterest: accrued,
        totalBalance: total,
      })
      const sum = Number(result.interestPortion) + Number(result.principalPortion)
      expect(sum).toBe(Number(payment))
    }
  })

  it("outstandingBalanceAfter equals totalBalance minus paymentAmount for non-overpayment", () => {
    const scenarios = [
      { payment: "150000", total: "1100000", expected: "950000" },
      { payment: "50000", total: "1100000", expected: "1050000" },
      { payment: "1000", total: "500000", expected: "499000" },
      { payment: "550000", total: "550000", expected: "0" },
    ]

    for (const { payment, total, expected } of scenarios) {
      const result = computeReceiptAllocation(payment, {
        accruedInterest: "100000",
        totalBalance: total,
      })
      expect(result.outstandingBalanceAfter).toBe(expected)
    }
  })

  // --- Regression: the exact bug scenario ---

  it("REGRESSION: receipt balance must reflect post-payment state, not pre-payment state", () => {
    // Before the fix, the code had:
    //   outstandingBalanceAfter: totalBefore.toFixed(0)  // BUG!
    // After the fix:
    //   outstandingBalanceAfter: balanceAfter.toFixed(0)  // CORRECT

    const totalBalance = "1100000"
    const paymentAmount = "150000"
    const result = computeReceiptAllocation(paymentAmount, {
      accruedInterest: "100000",
      totalBalance,
    })

    // The buggy version would return totalBalance (1100000) here
    // The correct version returns totalBalance - paymentAmount (950000)
    expect(result.outstandingBalanceAfter).toBe("950000")

    // Additional guard: the receipt balance must be strictly less
    // than the pre-payment total whenever a positive payment is made
    expect(Number(result.outstandingBalanceAfter)).toBeLessThan(Number(totalBalance))
  })
})
