# Customer Credit Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a FICO-style (300–850) credit score badge to customer detail pages and the new loan form, computed client-side from loan/payment history.

**Architecture:** Pure utility function `calculateCreditScore()` computes the score from loan and payment data already available via TanStack DB collections. A `<CreditScoreBadge>` component renders the score, ordinal label, color, and info popover. No server-side changes needed.

**Tech Stack:** TypeScript, React, Vitest, shadcn/ui (Popover, Badge), TanStack React DB, Tailwind CSS

---

### Task 1: Credit Score Calculation — Types and Constants

**Files:**
- Create: `src/lib/credit-score.ts`
- Test: `src/lib/__tests__/credit-score.test.ts`

- [ ] **Step 1: Create the credit score module with types and constants**

```ts
// src/lib/credit-score.ts

import type { LoanListEntry } from "@/types/loan"
import type { PaymentWithCustomer } from "@/types/payment"

export interface CreditScoreResult {
  /** Numeric score 300–850, or null if no loan history */
  score: number | null
  /** Ordinal label: "Excellent", "Very Good", etc. */
  label: string
  /** Tailwind color class for the badge */
  color: string
}

export interface CreditScoreBreakdown {
  timeliness: number    // 0–1
  completion: number    // 0–1
  history: number       // 0–1
  paydown: number       // 0–1
  penalties: number     // 0–1
  composite: number     // 0–1
  finalScore: number | null
}

const SCORE_MIN = 300
const SCORE_MAX = 850
const SCORE_RANGE = SCORE_MAX - SCORE_MIN // 550

const WEIGHTS = {
  timeliness: 0.35,
  completion: 0.25,
  history: 0.20,
  paydown: 0.10,
  penalties: 0.10,
} as const

interface ScoreBand {
  min: number
  label: string
  color: string
}

const SCORE_BANDS: ScoreBand[] = [
  { min: 800, label: "Excellent", color: "text-green-700 bg-green-100 border-green-300 dark:text-green-400 dark:bg-green-950 dark:border-green-800" },
  { min: 740, label: "Very Good", color: "text-emerald-700 bg-emerald-100 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800" },
  { min: 670, label: "Good", color: "text-blue-700 bg-blue-100 border-blue-300 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800" },
  { min: 580, label: "Fair", color: "text-amber-700 bg-amber-100 border-amber-300 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800" },
  { min: 450, label: "Poor", color: "text-orange-700 bg-orange-100 border-orange-300 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800" },
  { min: 0,   label: "Very Poor", color: "text-red-700 bg-red-100 border-red-300 dark:text-red-400 dark:bg-red-950 dark:border-red-800" },
]

export function getBand(score: number): { label: string; color: string } {
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return { label: band.label, color: band.color }
  }
  return { label: "Very Poor", color: SCORE_BANDS[SCORE_BANDS.length - 1].color }
}
```

- [ ] **Step 2: Write tests for getBand**

```ts
// src/lib/__tests__/credit-score.test.ts

import { describe, it, expect } from "vitest"
import { getBand } from "../credit-score"

describe("getBand", () => {
  it("returns Excellent for 800+", () => {
    expect(getBand(800).label).toBe("Excellent")
    expect(getBand(850).label).toBe("Excellent")
  })

  it("returns Very Good for 740–799", () => {
    expect(getBand(740).label).toBe("Very Good")
    expect(getBand(799).label).toBe("Very Good")
  })

  it("returns Good for 670–739", () => {
    expect(getBand(670).label).toBe("Good")
    expect(getBand(739).label).toBe("Good")
  })

  it("returns Fair for 580–669", () => {
    expect(getBand(580).label).toBe("Fair")
    expect(getBand(669).label).toBe("Fair")
  })

  it("returns Poor for 450–579", () => {
    expect(getBand(450).label).toBe("Poor")
    expect(getBand(579).label).toBe("Poor")
  })

  it("returns Very Poor for 300–449", () => {
    expect(getBand(300).label).toBe("Very Poor")
    expect(getBand(449).label).toBe("Very Poor")
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/credit-score.ts src/lib/__tests__/credit-score.test.ts
git commit -m "feat(credit-score): add types, constants, and score band mapping"
```

---

### Task 2: Recency and Size Weighting Helpers

**Files:**
- Modify: `src/lib/credit-score.ts`
- Modify: `src/lib/__tests__/credit-score.test.ts`

- [ ] **Step 1: Write failing tests for weighting helpers**

Add to `src/lib/__tests__/credit-score.test.ts`:

```ts
import { getBand, recencyWeight, sizeWeight, combinedWeights } from "../credit-score"

describe("recencyWeight", () => {
  it("returns 1.0 for a loan from today", () => {
    const now = new Date()
    expect(recencyWeight(now, now)).toBeCloseTo(1.0, 2)
  })

  it("returns ~0.37 for a 1-year-old loan", () => {
    const now = new Date("2026-04-15")
    const oneYearAgo = new Date("2025-04-15")
    expect(recencyWeight(oneYearAgo, now)).toBeCloseTo(0.37, 1)
  })

  it("returns lower weight for older loans", () => {
    const now = new Date("2026-04-15")
    const recent = new Date("2026-01-15")    // 3 months
    const old = new Date("2024-04-15")       // 2 years
    expect(recencyWeight(recent, now)).toBeGreaterThan(recencyWeight(old, now))
  })
})

describe("sizeWeight", () => {
  it("returns 1.0 when loan is the max", () => {
    expect(sizeWeight("5000000", "5000000")).toBeCloseTo(1.0)
  })

  it("returns 0.5 when loan is half the max", () => {
    expect(sizeWeight("2500000", "5000000")).toBeCloseTo(0.5)
  })

  it("returns 1.0 when maxPrincipal is 0", () => {
    expect(sizeWeight("0", "0")).toBeCloseTo(1.0)
  })
})

describe("combinedWeights", () => {
  it("normalizes weights to sum to 1", () => {
    const loans = [
      { startDate: new Date("2026-04-01"), principalAmount: "1000000" },
      { startDate: new Date("2025-04-01"), principalAmount: "2000000" },
    ]
    const now = new Date("2026-04-15")
    const weights = combinedWeights(loans, now)
    const sum = weights.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 5)
  })

  it("gives more weight to recent, larger loans", () => {
    const loans = [
      { startDate: new Date("2026-04-01"), principalAmount: "5000000" },  // recent + large
      { startDate: new Date("2024-04-01"), principalAmount: "200000" },   // old + small
    ]
    const now = new Date("2026-04-15")
    const weights = combinedWeights(loans, now)
    expect(weights[0]).toBeGreaterThan(weights[1])
  })

  it("returns equal weights for single loan", () => {
    const loans = [{ startDate: new Date("2026-01-01"), principalAmount: "1000000" }]
    const weights = combinedWeights(loans, new Date("2026-04-15"))
    expect(weights).toEqual([1.0])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: FAIL — `recencyWeight`, `sizeWeight`, `combinedWeights` not exported

- [ ] **Step 3: Implement weighting helpers**

Add to `src/lib/credit-score.ts`:

```ts
/**
 * Exponential decay based on loan age: weight = e^(-age_in_days / 365)
 * A loan from today = 1.0, 1 year ago ≈ 0.37, 2 years ago ≈ 0.14
 */
export function recencyWeight(loanStartDate: Date, now: Date): number {
  const ageInDays = Math.max(0, (now.getTime() - loanStartDate.getTime()) / (1000 * 60 * 60 * 24))
  return Math.exp(-ageInDays / 365)
}

/**
 * Size weight: principalAmount / maxPrincipal across all loans.
 * Returns 1.0 if maxPrincipal is 0.
 */
export function sizeWeight(principalAmount: string, maxPrincipal: string): number {
  const max = parseFloat(maxPrincipal)
  if (max <= 0) return 1.0
  return parseFloat(principalAmount) / max
}

/**
 * Compute normalized combined weights (recency * size) for an array of loans.
 * Returns an array of weights that sum to 1.0.
 */
export function combinedWeights(
  loans: Array<{ startDate: Date; principalAmount: string }>,
  now: Date,
): number[] {
  if (loans.length === 0) return []
  const maxPrincipal = Math.max(...loans.map((l) => parseFloat(l.principalAmount))).toString()
  const raw = loans.map((l) => recencyWeight(l.startDate, now) * sizeWeight(l.principalAmount, maxPrincipal))
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum === 0) return loans.map(() => 1 / loans.length)
  return raw.map((w) => w / sum)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/credit-score.ts src/lib/__tests__/credit-score.test.ts
git commit -m "feat(credit-score): add recency and size weighting helpers"
```

---

### Task 3: Individual Scoring Factor Functions

**Files:**
- Modify: `src/lib/credit-score.ts`
- Modify: `src/lib/__tests__/credit-score.test.ts`

- [ ] **Step 1: Write failing tests for timeliness factor**

Add to `src/lib/__tests__/credit-score.test.ts`:

```ts
import {
  getBand, recencyWeight, sizeWeight, combinedWeights,
  scoreTimeliness, scoreCompletion, scoreHistory, scorePaydown, scorePenalties,
} from "../credit-score"

describe("scoreTimeliness", () => {
  const now = new Date("2026-04-15")

  it("returns 1.0 for payments every 25 days", () => {
    const loan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "fully_paid" as const }
    const payments = [
      { paymentDate: new Date("2026-01-26") },
      { paymentDate: new Date("2026-02-20") },
      { paymentDate: new Date("2026-03-17") },
    ]
    expect(scoreTimeliness(loan, payments)).toBeCloseTo(1.0, 1)
  })

  it("returns 1.0 for payments exactly every 30 days", () => {
    const loan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "active" as const }
    const payments = [
      { paymentDate: new Date("2026-01-31") },
      { paymentDate: new Date("2026-03-02") },
    ]
    expect(scoreTimeliness(loan, payments)).toBeCloseTo(1.0, 1)
  })

  it("returns lower score for 60-day average gap", () => {
    const loan = { startDate: new Date("2026-01-01"), principalAmount: "1000000", status: "active" as const }
    const payments = [
      { paymentDate: new Date("2026-03-02") }, // 60 days from start
    ]
    const score = scoreTimeliness(loan, payments)
    expect(score).toBeLessThan(1.0)
    expect(score).toBeGreaterThan(0)
  })

  it("returns low score for 90+ day gaps", () => {
    const loan = { startDate: new Date("2025-01-01"), principalAmount: "1000000", status: "active" as const }
    const payments = [
      { paymentDate: new Date("2025-04-01") }, // 90 days
    ]
    expect(scoreTimeliness(loan, payments)).toBeLessThan(0.5)
  })

  it("returns 0.5 for loans with no payments (neutral)", () => {
    const loan = { startDate: new Date("2026-04-01"), principalAmount: "1000000", status: "active" as const }
    expect(scoreTimeliness(loan, [])).toBeCloseTo(0.5, 1)
  })
})

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

describe("scoreHistory", () => {
  it("returns 0.3 for 1 loan", () => {
    expect(scoreHistory(1)).toBeCloseTo(0.3)
  })

  it("returns 0.5 for 2 loans", () => {
    expect(scoreHistory(2)).toBeCloseTo(0.5)
  })

  it("returns 0.7 for 3 loans", () => {
    expect(scoreHistory(3)).toBeCloseTo(0.7)
  })

  it("returns 0.85 for 4 loans", () => {
    expect(scoreHistory(4)).toBeCloseTo(0.85)
  })

  it("returns 1.0 for 5+ loans", () => {
    expect(scoreHistory(5)).toBeCloseTo(1.0)
    expect(scoreHistory(10)).toBeCloseTo(1.0)
  })
})

describe("scorePaydown", () => {
  it("returns 1.0 for fully paid loan faster than minInterestDays", () => {
    const loan = {
      status: "fully_paid" as const,
      startDate: new Date("2026-01-01"),
      minInterestDays: 30,
      principalAmount: "1000000",
    }
    const lastPaymentDate = new Date("2026-01-20") // 20 days, faster than 30
    expect(scorePaydown(loan, "0", lastPaymentDate)).toBeCloseTo(1.0, 1)
  })

  it("returns 0.7 for fully paid loan at expected pace", () => {
    const loan = {
      status: "fully_paid" as const,
      startDate: new Date("2026-01-01"),
      minInterestDays: 30,
      principalAmount: "1000000",
    }
    const lastPaymentDate = new Date("2026-01-31") // exactly 30 days
    expect(scorePaydown(loan, "0", lastPaymentDate)).toBeCloseTo(0.7, 1)
  })

  it("returns based on paydown ratio for active loans", () => {
    const loan = {
      status: "active" as const,
      startDate: new Date("2026-01-01"),
      minInterestDays: 30,
      principalAmount: "1000000",
    }
    // Outstanding 500k means 50% paid down
    expect(scorePaydown(loan, "500000", null)).toBeCloseTo(0.5, 1)
  })

  it("returns 1.0 for fully paid with zero outstanding", () => {
    const loan = {
      status: "fully_paid" as const,
      startDate: new Date("2026-01-01"),
      minInterestDays: 30,
      principalAmount: "1000000",
    }
    const lastPaymentDate = new Date("2026-01-15")
    expect(scorePaydown(loan, "0", lastPaymentDate)).toBeCloseTo(1.0, 1)
  })
})

describe("scorePenalties", () => {
  it("returns 1.0 when no penalties", () => {
    expect(scorePenalties(false)).toBe(1.0)
  })

  it("returns 0.0 when penalty was active", () => {
    expect(scorePenalties(true)).toBe(0.0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: FAIL — factor functions not exported

- [ ] **Step 3: Implement factor functions**

Add to `src/lib/credit-score.ts`:

```ts
/**
 * Timeliness: score based on average gap between consecutive payments.
 * Gaps ≤ 30 days = 1.0, smooth decay for longer gaps.
 * Loans with no payments get a neutral 0.5.
 */
export function scoreTimeliness(
  loan: { startDate: Date; principalAmount: string; status: string },
  payments: Array<{ paymentDate: Date }>,
): number {
  if (payments.length === 0) return 0.5

  const sorted = [...payments].sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())
  const gaps: number[] = []

  // Gap from loan start to first payment
  const firstGap = (sorted[0].paymentDate.getTime() - loan.startDate.getTime()) / (1000 * 60 * 60 * 24)
  gaps.push(Math.max(0, firstGap))

  // Gaps between consecutive payments
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].paymentDate.getTime() - sorted[i - 1].paymentDate.getTime()) / (1000 * 60 * 60 * 24)
    gaps.push(Math.max(0, gap))
  }

  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length

  // ≤ 30 days = perfect score
  if (avgGap <= 30) return 1.0

  // Smooth decay: 1 / (1 + ((avgGap - 30) / 30)²)
  const excess = (avgGap - 30) / 30
  return 1.0 / (1.0 + excess * excess)
}

/**
 * Completion: per-loan score based on final status.
 */
export function scoreCompletion(status: string): number {
  switch (status) {
    case "fully_paid": return 1.0
    case "active": return 0.5
    case "rolled_over": return 0.5
    case "settled_with_collateral": return 0.1
    default: return 0.0
  }
}

/**
 * History: number of non-pending loans on a trust curve.
 */
export function scoreHistory(loanCount: number): number {
  const curve: Record<number, number> = { 1: 0.3, 2: 0.5, 3: 0.7, 4: 0.85 }
  if (loanCount >= 5) return 1.0
  return curve[loanCount] ?? 0.0
}

/**
 * Paydown: how quickly principal is reduced.
 * For completed loans: early payoff relative to minInterestDays earns bonus.
 * For active loans: ratio of principal paid down.
 */
export function scorePaydown(
  loan: { status: string; startDate: Date; minInterestDays: number; principalAmount: string },
  outstandingBalance: string,
  lastPaymentDate: Date | null,
): number {
  const principal = parseFloat(loan.principalAmount)
  const outstanding = parseFloat(outstandingBalance)

  if (loan.status === "fully_paid" && lastPaymentDate) {
    const daysToPayoff = (lastPaymentDate.getTime() - loan.startDate.getTime()) / (1000 * 60 * 60 * 24)
    const minDays = loan.minInterestDays
    // Faster than min period = bonus up to 1.0
    if (daysToPayoff <= minDays * 0.7) return 1.0
    if (daysToPayoff <= minDays) return 0.85
    // At expected pace
    if (daysToPayoff <= minDays * 1.5) return 0.7
    // Slow payoff
    return 0.5
  }

  // Active or other: ratio of principal paid down
  if (principal <= 0) return 0.5
  const paidRatio = Math.max(0, Math.min(1, 1 - outstanding / principal))
  return paidRatio
}

/**
 * Penalties: 1.0 if no penalty incurred, 0.0 if penalty was triggered.
 * The caller aggregates across loans.
 */
export function scorePenalties(hadPenalty: boolean): number {
  return hadPenalty ? 0.0 : 1.0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/credit-score.ts src/lib/__tests__/credit-score.test.ts
git commit -m "feat(credit-score): implement individual scoring factor functions"
```

---

### Task 4: Main calculateCreditScore Function

**Files:**
- Modify: `src/lib/credit-score.ts`
- Modify: `src/lib/__tests__/credit-score.test.ts`

- [ ] **Step 1: Write failing tests for calculateCreditScore**

Add to `src/lib/__tests__/credit-score.test.ts`:

```ts
import {
  getBand, recencyWeight, sizeWeight, combinedWeights,
  scoreTimeliness, scoreCompletion, scoreHistory, scorePaydown, scorePenalties,
  calculateCreditScore,
} from "../credit-score"
import type { LoanListEntry } from "@/types/loan"
import type { PaymentWithCustomer } from "@/types/payment"

// Helper to build minimal loan objects for testing
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

describe("calculateCreditScore", () => {
  it("returns null score for customer with no loans", () => {
    const result = calculateCreditScore([], [])
    expect(result.score).toBeNull()
    expect(result.label).toBe("No loan history")
  })

  it("returns null score when all loans are pending", () => {
    const loans = [makeLoan({ id: "l1", customerId: "c1", status: "pending" })]
    const result = calculateCreditScore(loans, [])
    expect(result.score).toBeNull()
  })

  it("returns high score for customer with multiple fully paid loans and timely payments", () => {
    const loans = [
      makeLoan({ id: "l1", customerId: "c1", status: "fully_paid", startDate: new Date("2025-06-01"), principalAmount: "2000000", outstandingBalance: "0", lastPaymentDate: new Date("2025-06-20") }),
      makeLoan({ id: "l2", customerId: "c1", status: "fully_paid", startDate: new Date("2025-10-01"), principalAmount: "3000000", outstandingBalance: "0", lastPaymentDate: new Date("2025-10-20") }),
      makeLoan({ id: "l3", customerId: "c1", status: "fully_paid", startDate: new Date("2026-02-01"), principalAmount: "5000000", outstandingBalance: "0", lastPaymentDate: new Date("2026-02-15") }),
    ]
    const payments = [
      makePayment({ id: "p1", loanId: "l1", paymentDate: new Date("2025-06-15") }),
      makePayment({ id: "p2", loanId: "l1", paymentDate: new Date("2025-06-20") }),
      makePayment({ id: "p3", loanId: "l2", paymentDate: new Date("2025-10-15") }),
      makePayment({ id: "p4", loanId: "l2", paymentDate: new Date("2025-10-20") }),
      makePayment({ id: "p5", loanId: "l3", paymentDate: new Date("2026-02-10") }),
      makePayment({ id: "p6", loanId: "l3", paymentDate: new Date("2026-02-15") }),
    ]
    const result = calculateCreditScore(loans, payments)
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeGreaterThanOrEqual(740)
    expect(["Excellent", "Very Good"]).toContain(result.label)
  })

  it("returns low score for customer with collateral settlement", () => {
    const loans = [
      makeLoan({ id: "l1", customerId: "c1", status: "settled_with_collateral", startDate: new Date("2026-01-01"), outstandingBalance: "800000" }),
    ]
    const result = calculateCreditScore(loans, [])
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeLessThan(580)
  })

  it("returns a score between 300 and 850", () => {
    const loans = [
      makeLoan({ id: "l1", customerId: "c1", status: "active", startDate: new Date("2026-03-01") }),
    ]
    const payments = [
      makePayment({ id: "p1", loanId: "l1", paymentDate: new Date("2026-03-25") }),
    ]
    const result = calculateCreditScore(loans, payments)
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeGreaterThanOrEqual(300)
    expect(result.score!).toBeLessThanOrEqual(850)
  })

  it("rolled_over loans do not penalize the score", () => {
    const loansWithRollover = [
      makeLoan({ id: "l1", customerId: "c1", status: "rolled_over", startDate: new Date("2026-01-01") }),
      makeLoan({ id: "l2", customerId: "c1", status: "active", startDate: new Date("2026-03-01") }),
    ]
    const loansWithoutRollover = [
      makeLoan({ id: "l1", customerId: "c1", status: "active", startDate: new Date("2026-01-01") }),
      makeLoan({ id: "l2", customerId: "c1", status: "active", startDate: new Date("2026-03-01") }),
    ]
    const r1 = calculateCreditScore(loansWithRollover, [])
    const r2 = calculateCreditScore(loansWithoutRollover, [])
    // Rolled over should score same as active
    expect(r1.score).toBe(r2.score)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: FAIL — `calculateCreditScore` not exported

- [ ] **Step 3: Implement calculateCreditScore**

Add to `src/lib/credit-score.ts`:

```ts
import { isPenaltyActive } from "@/lib/interest/effective-rate"

/**
 * Calculate credit score for a customer based on their loan and payment history.
 * Returns score (300–850 or null), ordinal label, and color class.
 */
export function calculateCreditScore(
  loans: LoanListEntry[],
  payments: PaymentWithCustomer[],
): CreditScoreResult {
  // Filter out pending loans
  const scorableLoans = loans.filter((l) => l.status !== "pending")

  if (scorableLoans.length === 0) {
    return { score: null, label: "No loan history", color: "text-muted-foreground bg-muted border-border" }
  }

  const now = new Date()

  // Group payments by loanId
  const paymentsByLoan = new Map<string, PaymentWithCustomer[]>()
  for (const p of payments) {
    const existing = paymentsByLoan.get(p.loanId) ?? []
    existing.push(p)
    paymentsByLoan.set(p.loanId, existing)
  }

  // Compute combined weights for factors that use them (timeliness, completion)
  const weights = combinedWeights(
    scorableLoans.map((l) => ({ startDate: l.startDate, principalAmount: l.principalAmount })),
    now,
  )

  // Factor 1: Timeliness (weighted)
  let timeliness = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    const loan = scorableLoans[i]
    const loanPayments = (paymentsByLoan.get(loan.id) ?? []).map((p) => ({ paymentDate: p.paymentDate }))
    timeliness += scoreTimeliness(loan, loanPayments) * weights[i]
  }

  // Factor 2: Completion (weighted)
  let completion = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    completion += scoreCompletion(scorableLoans[i].status) * weights[i]
  }

  // Factor 3: History (not weighted — just count)
  const history = scoreHistory(scorableLoans.length)

  // Factor 4: Paydown (weighted)
  let paydown = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    const loan = scorableLoans[i]
    paydown += scorePaydown(
      { status: loan.status, startDate: loan.startDate, minInterestDays: loan.minInterestDays, principalAmount: loan.principalAmount },
      loan.outstandingBalance,
      loan.lastPaymentDate,
    ) * weights[i]
  }

  // Factor 5: Penalties (simple ratio)
  const penaltyLoans = scorableLoans.filter((l) => isPenaltyActive(l.daysOverdue, l.penaltyWaived))
  const penalties = scorableLoans.length > 0
    ? (scorableLoans.length - penaltyLoans.length) / scorableLoans.length
    : 1.0

  // Composite weighted score
  const composite =
    timeliness * WEIGHTS.timeliness +
    completion * WEIGHTS.completion +
    history * WEIGHTS.history +
    paydown * WEIGHTS.paydown +
    penalties * WEIGHTS.penalties

  const finalScore = Math.round(SCORE_MIN + composite * SCORE_RANGE)
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, finalScore))
  const { label, color } = getBand(clamped)

  return { score: clamped, label, color }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/credit-score.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/credit-score.ts src/lib/__tests__/credit-score.test.ts
git commit -m "feat(credit-score): implement main calculateCreditScore function"
```

---

### Task 5: CreditScoreBadge Component

**Files:**
- Create: `src/components/credit-score/credit-score-badge.tsx`

- [ ] **Step 1: Create the CreditScoreBadge component**

```tsx
// src/components/credit-score/credit-score-badge.tsx
"use client"

import { useMemo } from "react"
import { useLiveSuspenseQuery, eq } from "@tanstack/react-db"
import { loanCollection, paymentCollection } from "@/collections"
import { calculateCreditScore } from "@/lib/credit-score"
import { InfoPopover } from "@/components/ui/info-popover"
import { cn } from "@/lib/utils"

interface CreditScoreBadgeProps {
  customerId: string
  className?: string
}

export function CreditScoreBadge({ customerId, className }: CreditScoreBadgeProps) {
  const { data: customerLoans } = useLiveSuspenseQuery(
    (q) => q.from({ loan: loanCollection }).where(({ loan }) => eq(loan.customerId, customerId)),
    [customerId],
  )

  const { data: customerPayments } = useLiveSuspenseQuery(
    (q) => q.from({ p: paymentCollection }).where(({ p }) => eq(p.customerId, customerId)),
    [customerId],
  )

  const result = useMemo(
    () => calculateCreditScore(customerLoans ?? [], customerPayments ?? []),
    [customerLoans, customerPayments],
  )

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold",
          result.color,
        )}
      >
        {result.score !== null ? (
          <>
            <span className="font-mono tabular-nums">{result.score}</span>
            <span className="font-medium">{result.label}</span>
          </>
        ) : (
          <span className="font-medium">{result.label}</span>
        )}
      </div>
      <CreditScoreInfoPopover />
    </div>
  )
}

function CreditScoreInfoPopover() {
  return (
    <InfoPopover className="w-96">
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-semibold mb-1">Credit Score</p>
          <p className="text-muted-foreground">
            Scores range from 300 (highest risk) to 850 (lowest risk), calculated from the customer&apos;s loan and payment history. Recent and larger loans influence the score more than older, smaller ones.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold">Scoring Factors</p>

          <div>
            <p className="font-medium">Repayment Timeliness (35%)</p>
            <p className="text-muted-foreground">
              How consistently payments are made within 30-day cycles. Example: A customer who pays every 25–30 days scores higher than one who sometimes waits 60+ days.
            </p>
          </div>

          <div>
            <p className="font-medium">Loan Completion (25%)</p>
            <p className="text-muted-foreground">
              Ratio of fully paid loans. Example: 4 out of 5 loans fully paid = strong score. Loans settled with collateral lower this significantly.
            </p>
          </div>

          <div>
            <p className="font-medium">Borrowing History (20%)</p>
            <p className="text-muted-foreground">
              More completed loan cycles build trust. Example: A customer on their 5th loan scores higher than a first-time borrower.
            </p>
          </div>

          <div>
            <p className="font-medium">Balance Paydown (10%)</p>
            <p className="text-muted-foreground">
              How quickly principal is reduced. Paying off loans early earns a bonus. Example: Paying off a 3-month loan in 2 months = top score.
            </p>
          </div>

          <div>
            <p className="font-medium">Penalty Record (10%)</p>
            <p className="text-muted-foreground">
              Fewer penalties = better score. Example: 0 penalties across 3 loans = perfect score here.
            </p>
          </div>
        </div>

        <div>
          <p className="font-semibold mb-1">Score Ranges</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-green-700 dark:text-green-400 font-medium">800–850: Excellent</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">740–799: Very Good</span>
            <span className="text-blue-700 dark:text-blue-400 font-medium">670–739: Good</span>
            <span className="text-amber-700 dark:text-amber-400 font-medium">580–669: Fair</span>
            <span className="text-orange-700 dark:text-orange-400 font-medium">450–579: Poor</span>
            <span className="text-red-700 dark:text-red-400 font-medium">300–449: Very Poor</span>
          </div>
        </div>
      </div>
    </InfoPopover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/credit-score/credit-score-badge.tsx
git commit -m "feat(credit-score): add CreditScoreBadge component with info popover"
```

---

### Task 6: Integrate Badge into Customer Detail Page

**Files:**
- Modify: `src/app/(app)/customers/[id]/page.tsx`

- [ ] **Step 1: Add CreditScoreBadge import**

Add to the imports at the top of the file (after the existing component imports around line 54):

```ts
import { CreditScoreBadge } from "@/components/credit-score/credit-score-badge"
```

- [ ] **Step 2: Add badge to customer header**

In the `CustomerProfileContent` function, insert the badge between the `<PageHeader>` block (ending at line 393) and the Accordion block (starting at line 396). Add it as a new element:

Find this code (around lines 375–394):
```tsx
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <PageHeader title={customer.fullName} subtitle="Customer profile">
```

Replace with:
```tsx
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <PageHeader title={customer.fullName} subtitle="Customer profile">
        <CreditScoreBadge customerId={customerId} />
```

This places the credit score badge in the header row alongside the existing "Record Payment" and "Issue New Loan" buttons. The `PageHeader` component renders children inline.

- [ ] **Step 3: Verify the page loads without errors**

Run: `npx next build --no-lint 2>&1 | head -30` or manually navigate to a customer detail page in dev mode to confirm no runtime errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/customers/[id]/page.tsx
git commit -m "feat(credit-score): add credit score badge to customer detail page"
```

---

### Task 7: Integrate Badge into New Loan Form

**Files:**
- Modify: `src/app/(app)/loans/new/_components/loan-details-step.tsx`

- [ ] **Step 1: Add CreditScoreBadge import**

Add to the imports at the top of the file:

```ts
import { CreditScoreBadge } from "@/components/credit-score/credit-score-badge"
```

- [ ] **Step 2: Add badge after customer selection field**

Find this code (around lines 64–86):
```tsx
        <div className="space-y-1">
          <Label htmlFor="customerId" className="font-semibold">Customer</Label>
          {prefilledCustomerId && customerName ? (
            <Input
              id="customerId"
              value={customerName}
              disabled
              className="bg-muted"
            />
          ) : (
            <Input
              id="customerId"
              type="text"
              placeholder="Customer ID"
              {...register("customerId", {
                required: "Customer is required",
              })}
            />
          )}
          {errors.customerId && (
            <p className="text-sm text-destructive">{errors.customerId.message}</p>
          )}
        </div>
```

Replace with:
```tsx
        <div className="space-y-1">
          <Label htmlFor="customerId" className="font-semibold">Customer</Label>
          {prefilledCustomerId && customerName ? (
            <>
              <Input
                id="customerId"
                value={customerName}
                disabled
                className="bg-muted"
              />
              <CreditScoreBadge customerId={prefilledCustomerId} className="mt-2" />
            </>
          ) : (
            <Input
              id="customerId"
              type="text"
              placeholder="Customer ID"
              {...register("customerId", {
                required: "Customer is required",
              })}
            />
          )}
          {errors.customerId && (
            <p className="text-sm text-destructive">{errors.customerId.message}</p>
          )}
        </div>
```

The badge only shows when a customer is pre-selected (via `customerId` query param from the customer detail page), since that's when the loan officer needs the risk signal.

- [ ] **Step 3: Verify the page loads without errors**

Navigate to `/loans/new?customerId=<some-id>` in dev mode and confirm the badge renders below the customer name.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/loans/new/_components/loan-details-step.tsx
git commit -m "feat(credit-score): add credit score badge to new loan form"
```

---

### Task 8: E2E Tests

**Files:**
- Create: `cypress/e2e/credit-score.cy.ts`

- [ ] **Step 1: Write Cypress E2E tests**

```ts
// cypress/e2e/credit-score.cy.ts

describe("Credit Score Badge", () => {
  beforeEach(() => {
    cy.login()
  })

  describe("Customer Detail Page", () => {
    it("displays credit score badge for customer with loan history", () => {
      // Navigate to customers list and click first customer
      cy.visit("/customers")
      cy.get("[data-testid='data-row']").first().click()

      // Badge should be visible in the header
      cy.get("[class*='credit']").should("exist")
      // Should show either a numeric score or "No loan history"
      cy.get("body").then(($body) => {
        const text = $body.text()
        const hasScore = /\b[3-8]\d{2}\b/.test(text) // 300-850 range
        const hasNoHistory = text.includes("No loan history")
        expect(hasScore || hasNoHistory).to.be.true
      })
    })

    it("displays info popover when info icon is clicked", () => {
      cy.visit("/customers")
      cy.get("[data-testid='data-row']").first().click()

      // Click the info icon near the credit score
      cy.get("[aria-label='More information']").first().click()

      // Popover should show scoring factors
      cy.contains("Repayment Timeliness (35%)").should("be.visible")
      cy.contains("Loan Completion (25%)").should("be.visible")
      cy.contains("Borrowing History (20%)").should("be.visible")
      cy.contains("Balance Paydown (10%)").should("be.visible")
      cy.contains("Penalty Record (10%)").should("be.visible")

      // Score ranges table should be visible
      cy.contains("800–850: Excellent").should("be.visible")
      cy.contains("300–449: Very Poor").should("be.visible")
    })
  })

  describe("New Loan Form", () => {
    it("displays credit score when customer is pre-selected", () => {
      // First get a customer ID
      cy.visit("/customers")
      cy.get("[data-testid='data-row']").first().click()
      cy.url().then((url) => {
        const customerId = url.split("/customers/")[1]

        // Navigate to new loan with this customer
        cy.visit(`/loans/new?customerId=${customerId}`)

        // Badge should appear below customer name
        cy.get("body").then(($body) => {
          const text = $body.text()
          const hasScore = /\b[3-8]\d{2}\b/.test(text)
          const hasNoHistory = text.includes("No loan history")
          expect(hasScore || hasNoHistory).to.be.true
        })
      })
    })
  })
})
```

- [ ] **Step 2: Run E2E tests**

Run: `npx cypress run --spec cypress/e2e/credit-score.cy.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/credit-score.cy.ts
git commit -m "test(credit-score): add E2E tests for credit score badge"
```
