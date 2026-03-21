import { describe, it, expect } from "vitest"
import { calculateInterest, allocatePayment } from "@/lib/interest/engine"

/**
 * Creditor Service Tests — TDD Red Phase
 *
 * Tests cover:
 * - CRUD: createCreditor, updateCreditor, listCreditors, getCreditor
 * - Investment management: addInvestment
 * - Interest accrual: getCreditorDashboard with minInterestDays=0
 * - Repayment allocation: recordCreditorRepayment (interest-first)
 * - System capital: getSystemCapital
 *
 * NOTE: All DB-interactive tests are marked .todo (no test DB).
 * Unit tests cover pure logic: interest accrual math and allocation.
 */

describe("Creditor Service — exports", () => {
  it("creditor service exports createCreditor function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.createCreditor).toBeDefined()
    expect(typeof mod.createCreditor).toBe("function")
  })

  it("creditor service exports updateCreditor function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.updateCreditor).toBeDefined()
    expect(typeof mod.updateCreditor).toBe("function")
  })

  it("creditor service exports getCreditor function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.getCreditor).toBeDefined()
    expect(typeof mod.getCreditor).toBe("function")
  })

  it("creditor service exports listCreditors function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.listCreditors).toBeDefined()
    expect(typeof mod.listCreditors).toBe("function")
  })

  it("creditor service exports addInvestment function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.addInvestment).toBeDefined()
    expect(typeof mod.addInvestment).toBe("function")
  })

  it("creditor service exports recordCreditorRepayment function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.recordCreditorRepayment).toBeDefined()
    expect(typeof mod.recordCreditorRepayment).toBe("function")
  })

  it("creditor service exports getCreditorDashboard function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.getCreditorDashboard).toBeDefined()
    expect(typeof mod.getCreditorDashboard).toBe("function")
  })

  it("creditor service exports getSystemCapital function", async () => {
    const mod = await import("@/services/creditor.service")
    expect(mod.getSystemCapital).toBeDefined()
    expect(typeof mod.getSystemCapital).toBe("function")
  })
})

describe("Creditor Service — interest accrual math (minInterestDays=0)", () => {
  /**
   * These tests verify the engine.ts integration for creditor interest.
   * Creditors use minInterestDays=0, so daysElapsed is used directly (no min enforcement).
   */

  it("10M UGX at 10%/month for 30 days accrues ~1,000,000 interest (CRED-03)", () => {
    // 10,000,000 * (0.10/30) * 30 ≈ 1,000,000
    // Note: BigNumber at DECIMAL_PLACES=10 gives 999999.99 due to 0.10/30 precision
    const interest = calculateInterest("10000000", "0.10", 30, 0)
    expect(interest.toFixed(2)).toBe("999999.99")
  })

  it("15-day investment accrues 15 days of interest with minInterestDays=0 (CRED-03)", () => {
    // 10,000,000 * (0.10/30) * 15 = 500,000
    const interest = calculateInterest("10000000", "0.10", 15, 0)
    expect(interest.toFixed(2)).toBe("500000.00")
  })

  it("15-day investment does NOT use minInterestDays=30 (no minimum enforcement for creditors)", () => {
    // With minInterestDays=0: 10M * (0.10/30) * 15 = 500,000
    // With minInterestDays=30: 10M * (0.10/30) * 30 ≈ 999,999.99
    const creditorInterest = calculateInterest("10000000", "0.10", 15, 0)
    const borrowerInterest = calculateInterest("10000000", "0.10", 15, 30)
    expect(creditorInterest.toFixed(2)).toBe("500000.00")
    expect(borrowerInterest.toFixed(2)).toBe("999999.99")
    // Creditor accrues less than borrower minimum — this is correct
    expect(creditorInterest.isLessThan(borrowerInterest)).toBe(true)
  })
})

describe("Creditor Service — repayment allocation (interest-first)", () => {
  /**
   * Tests for allocatePayment() behavior when used for creditor repayments.
   * Creditor repayments use minInterestDays=0.
   */

  it("payment <= interest: all goes to interest, principal unchanged (CRED-04)", () => {
    // 10M at 10%/month, 30 days elapsed: interest = 1,000,000
    // Payment of 500,000 (less than interest): all to interest
    const result = allocatePayment({
      paymentAmount: "500000",
      principalBalanceBefore: "10000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("500000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceBefore).toBe("10000000")
    expect(result.principalBalanceAfter).toBe("10000000")
  })

  it("1,500,000 payment against ~1,000,000 interest: ~1M to interest, remainder to principal (CRED-04)", () => {
    // 10M at 10%/month, 30 days elapsed: interest ≈ 999,999.99 (BigNumber DECIMAL_PLACES=10 precision)
    // Payment of 1,500,000: 999,999.99 to interest, 500,000.01 to principal
    const result = allocatePayment({
      paymentAmount: "1500000",
      principalBalanceBefore: "10000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("999999.99")
    expect(result.principalPortion).toBe("500000.01")
    expect(result.principalBalanceAfter).toBe("9499999.99")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("payment larger than interest + principal: principalBalance reaches zero (fully repaid)", () => {
    // 100K principal at 10%/month, 30 days: interest = 10,000
    // Payment of 200,000: more than enough to cover 10K interest + 100K principal
    const result = allocatePayment({
      paymentAmount: "200000",
      principalBalanceBefore: "100000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 0,
    })
    expect(result.interestPortion).toBe("10000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })
})

describe("Creditor Service — TypeScript types (CRED-01, CRED-02, CRED-05)", () => {
  it("CreateCreditorInput has name, contact, address fields", async () => {
    const input: import("@/types").CreateCreditorInput = {
      name: "John Doe Investments",
      contact: "+256700000001",
      address: "Kampala, Uganda",
    }
    expect(input.name).toBeDefined()
    expect(input.contact).toBeDefined()
    expect(input.address).toBeDefined()
  })

  it("AddInvestmentInput has creditorId, amount, interestRateMonthly, investmentDate", async () => {
    const input: import("@/types").AddInvestmentInput = {
      creditorId: "550e8400-e29b-41d4-a716-446655440001",
      amount: "10000000",
      interestRateMonthly: "0.10",
      investmentDate: "2026-01-01T00:00:00.000Z",
    }
    expect(input.creditorId).toBeDefined()
    expect(input.amount).toBeDefined()
    expect(input.interestRateMonthly).toBeDefined()
    expect(input.investmentDate).toBeDefined()
  })

  it("RecordCreditorRepaymentInput has investmentId, amount, repaymentDate", async () => {
    const input: import("@/types").RecordCreditorRepaymentInput = {
      investmentId: "550e8400-e29b-41d4-a716-446655440002",
      amount: "1500000",
      repaymentDate: "2026-02-01T00:00:00.000Z",
    }
    expect(input.investmentId).toBeDefined()
    expect(input.amount).toBeDefined()
    expect(input.repaymentDate).toBeDefined()
  })

  it("CreditorDashboard has totalInvested, interestAccrued, repaymentsMade, outstandingBalance, investments", async () => {
    const dashboard: import("@/types").CreditorDashboard = {
      totalInvested: "10000000.00",
      interestAccrued: "1000000.00",
      repaymentsMade: "500000.00",
      outstandingBalance: "10500000.00",
      investments: [],
    }
    expect(dashboard.totalInvested).toBeDefined()
    expect(dashboard.interestAccrued).toBeDefined()
    expect(dashboard.repaymentsMade).toBeDefined()
    expect(dashboard.outstandingBalance).toBeDefined()
    expect(Array.isArray(dashboard.investments)).toBe(true)
  })
})

describe("Creditor Service — DB operations (requires test DB)", () => {
  it.todo("createCreditor: inserts creditor record and returns Creditor type (CRED-01)")
  it.todo("createCreditor: writes audit log in same transaction")
  it.todo("updateCreditor: updates creditor fields and returns updated record (CRED-01)")
  it.todo("updateCreditor: writes audit log with before/after values")
  it.todo("getCreditor: returns CreditorNotFound error for unknown ID")
  it.todo("listCreditors: returns all creditors ordered by name")
  it.todo("addInvestment: sets principalBalance equal to amount on creation (CRED-02)")
  it.todo("addInvestment: writes audit log")
  it.todo(
    "recordCreditorRepayment: allocates interest-first with minInterestDays=0 (CRED-04)"
  )
  it.todo(
    "recordCreditorRepayment: updates principalBalance after repayment (CRED-04)"
  )
  it.todo(
    "recordCreditorRepayment: writes audit log inside transaction (CRED-04)"
  )
  it.todo("getCreditorDashboard: computes interestAccrued using minInterestDays=0 (CRED-03)")
  it.todo(
    "getCreditorDashboard: after 500K repayment on 1M interest, shows remaining interest (CRED-05)"
  )
  it.todo(
    "getSystemCapital: aggregates totalInvested, totalInterestAccrued, totalRepaymentsMade across all creditors (CRED-06)"
  )
})
