import { describe, it, expect } from "vitest"
import type { LoanListEntry } from "@/types/loan"
import type { PaymentWithCustomer } from "@/types/payment"
import {
  getBand,
  recencyWeight,
  sizeWeight,
  combinedWeights,
  scoreTimeliness,
  scoreCompletion,
  scoreHistory,
  scorePaydown,
  scorePenalties,
  calculateCreditScore,
} from "../credit-score"

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeLoan(overrides: Partial<LoanListEntry> & { id: string; customerId: string }): LoanListEntry {
  return {
    principalAmount: "1000000",
    issuanceFee: "50000",
    interestRate: "0.1000",
    minInterestDays: 30,
    startDate: new Date("2026-01-01"),
    status: "active",
    interestRateOverride: null,
    minPeriodOverride: null,
    issuedBy: "officer1",
    disbursementSource: "cash",
    subLocationId: null,
    loanType: "perpetual",
    termMonths: null,
    penaltyMultiplier: "0.1000",
    penaltyWaived: false,
    penaltyWaivedBy: null,
    penaltyWaivedAt: null,
    rolledOverFrom: null,
    rolloverAmount: null,
    backdatedFrom: null,
    backdatedBy: null,
    backdatedAt: null,
    backdateNote: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    customerName: "Test Customer",
    customerContact: "0700000000",
    daysOverdue: 0,
    outstandingBalance: "500000",
    dailyRate: "3333",
    lastPaymentDate: null,
    unpaidInterest: "0",
    ...overrides,
  } as LoanListEntry
}

function makePayment(overrides: Partial<PaymentWithCustomer> & { id: string; loanId: string }): PaymentWithCustomer {
  return {
    customerId: "cust1",
    customerName: "Test Customer",
    paymentDate: new Date("2026-02-01"),
    amount: "100000",
    interestPortion: "50000",
    principalPortion: "50000",
    principalBalanceAfter: "950000",
    outstandingBalance: "950000",
    recordedBy: "officer1",
    recorderName: "Officer",
    depositLocation: "cash",
    createdAt: new Date("2026-02-01"),
    ...overrides,
  } as PaymentWithCustomer
}

// ---------------------------------------------------------------------------
// getBand
// ---------------------------------------------------------------------------

describe("getBand", () => {
  it("returns Excellent for score >= 800", () => {
    expect(getBand(800).label).toBe("Excellent")
    expect(getBand(850).label).toBe("Excellent")
  })

  it("returns Very Good for score 740-799", () => {
    expect(getBand(740).label).toBe("Very Good")
    expect(getBand(799).label).toBe("Very Good")
  })

  it("returns Good for score 670-739", () => {
    expect(getBand(670).label).toBe("Good")
    expect(getBand(739).label).toBe("Good")
  })

  it("returns Fair for score 580-669", () => {
    expect(getBand(580).label).toBe("Fair")
    expect(getBand(669).label).toBe("Fair")
  })

  it("returns Poor for score 450-579", () => {
    expect(getBand(450).label).toBe("Poor")
    expect(getBand(579).label).toBe("Poor")
  })

  it("returns Very Poor for score < 450", () => {
    expect(getBand(300).label).toBe("Very Poor")
    expect(getBand(449).label).toBe("Very Poor")
  })
})

// ---------------------------------------------------------------------------
// recencyWeight
// ---------------------------------------------------------------------------

describe("recencyWeight", () => {
  it("returns 1.0 for today", () => {
    const now = new Date("2026-04-15")
    expect(recencyWeight(now, now)).toBe(1.0)
  })

  it("returns approximately 0.37 for 1 year ago", () => {
    const now = new Date("2026-04-15")
    const oneYearAgo = new Date("2025-04-15")
    const w = recencyWeight(oneYearAgo, now)
    expect(w).toBeCloseTo(Math.exp(-1), 2)
  })

  it("older loans have smaller weight than recent ones", () => {
    const now = new Date("2026-04-15")
    const recent = new Date("2026-03-15")
    const old = new Date("2024-04-15")
    expect(recencyWeight(recent, now)).toBeGreaterThan(recencyWeight(old, now))
  })
})

// ---------------------------------------------------------------------------
// sizeWeight
// ---------------------------------------------------------------------------

describe("sizeWeight", () => {
  it("returns 1.0 when amount equals max", () => {
    expect(sizeWeight("1000000", "1000000")).toBe(1.0)
  })

  it("returns 0.5 when amount is half of max", () => {
    expect(sizeWeight("500000", "1000000")).toBe(0.5)
  })

  it("returns 1.0 when max is zero", () => {
    expect(sizeWeight("0", "0")).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// combinedWeights
// ---------------------------------------------------------------------------

describe("combinedWeights", () => {
  it("returns empty array for no loans", () => {
    expect(combinedWeights([], new Date())).toEqual([])
  })

  it("returns [1.0] for a single loan", () => {
    const weights = combinedWeights(
      [{ startDate: new Date("2026-01-01"), principalAmount: "1000000" }],
      new Date("2026-04-15"),
    )
    expect(weights).toEqual([1.0])
  })

  it("weights sum to 1", () => {
    const loans = [
      { startDate: new Date("2026-01-01"), principalAmount: "1000000" },
      { startDate: new Date("2025-06-01"), principalAmount: "500000" },
      { startDate: new Date("2024-01-01"), principalAmount: "2000000" },
    ]
    const weights = combinedWeights(loans, new Date("2026-04-15"))
    const sum = weights.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 10)
  })

  it("recent + large loan has higher weight than old + small", () => {
    const loans = [
      { startDate: new Date("2026-04-01"), principalAmount: "2000000" },
      { startDate: new Date("2023-01-01"), principalAmount: "100000" },
    ]
    const weights = combinedWeights(loans, new Date("2026-04-15"))
    expect(weights[0]).toBeGreaterThan(weights[1])
  })
})

// ---------------------------------------------------------------------------
// scoreTimeliness
// ---------------------------------------------------------------------------

describe("scoreTimeliness", () => {
  const loan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "active" }

  it("returns 1.0 for payments every 25 days", () => {
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-20") },
      { paymentDate: new Date("2026-03-17") },
    ]
    // Pin now to just after last payment so trailing gap is small
    const now = new Date("2026-03-20")
    expect(scoreTimeliness(loan, payments, now)).toBe(1.0)
  })

  it("returns 1.0 for payments every 30 days", () => {
    const payments = [
      { paymentDate: new Date("2026-01-31") },
      { paymentDate: new Date("2026-03-02") },
    ]
    const now = new Date("2026-03-05")
    expect(scoreTimeliness(loan, payments, now)).toBe(1.0)
  })

  it("returns less than 1.0 for 60-day gaps", () => {
    const payments = [
      { paymentDate: new Date("2026-03-02") }, // 60 days from start
    ]
    const now = new Date("2026-03-03")
    expect(scoreTimeliness(loan, payments, now)).toBeLessThan(1.0)
  })

  it("returns less than 0.5 for 90+ day gaps", () => {
    const payments = [
      { paymentDate: new Date("2026-04-01") }, // 90 days from start
    ]
    // Set now 90 days after last payment so trailing gap also 90 days
    const now = new Date("2026-06-30")
    expect(scoreTimeliness(loan, payments, now)).toBeLessThan(0.5)
  })

  it("returns 0.5 for no payments", () => {
    expect(scoreTimeliness(loan, [])).toBe(0.5)
  })

  it("penalizes active loan with long trailing gap since last payment", () => {
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-20") },
    ]
    // 120 days after last payment
    const now = new Date("2026-06-20")
    const score = scoreTimeliness(loan, payments, now)
    expect(score).toBeLessThan(1.0)
  })

  it("borrower who stopped paying 120 days ago scores much lower than one still paying monthly", () => {
    // Both borrowers started same loan and made 2 on-time payments
    const commonPayments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-25") },
    ]

    // Borrower A: stopped paying after February, now is 120 days later
    const now = new Date("2026-06-25")
    const stoppedScore = scoreTimeliness(loan, commonPayments, now)

    // Borrower B: kept paying monthly through June
    const keepPayingPayments = [
      ...commonPayments,
      { paymentDate: new Date("2026-03-27") },
      { paymentDate: new Date("2026-04-26") },
      { paymentDate: new Date("2026-05-26") },
      { paymentDate: new Date("2026-06-22") },
    ]
    const keepPayingScore = scoreTimeliness(loan, keepPayingPayments, now)

    // The borrower still paying should score perfect (all gaps ~30 days)
    expect(keepPayingScore).toBe(1.0)
    // The borrower who stopped should be significantly penalized
    // Gaps: [25, 30, 120] => avg 58.3 days, formula gives ~0.54
    expect(stoppedScore).toBeLessThan(0.7)
    // The gap between the two should be substantial, not negligible
    expect(keepPayingScore - stoppedScore).toBeGreaterThan(0.25)
  })

  it("does not add trailing gap for fully_paid loans", () => {
    const paidLoan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "fully_paid" }
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-20") },
    ]
    // Even with now far in the future, fully_paid should not get trailing gap
    const farFuture = new Date("2027-01-01")
    const nearPast = new Date("2026-02-21")
    expect(scoreTimeliness(paidLoan, payments, farFuture)).toBe(scoreTimeliness(paidLoan, payments, nearPast))
  })

  it("fully_paid loan is never penalized by trailing gap regardless of time elapsed", () => {
    const paidLoan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "fully_paid" }
    // Borrower paid on time then paid off the loan
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-25") },
      { paymentDate: new Date("2026-03-27") },
    ]
    // Score measured right after last payment
    const justAfter = new Date("2026-03-28")
    // Score measured a year later — should be identical
    const yearLater = new Date("2027-03-28")
    const scoreAfter = scoreTimeliness(paidLoan, payments, justAfter)
    const scoreLater = scoreTimeliness(paidLoan, payments, yearLater)
    expect(scoreAfter).toBe(1.0)
    expect(scoreLater).toBe(1.0)
  })

  it("active loan with last payment yesterday scores similarly to between-payment gaps", () => {
    // Borrower paying regularly, last payment was yesterday
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-25") },
      { paymentDate: new Date("2026-03-27") },
    ]
    // "now" is just 1 day after the last payment — trailing gap is negligible
    const now = new Date("2026-03-28")
    const score = scoreTimeliness(loan, payments, now)
    // All between-payment gaps are ~30 days, trailing gap is 1 day
    // Average should still be well within the 30-day threshold
    expect(score).toBe(1.0)
  })

  it("edge case: active loan with only 1 payment made long ago", () => {
    // Borrower made a single payment 25 days after start, then disappeared
    const payments = [
      { paymentDate: new Date("2026-01-26") }, // 25 days from start
    ]
    // Now is 150 days after that single payment
    const now = new Date("2026-06-25")
    const score = scoreTimeliness(loan, payments, now)
    // Gaps: [25 days from start to payment, 150 days trailing]
    // Average = (25 + 150) / 2 = 87.5 days => well above 30, severe penalty
    expect(score).toBeLessThan(0.5)
  })
})

// ---------------------------------------------------------------------------
// Serialized date safety (server actions return ISO strings, not Date objects)
// ---------------------------------------------------------------------------

describe("credit score functions handle serialized date strings", () => {
  it("recencyWeight works with ISO string dates", () => {
    const result = recencyWeight("2026-01-01T00:00:00.000Z" as unknown as Date, new Date("2026-04-01"))
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(1)
    expect(Number.isNaN(result)).toBe(false)
  })

  it("scoreTimeliness works with ISO string dates", () => {
    const loan = { startDate: "2026-01-01T00:00:00.000Z" as unknown as Date, principalAmount: "1000000", status: "active" }
    const payments = [
      { paymentDate: "2026-02-01T00:00:00.000Z" as unknown as Date },
      { paymentDate: "2026-03-01T00:00:00.000Z" as unknown as Date },
    ]
    const score = scoreTimeliness(loan, payments, new Date("2026-03-15"))
    expect(Number.isNaN(score)).toBe(false)
    expect(score).toBeGreaterThan(0)
  })

  it("scorePaydown works with ISO string dates", () => {
    const loan = { status: "fully_paid", startDate: "2026-01-01T00:00:00.000Z" as unknown as Date, minInterestDays: 30, principalAmount: "1000000" }
    const score = scorePaydown(loan, "0", "2026-01-20T00:00:00.000Z" as unknown as Date)
    expect(Number.isNaN(score)).toBe(false)
    expect(score).toBeGreaterThan(0)
  })

  it("combinedWeights works with ISO string dates", () => {
    const loans = [
      { startDate: "2026-01-01T00:00:00.000Z" as unknown as Date, principalAmount: "1000000" },
      { startDate: "2026-03-01T00:00:00.000Z" as unknown as Date, principalAmount: "500000" },
    ]
    const weights = combinedWeights(loans, new Date("2026-04-01"))
    expect(weights).toHaveLength(2)
    expect(weights.every((w) => !Number.isNaN(w))).toBe(true)
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0)
  })
})

// ---------------------------------------------------------------------------
// scoreCompletion
// ---------------------------------------------------------------------------

describe("scoreCompletion", () => {
  it("returns 1.0 for fully_paid", () => {
    expect(scoreCompletion("fully_paid")).toBe(1.0)
  })

  it("returns 0.5 for active", () => {
    expect(scoreCompletion("active")).toBe(0.5)
  })

  it("returns 0.5 for rolled_over", () => {
    expect(scoreCompletion("rolled_over")).toBe(0.5)
  })

  it("returns 0.1 for settled_with_collateral", () => {
    expect(scoreCompletion("settled_with_collateral")).toBe(0.1)
  })
})

// ---------------------------------------------------------------------------
// scoreHistory
// ---------------------------------------------------------------------------

describe("scoreHistory", () => {
  it("returns 0.3 for 1 loan", () => {
    expect(scoreHistory(1)).toBe(0.3)
  })

  it("returns 0.5 for 2 loans", () => {
    expect(scoreHistory(2)).toBe(0.5)
  })

  it("returns 0.7 for 3 loans", () => {
    expect(scoreHistory(3)).toBe(0.7)
  })

  it("returns 0.85 for 4 loans", () => {
    expect(scoreHistory(4)).toBe(0.85)
  })

  it("returns 1.0 for 5+ loans", () => {
    expect(scoreHistory(5)).toBe(1.0)
    expect(scoreHistory(10)).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// scorePaydown
// ---------------------------------------------------------------------------

describe("scorePaydown", () => {
  it("returns 1.0 for early payoff (within 70% of minInterestDays)", () => {
    const loan = { status: "fully_paid", startDate: new Date("2026-01-01"), minInterestDays: 30, principalAmount: "1000000" }
    const lastPayment = new Date("2026-01-20") // 19 days < 21 (30*0.7)
    expect(scorePaydown(loan, "0", lastPayment)).toBe(1.0)
  })

  it("returns 0.7 for on-time payoff (within 1.5x minInterestDays)", () => {
    const loan = { status: "fully_paid", startDate: new Date("2026-01-01"), minInterestDays: 30, principalAmount: "1000000" }
    const lastPayment = new Date("2026-02-10") // 40 days, within 45 (30*1.5)
    expect(scorePaydown(loan, "0", lastPayment)).toBe(0.7)
  })

  it("returns paid ratio for active loan with 50% paid", () => {
    const loan = { status: "active", startDate: new Date("2026-01-01"), minInterestDays: 30, principalAmount: "1000000" }
    expect(scorePaydown(loan, "500000", null)).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// scorePenalties
// ---------------------------------------------------------------------------

describe("scorePenalties", () => {
  it("returns 1.0 when no penalty", () => {
    expect(scorePenalties(false)).toBe(1.0)
  })

  it("returns 0.0 when had penalty", () => {
    expect(scorePenalties(true)).toBe(0.0)
  })
})

// ---------------------------------------------------------------------------
// calculateCreditScore (integration)
// ---------------------------------------------------------------------------

describe("calculateCreditScore", () => {
  it("returns null score for no loans", () => {
    const result = calculateCreditScore([], [])
    expect(result.score).toBeNull()
    expect(result.label).toBe("No loan history")
  })

  it("returns null score when all loans are pending", () => {
    const loans = [
      makeLoan({ id: "loan1", customerId: "cust1", status: "pending" }),
    ]
    const result = calculateCreditScore(loans, [])
    expect(result.score).toBeNull()
  })

  it("returns high score for a good customer", () => {
    const loans = [
      makeLoan({
        id: "loan1",
        customerId: "cust1",
        status: "fully_paid",
        outstandingBalance: "0",
        lastPaymentDate: new Date("2026-01-20"),
        daysOverdue: 0,
        startDate: new Date("2026-01-01"),
      }),
      makeLoan({
        id: "loan2",
        customerId: "cust1",
        status: "fully_paid",
        outstandingBalance: "0",
        lastPaymentDate: new Date("2026-02-20"),
        daysOverdue: 0,
        startDate: new Date("2026-02-01"),
      }),
      makeLoan({
        id: "loan3",
        customerId: "cust1",
        status: "fully_paid",
        outstandingBalance: "0",
        lastPaymentDate: new Date("2026-03-20"),
        daysOverdue: 0,
        startDate: new Date("2026-03-01"),
      }),
      makeLoan({
        id: "loan4",
        customerId: "cust1",
        status: "fully_paid",
        outstandingBalance: "0",
        lastPaymentDate: new Date("2026-04-01"),
        daysOverdue: 0,
        startDate: new Date("2026-03-15"),
      }),
      makeLoan({
        id: "loan5",
        customerId: "cust1",
        status: "fully_paid",
        outstandingBalance: "0",
        lastPaymentDate: new Date("2026-04-10"),
        daysOverdue: 0,
        startDate: new Date("2026-04-01"),
      }),
    ]
    const payments = loans.map((l, i) =>
      makePayment({
        id: `pay${i}`,
        loanId: l.id,
        paymentDate: new Date(l.startDate.getTime() + 15 * 24 * 60 * 60 * 1000),
      }),
    )
    const result = calculateCreditScore(loans, payments)
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeGreaterThanOrEqual(740)
  })

  it("returns low score for collateral settlement", () => {
    const loans = [
      makeLoan({
        id: "loan1",
        customerId: "cust1",
        status: "settled_with_collateral",
        outstandingBalance: "900000",
        daysOverdue: 90,
        startDate: new Date("2025-01-01"),
      }),
    ]
    const result = calculateCreditScore(loans, [])
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeLessThan(580)
  })

  it("returns score in range 300-850", () => {
    const loans = [
      makeLoan({ id: "loan1", customerId: "cust1", status: "active" }),
    ]
    const result = calculateCreditScore(loans, [])
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeGreaterThanOrEqual(300)
    expect(result.score!).toBeLessThanOrEqual(850)
  })

  it("rolled_over scores same as active for completion", () => {
    const baseLoan = {
      customerId: "cust1",
      outstandingBalance: "500000",
      daysOverdue: 0,
      startDate: new Date("2026-01-01"),
      lastPaymentDate: null,
    }
    const activeLoan = makeLoan({ id: "loan1", ...baseLoan, status: "active" })
    const rolledLoan = makeLoan({ id: "loan2", ...baseLoan, status: "rolled_over" })

    const activeResult = calculateCreditScore([activeLoan], [])
    const rolledResult = calculateCreditScore([rolledLoan], [])

    expect(activeResult.score).toBe(rolledResult.score)
  })
})
