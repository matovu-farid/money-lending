# Loan Type Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support three loan types (perpetual, fixed_rate, reducing_balance) with type-specific interest calculation and payment allocation.

**Architecture:** Single-table approach — add `loanType` enum and nullable `termMonths` to loans table. Interest engine dispatches to type-specific strategy functions. Existing perpetual loan logic is extracted but unchanged.

**Tech Stack:** Drizzle ORM (Postgres), Effect-TS, BigNumber.js, Vitest, Next.js Server Actions, React

---

### Task 1: Schema — Add loanType enum and termMonths column

**Files:**
- Modify: `src/lib/db/schema/loans.ts`
- Create: `drizzle/0015_add_loan_type.sql`

- [ ] **Step 1: Add loanTypeEnum and new columns to schema**

In `src/lib/db/schema/loans.ts`, add the enum and two new columns:

```typescript
// Add after loanStatusEnum definition (line 8):
export const loanTypeEnum = pgEnum("loan_type", [
  "perpetual",
  "fixed_rate",
  "reducing_balance",
])
```

Then add these columns to the `loans` pgTable definition, after the `disbursementSource` line (line 23):

```typescript
  loanType: loanTypeEnum("loan_type").notNull().default("perpetual"),
  termMonths: integer("term_months"),
```

- [ ] **Step 2: Write the migration SQL**

Create `drizzle/0015_add_loan_type.sql`:

```sql
DO $$ BEGIN
  CREATE TYPE "public"."loan_type" AS ENUM('perpetual', 'fixed_rate', 'reducing_balance');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "loans" ADD COLUMN "loan_type" "loan_type" NOT NULL DEFAULT 'perpetual';
ALTER TABLE "loans" ADD COLUMN "term_months" integer;
```

- [ ] **Step 3: Update the drizzle journal**

Add the new migration entry to `drizzle/meta/_journal.json`. Follow the existing pattern — increment the `idx` and add an entry with the tag `"0015_add_loan_type"`.

- [ ] **Step 4: Generate the drizzle snapshot**

Run: `npx drizzle-kit generate`

This will create the snapshot file in `drizzle/meta/`. Verify it picks up both new columns.

- [ ] **Step 5: Run the migration**

Run: `npx drizzle-kit migrate`

Expected: Migration applies successfully. Existing loans get `loan_type = 'perpetual'` and `term_months = NULL`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema/loans.ts drizzle/
git commit -m "feat: add loan_type enum and term_months column to loans schema"
```

---

### Task 2: Types — Add LoanType and ScheduleEntry, update CreateLoanInput

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add LoanType and ScheduleEntry types**

In `src/types/index.ts`, after the `LoanStatus` type (line 32):

```typescript
export type LoanType = "perpetual" | "fixed_rate" | "reducing_balance"

export interface ScheduleEntry {
  month: number
  monthlyPrincipal: string
  monthlyInterest: string
  monthlyInstallment: string
  balanceAfter: string
}
```

- [ ] **Step 2: Update CreateLoanInput**

Add two fields to the `CreateLoanInput` interface (after `disbursementSource` line):

```typescript
  loanType: LoanType             // defaults to "perpetual" in UI
  termMonths?: number             // required for fixed_rate and reducing_balance
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add LoanType, ScheduleEntry types and update CreateLoanInput"
```

---

### Task 3: Interest Engine — Fixed rate and reducing balance allocation strategies

**Files:**
- Modify: `src/lib/interest/engine.ts`
- Create: `src/lib/interest/__tests__/engine.test.ts`

- [ ] **Step 1: Write failing tests for calculateSchedule**

Create `src/lib/interest/__tests__/engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  calculateSchedule,
  allocateFixedRatePayment,
  allocateReducingBalancePayment,
  allocatePayment,
  calculateLoanSummary,
} from "../engine"

describe("calculateSchedule", () => {
  it("generates correct fixed rate schedule for 1M at 10% over 5 months", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "fixed_rate")
    expect(schedule).toHaveLength(5)
    // Monthly interest = 1,000,000 × 0.10 = 100,000 (always on original)
    // Monthly principal = 1,000,000 / 5 = 200,000
    expect(schedule[0]).toEqual({
      month: 1,
      monthlyPrincipal: "200000.00",
      monthlyInterest: "100000.00",
      monthlyInstallment: "300000.00",
      balanceAfter: "800000.00",
    })
    expect(schedule[4]).toEqual({
      month: 5,
      monthlyPrincipal: "200000.00",
      monthlyInterest: "100000.00",
      monthlyInstallment: "300000.00",
      balanceAfter: "0.00",
    })
    // All installments identical for fixed rate
    for (const entry of schedule) {
      expect(entry.monthlyInstallment).toBe("300000.00")
    }
  })

  it("generates correct reducing balance schedule for 1M at 10% over 5 months", () => {
    const schedule = calculateSchedule("1000000", "0.10", 5, "reducing_balance")
    expect(schedule).toHaveLength(5)
    // Month 1: interest = 1,000,000 × 0.10 = 100,000, principal = 200,000
    expect(schedule[0]).toEqual({
      month: 1,
      monthlyPrincipal: "200000.00",
      monthlyInterest: "100000.00",
      monthlyInstallment: "300000.00",
      balanceAfter: "800000.00",
    })
    // Month 2: interest = 800,000 × 0.10 = 80,000
    expect(schedule[1]).toEqual({
      month: 2,
      monthlyPrincipal: "200000.00",
      monthlyInterest: "80000.00",
      monthlyInstallment: "280000.00",
      balanceAfter: "600000.00",
    })
    // Month 5: interest = 200,000 × 0.10 = 20,000
    expect(schedule[4]).toEqual({
      month: 5,
      monthlyPrincipal: "200000.00",
      monthlyInterest: "20000.00",
      monthlyInstallment: "220000.00",
      balanceAfter: "0.00",
    })
    // Installments should decrease
    const installments = schedule.map((e) => parseFloat(e.monthlyInstallment))
    for (let i = 1; i < installments.length; i++) {
      expect(installments[i]).toBeLessThan(installments[i - 1])
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: FAIL — `calculateSchedule` is not exported from engine.

- [ ] **Step 3: Implement calculateSchedule**

In `src/lib/interest/engine.ts`, add after the `calculateLoanSummary` function (after line 57):

```typescript
import type { LoanType, ScheduleEntry } from "@/types"
```

Add this import at the top of the file, then add the function:

```typescript
/**
 * Generates the full amortization schedule for fixed_rate or reducing_balance loans.
 * Returns an array of monthly installments showing principal, interest, and remaining balance.
 */
export function calculateSchedule(
  principalAmount: string,
  monthlyRateDecimal: string,
  termMonths: number,
  loanType: "fixed_rate" | "reducing_balance"
): ScheduleEntry[] {
  const principal = new BigNumber(principalAmount)
  const rate = new BigNumber(monthlyRateDecimal)
  const monthlyPrincipal = principal.dividedBy(termMonths)
  const schedule: ScheduleEntry[] = []
  let balance = principal

  for (let month = 1; month <= termMonths; month++) {
    const monthlyInterest =
      loanType === "fixed_rate"
        ? principal.multipliedBy(rate)
        : balance.multipliedBy(rate)

    const isLastMonth = month === termMonths
    const principalThisMonth = isLastMonth ? balance : monthlyPrincipal
    const balanceAfter = isLastMonth
      ? new BigNumber(0)
      : balance.minus(monthlyPrincipal)
    const monthlyInstallment = principalThisMonth.plus(monthlyInterest)

    schedule.push({
      month,
      monthlyPrincipal: formatAmount(principalThisMonth),
      monthlyInterest: formatAmount(monthlyInterest),
      monthlyInstallment: formatAmount(monthlyInstallment),
      balanceAfter: formatAmount(balanceAfter),
    })

    balance = balanceAfter
  }

  return schedule
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing tests for allocateFixedRatePayment**

Add to the test file:

```typescript
describe("allocateFixedRatePayment", () => {
  it("allocates full installment correctly", () => {
    // Loan: 1M, 10%, 5 months. Monthly interest = 100k, monthly principal = 200k
    const result = allocateFixedRatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("800000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("handles partial payment (less than monthly interest)", () => {
    const result = allocateFixedRatePayment({
      paymentAmount: "50000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 1,
    })
    // All goes to interest, nothing to principal
    expect(result.interestPortion).toBe("50000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceAfter).toBe("1000000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("early payoff includes all remaining term interest", () => {
    // Paying off at month 2 (3 months remaining). Remaining interest = 100k × 3 = 300k
    // Balance = 800k. Total owed = 800k + 300k = 1,100k
    const result = allocateFixedRatePayment({
      paymentAmount: "1100000",
      principalBalanceBefore: "800000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
      paymentNumber: 2,
    })
    expect(result.interestPortion).toBe("300000.00")
    expect(result.principalPortion).toBe("800000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: FAIL — `allocateFixedRatePayment` is not exported.

- [ ] **Step 7: Implement allocateFixedRatePayment**

Add to `src/lib/interest/engine.ts`:

```typescript
/**
 * Allocates a payment for a fixed-rate loan.
 * Interest is always calculated on the ORIGINAL principal amount.
 * Interest-first allocation: payment covers interest first, remainder goes to principal.
 *
 * For early payoff: all remaining term interest must be paid.
 * Remaining interest = monthlyInterest × (termMonths - paymentNumber + 1)
 */
export function allocateFixedRatePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  originalPrincipal: string
  monthlyRateDecimal: string
  termMonths: number
  paymentNumber: number
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, originalPrincipal, monthlyRateDecimal, termMonths, paymentNumber } = params
  const payment = new BigNumber(paymentAmount)
  const balance = new BigNumber(principalBalanceBefore)
  const monthlyInterest = new BigNumber(originalPrincipal).multipliedBy(new BigNumber(monthlyRateDecimal))

  // Check if this is an early payoff (payment > monthly installment)
  const monthlyPrincipal = new BigNumber(originalPrincipal).dividedBy(termMonths)
  const normalInstallment = monthlyPrincipal.plus(monthlyInterest)
  const remainingMonths = termMonths - paymentNumber + 1
  const allRemainingInterest = monthlyInterest.multipliedBy(remainingMonths)

  // If payment covers more than current month's installment, charge all remaining interest
  let interestOwed: BigNumber
  if (payment.isGreaterThan(normalInstallment)) {
    interestOwed = allRemainingInterest
  } else {
    interestOwed = monthlyInterest
  }

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      loanFullyPaid: false,
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = BigNumber.max(balance.minus(principalPortion), 0)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: PASS

- [ ] **Step 9: Write failing tests for allocateReducingBalancePayment**

Add to the test file:

```typescript
describe("allocateReducingBalancePayment", () => {
  it("allocates full installment correctly at month 1", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    // Interest = 1,000,000 × 0.10 = 100,000
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("800000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("calculates interest on current balance (month 3, balance 600k)", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "260000",
      principalBalanceBefore: "600000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    // Interest = 600,000 × 0.10 = 60,000
    expect(result.interestPortion).toBe("60000.00")
    expect(result.principalPortion).toBe("200000.00")
    expect(result.principalBalanceAfter).toBe("400000.00")
    expect(result.loanFullyPaid).toBe(false)
  })

  it("early payoff only charges interest on current balance", () => {
    // Balance = 600k, interest = 600k × 0.10 = 60k, total = 660k
    const result = allocateReducingBalancePayment({
      paymentAmount: "660000",
      principalBalanceBefore: "600000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    expect(result.interestPortion).toBe("60000.00")
    expect(result.principalPortion).toBe("600000.00")
    expect(result.principalBalanceAfter).toBe("0.00")
    expect(result.loanFullyPaid).toBe(true)
  })

  it("handles partial payment less than interest", () => {
    const result = allocateReducingBalancePayment({
      paymentAmount: "30000",
      principalBalanceBefore: "1000000",
      originalPrincipal: "1000000",
      monthlyRateDecimal: "0.10",
      termMonths: 5,
    })
    expect(result.interestPortion).toBe("30000.00")
    expect(result.principalPortion).toBe("0.00")
    expect(result.principalBalanceAfter).toBe("1000000.00")
    expect(result.loanFullyPaid).toBe(false)
  })
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: FAIL — `allocateReducingBalancePayment` not exported.

- [ ] **Step 11: Implement allocateReducingBalancePayment**

Add to `src/lib/interest/engine.ts`:

```typescript
/**
 * Allocates a payment for a reducing-balance loan.
 * Interest is calculated on the CURRENT outstanding balance.
 * Interest-first allocation: payment covers interest first, remainder goes to principal.
 * Early payoff only requires interest on current balance (not full term).
 */
export function allocateReducingBalancePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  originalPrincipal: string
  monthlyRateDecimal: string
  termMonths: number
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal } = params
  const payment = new BigNumber(paymentAmount)
  const balance = new BigNumber(principalBalanceBefore)
  const interestOwed = balance.multipliedBy(new BigNumber(monthlyRateDecimal))

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      loanFullyPaid: false,
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = BigNumber.max(balance.minus(principalPortion), 0)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: PASS

- [ ] **Step 13: Write failing tests for allocatePayment dispatch**

Add to the test file:

```typescript
describe("allocatePayment dispatch", () => {
  it("dispatches to perpetual logic when no loanType specified (backward compat)", () => {
    const result = allocatePayment({
      paymentAmount: "200000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
    })
    // Perpetual: interest = 1M × (0.10/30) × 30 = 100,000
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("100000.00")
  })

  it("dispatches to fixed_rate when loanType is fixed_rate", () => {
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
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
  })

  it("dispatches to reducing_balance when loanType is reducing_balance", () => {
    const result = allocatePayment({
      paymentAmount: "300000",
      principalBalanceBefore: "1000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "reducing_balance",
      originalPrincipal: "1000000",
      termMonths: 5,
    })
    // Interest on current balance: 1M × 0.10 = 100k
    expect(result.interestPortion).toBe("100000.00")
    expect(result.principalPortion).toBe("200000.00")
  })
})
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: FAIL — `allocatePayment` doesn't accept `loanType` parameter yet.

- [ ] **Step 15: Update allocatePayment to dispatch by loanType**

Replace the existing `allocatePayment` function in `src/lib/interest/engine.ts` with:

```typescript
/**
 * Allocates a payment using type-specific strategy.
 * - perpetual (default): interest-first on reducing balance with min-period enforcement
 * - fixed_rate: interest always on original principal, all remaining term interest on early payoff
 * - reducing_balance: interest on current balance, no min-period enforcement
 *
 * Backward compatible: if loanType is omitted, defaults to perpetual.
 */
export function allocatePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  monthlyRateDecimal: string
  daysElapsed: number
  minInterestDays: number
  loanType?: LoanType
  originalPrincipal?: string
  termMonths?: number
  paymentNumber?: number
}): PaymentAllocation {
  const loanType = params.loanType ?? "perpetual"

  if (loanType === "fixed_rate") {
    return allocateFixedRatePayment({
      paymentAmount: params.paymentAmount,
      principalBalanceBefore: params.principalBalanceBefore,
      originalPrincipal: params.originalPrincipal!,
      monthlyRateDecimal: params.monthlyRateDecimal,
      termMonths: params.termMonths!,
      paymentNumber: params.paymentNumber!,
    })
  }

  if (loanType === "reducing_balance") {
    return allocateReducingBalancePayment({
      paymentAmount: params.paymentAmount,
      principalBalanceBefore: params.principalBalanceBefore,
      originalPrincipal: params.originalPrincipal!,
      monthlyRateDecimal: params.monthlyRateDecimal,
      termMonths: params.termMonths!,
    })
  }

  // Perpetual (existing logic)
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays } = params
  const payment = new BigNumber(paymentAmount)
  const interestOwed = calculateInterest(principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays)

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      loanFullyPaid: false,
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = BigNumber.max(
    new BigNumber(principalBalanceBefore).minus(principalPortion),
    0
  )

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
```

- [ ] **Step 16: Run all engine tests**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: ALL PASS

- [ ] **Step 17: Write failing test for calculateLoanSummary with loan types**

Add to the test file:

```typescript
describe("calculateLoanSummary with loan types", () => {
  it("returns schedule for fixed_rate loans", () => {
    const summary = calculateLoanSummary("1000000", "0.10", 30, "fixed_rate", 5)
    expect(summary.schedule).toBeDefined()
    expect(summary.schedule).toHaveLength(5)
    expect(summary.totalInterest).toBe("500000.00")
    expect(summary.totalOwed).toBe("1500000.00")
    expect(summary.monthlyInstallment).toBe("300000.00")
  })

  it("returns schedule for reducing_balance loans", () => {
    const summary = calculateLoanSummary("1000000", "0.10", 30, "reducing_balance", 5)
    expect(summary.schedule).toBeDefined()
    expect(summary.schedule).toHaveLength(5)
    expect(summary.totalInterest).toBe("300000.00")
    expect(summary.totalOwed).toBe("1300000.00")
    // First month installment
    expect(summary.monthlyInstallment).toBe("300000.00")
  })

  it("returns perpetual summary when no loanType (backward compat)", () => {
    const summary = calculateLoanSummary("1000000", "0.10", 30)
    expect(summary.dailyInterest).toBeDefined()
    expect(summary.totalInterestAtMinPeriod).toBeDefined()
    expect((summary as any).schedule).toBeUndefined()
  })
})
```

- [ ] **Step 18: Run tests to verify they fail**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: FAIL — `calculateLoanSummary` doesn't accept loanType/termMonths params.

- [ ] **Step 19: Update calculateLoanSummary to support loan types**

Replace the existing `calculateLoanSummary` function in `src/lib/interest/engine.ts`:

```typescript
/**
 * Calculates the loan summary for the Review step of the loan issuance wizard.
 *
 * For perpetual loans (default): returns daily interest, total at min period, total owed.
 * For fixed_rate/reducing_balance: returns amortization schedule, total interest, total owed.
 */
export function calculateLoanSummary(
  principalAmount: string,
  monthlyRateDecimal: string,
  minInterestDays?: number,
  loanType?: LoanType,
  termMonths?: number
): {
  // Perpetual fields
  dailyInterest?: string
  totalInterestAtMinPeriod?: string
  totalOwedAtMinPeriod?: string
  minInterestDays?: number
  // Term loan fields
  schedule?: ScheduleEntry[]
  totalInterest?: string
  totalOwed?: string
  monthlyInstallment?: string
} {
  const effectiveLoanType = loanType ?? "perpetual"

  if (effectiveLoanType !== "perpetual" && termMonths) {
    const schedule = calculateSchedule(principalAmount, monthlyRateDecimal, termMonths, effectiveLoanType as "fixed_rate" | "reducing_balance")
    const totalInterest = schedule.reduce(
      (sum, e) => sum.plus(new BigNumber(e.monthlyInterest)),
      new BigNumber(0)
    )
    const totalOwed = new BigNumber(principalAmount).plus(totalInterest)
    return {
      schedule,
      totalInterest: formatAmount(totalInterest),
      totalOwed: formatAmount(totalOwed),
      monthlyInstallment: schedule[0].monthlyInstallment,
    }
  }

  // Perpetual loan summary (existing logic)
  const effectiveMinDays = minInterestDays ?? 30
  const principal = new BigNumber(principalAmount)
  const dailyRate = calculateDailyRate(monthlyRateDecimal)
  const dailyInterest = principal.multipliedBy(dailyRate)
  const totalInterestAtMinPeriod = dailyInterest.multipliedBy(effectiveMinDays)
  const totalOwedAtMinPeriod = principal.plus(totalInterestAtMinPeriod)

  return {
    dailyInterest: formatAmount(dailyInterest),
    totalInterestAtMinPeriod: formatAmount(totalInterestAtMinPeriod),
    totalOwedAtMinPeriod: formatAmount(totalOwedAtMinPeriod),
    minInterestDays: effectiveMinDays,
  }
}
```

- [ ] **Step 20: Run all engine tests**

Run: `npx vitest run src/lib/interest/__tests__/engine.test.ts`

Expected: ALL PASS

- [ ] **Step 21: Run existing tests to ensure no regressions**

Run: `npx vitest run src/services/__tests__/loan.service.test.ts src/services/__tests__/payment.service.test.ts`

Expected: ALL PASS — the `allocatePayment` signature change is backward compatible (new params are optional).

- [ ] **Step 22: Commit**

```bash
git add src/lib/interest/engine.ts src/lib/interest/__tests__/engine.test.ts
git commit -m "feat: add fixed rate and reducing balance interest calculation strategies"
```

---

### Task 4: Loan Service — Accept loanType and termMonths in createLoan

**Files:**
- Modify: `src/services/loan.service.ts`
- Modify: `src/services/__tests__/loan.service.test.ts`

- [ ] **Step 1: Write failing tests for loanType validation**

Add to `src/services/__tests__/loan.service.test.ts`, in the existing describe block:

```typescript
it("createLoan: accepts loanType and termMonths for fixed_rate loan", async () => {
  // Setup: mock db.transaction to capture the inserted values
  const insertedValues: any[] = []
  ;(db.transaction as any).mockImplementation(async (fn: any) => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...baseCustomer }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((val: any) => {
          insertedValues.push(val)
          return {
            returning: vi.fn().mockResolvedValue([{ id: "loan-1", ...val }]),
          }
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    return fn(tx)
  })

  const input = {
    ...baseLoanInput,
    loanType: "fixed_rate" as const,
    termMonths: 6,
  }

  await Effect.runPromise(createLoan(input, "actor-1"))

  // Verify the loan insert included loanType and termMonths
  const loanInsert = insertedValues.find((v) => v.loanType !== undefined)
  expect(loanInsert).toBeDefined()
  expect(loanInsert.loanType).toBe("fixed_rate")
  expect(loanInsert.termMonths).toBe(6)
})

it("createLoan: defaults loanType to perpetual when not provided", async () => {
  const insertedValues: any[] = []
  ;(db.transaction as any).mockImplementation(async (fn: any) => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...baseCustomer }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((val: any) => {
          insertedValues.push(val)
          return {
            returning: vi.fn().mockResolvedValue([{ id: "loan-1", ...val }]),
          }
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    return fn(tx)
  })

  await Effect.runPromise(createLoan(baseLoanInput as any, "actor-1"))

  const loanInsert = insertedValues.find((v) => v.principalAmount !== undefined)
  expect(loanInsert.loanType).toBe("perpetual")
  expect(loanInsert.termMonths).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/loan.service.test.ts`

Expected: FAIL — createLoan doesn't pass loanType/termMonths to the insert.

- [ ] **Step 3: Update createLoan to include loanType and termMonths**

In `src/services/loan.service.ts`, find the `createLoan` function's loan insert values block. It will look something like:

```typescript
const [newLoan] = await tx.insert(loans).values({
  customerId: input.customerId,
  principalAmount: input.principalAmount,
  // ... other fields
}).returning()
```

Add `loanType` and `termMonths` to the insert values:

```typescript
  loanType: input.loanType ?? "perpetual",
  termMonths: (input.loanType && input.loanType !== "perpetual") ? input.termMonths! : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/loan.service.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/loan.service.ts src/services/__tests__/loan.service.test.ts
git commit -m "feat: accept loanType and termMonths in createLoan service"
```

---

### Task 5: Payment Service — Type-aware allocation and recalculation

**Files:**
- Modify: `src/services/payment.service.ts`
- Modify: `src/services/__tests__/payment.service.test.ts`

- [ ] **Step 1: Write failing tests for type-aware recordPayment**

Add to `src/services/__tests__/payment.service.test.ts`:

```typescript
it("recordPayment: uses fixed_rate allocation for fixed_rate loans", async () => {
  const insertedPayment: any = {}
  ;(db.transaction as any).mockImplementation(async (fn: any) => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn((table: any) => {
          if (table === loans) {
            return {
              where: vi.fn().mockResolvedValue([{
                ...mockLoan,
                loanType: "fixed_rate",
                termMonths: 5,
                principalAmount: "1000000.00",
                interestRate: "0.10",
              }]),
              for: vi.fn().mockResolvedValue([{
                ...mockLoan,
                loanType: "fixed_rate",
                termMonths: 5,
                principalAmount: "1000000.00",
                interestRate: "0.10",
              }]),
            }
          }
          return {
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]), // no prior payments
              }),
            }),
          }
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((val: any) => {
          Object.assign(insertedPayment, val)
          return { returning: vi.fn().mockResolvedValue([{ id: "pay-1", ...val }]) }
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    return fn(tx)
  })

  await Effect.runPromise(recordPayment({
    loanId: "loan-1",
    paymentDate: "2026-04-19T00:00:00.000Z",
    amount: "300000",
    depositLocation: "cash",
  }, "actor-1"))

  // Fixed rate: interest = 1M × 0.10 = 100k, principal = 200k
  expect(insertedPayment.interestPortion).toBe("100000.00")
  expect(insertedPayment.principalPortion).toBe("200000.00")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/payment.service.test.ts`

Expected: FAIL — recordPayment doesn't read loanType or pass it to allocatePayment.

- [ ] **Step 3: Update recordPayment to be type-aware**

In `src/services/payment.service.ts`, inside the `recordPayment` function's transaction block, after fetching the loan and active payments, update the `allocatePayment` call. The current code reads:

```typescript
const allocation = allocatePayment({
  paymentAmount: input.amount,
  principalBalanceBefore,
  monthlyRateDecimal,
  daysElapsed,
  minInterestDays,
})
```

Replace with:

```typescript
const loanType = loan.loanType ?? "perpetual"
const paymentNumber = activePayments.length + 1

const allocation = allocatePayment({
  paymentAmount: input.amount,
  principalBalanceBefore,
  monthlyRateDecimal,
  daysElapsed,
  minInterestDays,
  loanType,
  originalPrincipal: loan.principalAmount,
  termMonths: loan.termMonths ?? undefined,
  paymentNumber,
})
```

Also update the overpayment validation (the `totalOwed` calculation) to be type-aware. Replace the existing overpayment check:

```typescript
// M2: Reject overpayments that exceed total owed (interest + principal)
const totalOwed = new BigNumber(allocation.interestPortion).plus(new BigNumber(principalBalanceBefore))
if (new BigNumber(input.amount).isGreaterThan(totalOwed)) {
```

With type-aware logic:

```typescript
// M2: Reject overpayments that exceed total owed
let totalOwed: BigNumber
if (loanType === "fixed_rate") {
  // Fixed rate: remaining principal + all remaining term interest
  const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(monthlyRateDecimal))
  const remainingMonths = (loan.termMonths ?? 0) - activePayments.length
  totalOwed = new BigNumber(principalBalanceBefore).plus(monthlyInterest.multipliedBy(remainingMonths))
} else if (loanType === "reducing_balance") {
  // Reducing balance: remaining principal + current period interest
  const currentInterest = new BigNumber(principalBalanceBefore).multipliedBy(new BigNumber(monthlyRateDecimal))
  totalOwed = new BigNumber(principalBalanceBefore).plus(currentInterest)
} else {
  // Perpetual: interest + principal (existing logic)
  totalOwed = new BigNumber(allocation.interestPortion).plus(new BigNumber(principalBalanceBefore))
}
if (new BigNumber(input.amount).isGreaterThan(totalOwed)) {
```

- [ ] **Step 4: Update recalculateFromPayment to be type-aware**

In the `recalculateFromPayment` function, update the `allocatePayment` call inside the for loop. The current code:

```typescript
const allocation = allocatePayment({
  paymentAmount: current.amount,
  principalBalanceBefore,
  monthlyRateDecimal,
  daysElapsed,
  minInterestDays,
})
```

Replace with:

```typescript
const loanType = loan.loanType ?? "perpetual"
const allocation = allocatePayment({
  paymentAmount: current.amount,
  principalBalanceBefore,
  monthlyRateDecimal,
  daysElapsed,
  minInterestDays,
  loanType,
  originalPrincipal: loan.principalAmount,
  termMonths: loan.termMonths ?? undefined,
  paymentNumber: i + 1,
})
```

Note: move the `loanType` variable outside the loop (once per call to `recalculateFromPayment`).

- [ ] **Step 5: Run all payment tests**

Run: `npx vitest run src/services/__tests__/payment.service.test.ts`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/payment.service.ts src/services/__tests__/payment.service.test.ts
git commit -m "feat: type-aware payment allocation and recalculation"
```

---

### Task 6: Loan Actions — Validate loanType/termMonths, update computeOverdue

**Files:**
- Modify: `src/actions/loan.actions.ts`

- [ ] **Step 1: Update createLoanAction validation**

In `src/actions/loan.actions.ts`, in the `createLoanAction` function, add validation after the existing `disbursementSource` check (after line 178):

```typescript
  // Validate loanType
  const validLoanTypes = ["perpetual", "fixed_rate", "reducing_balance"]
  const loanType = input.loanType || "perpetual"
  if (!validLoanTypes.includes(loanType)) {
    return { error: "Loan type must be perpetual, fixed_rate, or reducing_balance" }
  }

  // Validate termMonths for term loans
  if (loanType !== "perpetual") {
    if (!input.termMonths || input.termMonths <= 0 || !Number.isInteger(input.termMonths)) {
      return { error: "Term months must be a positive integer for fixed rate and reducing balance loans" }
    }
  }
```

Also update the `loanInput` construction to include the new fields:

```typescript
const loanInput: CreateLoanInput = {
  ...input,
  interestRate: input.interestRate || "0.10",
  minInterestDays: input.minInterestDays || 30,
  loanType,
  termMonths: loanType !== "perpetual" ? input.termMonths : undefined,
}
```

- [ ] **Step 2: Update computeOverdue for term loans**

In the `computeOverdue` function, update the overdue calculation inside the `if (loan.status === "active")` block. After the existing perpetual logic, add type-aware branching:

```typescript
if (loan.status === "active") {
  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const loanType = loan.loanType ?? "perpetual"

  if (loanType === "perpetual") {
    // Existing perpetual logic — unchanged
    const totalDaysElapsed = Math.floor(
      (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
    )
    const totalInterestAccrued = calculateInterest(loan.principalAmount, effectiveRate, totalDaysElapsed, 0)
    const dailyRateBN = calculateDailyRate(effectiveRate)
    const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRateBN)
    dailyRate = dailyInterestAmount.toFixed(2)

    const totalInterestPaid = loanPayments.reduce(
      (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
    )

    const unpaidInterestBN = totalInterestAccrued.minus(totalInterestPaid)
    unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)

    const daysOverdueBN = calculateDaysOverdue(
      totalInterestAccrued,
      totalInterestPaid,
      dailyInterestAmount
    )
    daysOverdue = Math.floor(daysOverdueBN.toNumber())
  } else {
    // Term loans (fixed_rate, reducing_balance): overdue = missed installments
    const monthsElapsed = Math.floor(
      (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
    )
    const expectedPayments = Math.min(monthsElapsed, loan.termMonths ?? 0)
    const actualPayments = loanPayments.length
    const missedPayments = Math.max(expectedPayments - actualPayments, 0)
    daysOverdue = missedPayments * 30 // Each missed payment = 30 days overdue

    // Calculate daily rate for display
    const monthlyInterest = loanType === "fixed_rate"
      ? new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(effectiveRate))
      : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(effectiveRate))
    dailyRate = monthlyInterest.dividedBy(30).toFixed(2)

    // Unpaid interest = total expected interest - total paid interest
    const totalInterestPaid = loanPayments.reduce(
      (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
    )
    const { calculateSchedule } = await import("@/lib/interest/engine")
    const schedule = calculateSchedule(
      loan.principalAmount,
      effectiveRate,
      loan.termMonths!,
      loanType as "fixed_rate" | "reducing_balance"
    )
    const expectedInterest = schedule
      .slice(0, expectedPayments)
      .reduce((s, e) => s.plus(new BigNumber(e.monthlyInterest)), new BigNumber(0))
    const unpaidInterestBN = expectedInterest.minus(totalInterestPaid)
    unpaidInterest = BigNumber.max(unpaidInterestBN, 0).toFixed(2)
  }
}
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run src/services/__tests__/loan.service.test.ts src/services/__tests__/payment.service.test.ts`

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/actions/loan.actions.ts
git commit -m "feat: validate loanType/termMonths in actions, type-aware overdue calculation"
```

---

### Task 7: UI — Loan creation form updates

**Files:**
- Modify: `src/app/(app)/loans/new/page.tsx`

- [ ] **Step 1: Add loan type selector to Step 1**

In the loan creation form component, add state for loanType and termMonths. Find the existing state declarations and add:

```typescript
const [loanType, setLoanType] = useState<"perpetual" | "fixed_rate" | "reducing_balance">("perpetual")
const [termMonths, setTermMonths] = useState<string>("")
```

Add the Loan Type radio group in Step 1, before the principal amount field:

```tsx
<div className="space-y-2">
  <Label>Loan Type</Label>
  <div className="flex gap-4">
    {[
      { value: "perpetual", label: "Perpetual" },
      { value: "fixed_rate", label: "Fixed Rate" },
      { value: "reducing_balance", label: "Reducing Balance" },
    ].map((option) => (
      <label key={option.value} className="flex items-center gap-2 cursor-pointer">
        <input
          type="radio"
          name="loanType"
          value={option.value}
          checked={loanType === option.value}
          onChange={(e) => setLoanType(e.target.value as typeof loanType)}
          className="accent-primary"
        />
        <span className="text-sm">{option.label}</span>
      </label>
    ))}
  </div>
</div>
```

Add the Term Months field, shown only for non-perpetual types:

```tsx
{loanType !== "perpetual" && (
  <div className="space-y-2">
    <Label htmlFor="termMonths">Term (months)</Label>
    <Input
      id="termMonths"
      type="number"
      min="1"
      step="1"
      value={termMonths}
      onChange={(e) => setTermMonths(e.target.value)}
      placeholder="e.g. 6"
    />
  </div>
)}
```

Hide the `minInterestDays` field when loanType is not perpetual (wrap it in `{loanType === "perpetual" && (...)}`).

- [ ] **Step 2: Update form submission to include loanType and termMonths**

Find where the form data is assembled for submission (the `createLoanAction` call). Add the new fields:

```typescript
loanType,
termMonths: loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined,
```

Add validation before submission:

```typescript
if (loanType !== "perpetual" && (!termMonths || parseInt(termMonths, 10) <= 0)) {
  toast.error("Term months is required for fixed rate and reducing balance loans")
  return
}
```

- [ ] **Step 3: Update Step 3 (Review) to show type-specific preview**

Update the `calculateLoanSummary` call in the review step to pass loanType and termMonths:

```typescript
const summary = calculateLoanSummary(
  principalAmount,
  interestRate,
  loanType === "perpetual" ? minInterestDays : undefined,
  loanType,
  loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined
)
```

For term loans, render the amortization schedule table instead of the perpetual summary:

```tsx
{loanType !== "perpetual" && summary.schedule ? (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>Total Interest: <span className="font-semibold">UGX {Number(summary.totalInterest).toLocaleString()}</span></div>
      <div>Total Owed: <span className="font-semibold">UGX {Number(summary.totalOwed).toLocaleString()}</span></div>
      <div>Monthly Installment: <span className="font-semibold">UGX {Number(summary.monthlyInstallment).toLocaleString()}</span></div>
    </div>
    <div className="rounded-md border overflow-auto max-h-64">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">Principal</th>
            <th className="px-3 py-2 text-right">Interest</th>
            <th className="px-3 py-2 text-right">Installment</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {summary.schedule.map((entry) => (
            <tr key={entry.month} className="border-t">
              <td className="px-3 py-2">{entry.month}</td>
              <td className="px-3 py-2 text-right">{Number(entry.monthlyPrincipal).toLocaleString()}</td>
              <td className="px-3 py-2 text-right">{Number(entry.monthlyInterest).toLocaleString()}</td>
              <td className="px-3 py-2 text-right">{Number(entry.monthlyInstallment).toLocaleString()}</td>
              <td className="px-3 py-2 text-right">{Number(entry.balanceAfter).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
) : (
  /* existing perpetual preview JSX */
)}
```

- [ ] **Step 4: Verify the form renders correctly**

Run: `npx next build`

Expected: Build succeeds without TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/loans/new/page.tsx
git commit -m "feat: add loan type selector and amortization preview to loan creation form"
```

---

### Task 8: UI — Loan list and detail page updates

**Files:**
- Modify: `src/app/(app)/loans/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/page.tsx` (and its client component if separate)
- Modify: `src/app/(app)/customers/[id]/page.tsx`

- [ ] **Step 1: Add loan type badge to loan list**

In `src/app/(app)/loans/page.tsx`, add a "Type" column to the loans table. Find the table header row and add:

```tsx
<th className="px-3 py-2 text-left">Type</th>
```

In the table body row, add a badge:

```tsx
<td className="px-3 py-2">
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
    loan.loanType === "fixed_rate"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      : loan.loanType === "reducing_balance"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
  }`}>
    {loan.loanType === "fixed_rate" ? "Fixed Rate" : loan.loanType === "reducing_balance" ? "Reducing Bal." : "Perpetual"}
  </span>
</td>
```

- [ ] **Step 2: Show loan type and term on loan detail page**

In the loan detail page, find where loan info is displayed (principal, interest rate, etc.) and add:

```tsx
<div>
  <span className="text-muted-foreground text-sm">Loan Type</span>
  <p className="font-medium">
    {loan.loanType === "fixed_rate" ? "Fixed Rate" : loan.loanType === "reducing_balance" ? "Reducing Balance" : "Perpetual"}
  </p>
</div>
{loan.termMonths && (
  <div>
    <span className="text-muted-foreground text-sm">Term</span>
    <p className="font-medium">{loan.termMonths} months</p>
  </div>
)}
```

For term loans, also show the amortization schedule. Import `calculateSchedule` and render a table:

```tsx
{loan.loanType !== "perpetual" && loan.termMonths && (
  <div className="mt-4">
    <h3 className="font-semibold mb-2">Amortization Schedule</h3>
    {/* Same schedule table as in Task 7 Step 3, using calculateSchedule() */}
  </div>
)}
```

- [ ] **Step 3: Add loan type badge to customer detail page**

In `src/app/(app)/customers/[id]/page.tsx`, find where loan cards are rendered. Each card shows principal and interest rate. Add a loan type badge:

```tsx
<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
  loan.loanType === "fixed_rate"
    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    : loan.loanType === "reducing_balance"
    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
}`}>
  {loan.loanType === "fixed_rate" ? "Fixed Rate" : loan.loanType === "reducing_balance" ? "Reducing Bal." : "Perpetual"}
</span>
```

- [ ] **Step 4: Verify build**

Run: `npx next build`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/loans/page.tsx src/app/(app)/loans/[loanId]/ src/app/(app)/customers/[id]/page.tsx
git commit -m "feat: show loan type badges and amortization schedule in UI"
```

---

### Task 9: E2E Tests — Cypress tests for loan type flows

**Files:**
- Create: `cypress/e2e/loan-types.cy.ts`

- [ ] **Step 1: Write Cypress E2E tests**

Create `cypress/e2e/loan-types.cy.ts`:

```typescript
describe("Loan Type Abstraction", () => {
  beforeEach(() => {
    cy.login() // assumes custom login command exists
  })

  describe("Loan Creation Form", () => {
    beforeEach(() => {
      cy.visit("/loans/new?customerId=test-customer-id")
    })

    it("defaults to Perpetual loan type", () => {
      cy.get('input[name="loanType"][value="perpetual"]').should("be.checked")
      cy.get("#termMonths").should("not.exist")
    })

    it("shows term months field when Fixed Rate is selected", () => {
      cy.get('input[name="loanType"][value="fixed_rate"]').click()
      cy.get("#termMonths").should("be.visible")
    })

    it("shows term months field when Reducing Balance is selected", () => {
      cy.get('input[name="loanType"][value="reducing_balance"]').click()
      cy.get("#termMonths").should("be.visible")
    })

    it("hides term months when switching back to Perpetual", () => {
      cy.get('input[name="loanType"][value="fixed_rate"]').click()
      cy.get("#termMonths").should("be.visible")
      cy.get('input[name="loanType"][value="perpetual"]').click()
      cy.get("#termMonths").should("not.exist")
    })

    it("hides minInterestDays for non-perpetual types", () => {
      cy.get('input[name="loanType"][value="fixed_rate"]').click()
      cy.get("#minInterestDays").should("not.exist")
    })

    it("shows amortization schedule in review step for fixed rate", () => {
      // Fill step 1
      cy.get('input[name="loanType"][value="fixed_rate"]').click()
      cy.get("#termMonths").type("5")
      cy.get("#principalAmount").clear().type("1000000")
      cy.get("#interestRate").clear().type("10")
      // ... fill other required fields and advance to step 3
      // Verify schedule table is visible
      cy.contains("Amortization Schedule").should("be.visible")
      cy.get("table").should("contain", "Month")
    })
  })

  describe("Loan List", () => {
    it("shows loan type badge in the table", () => {
      cy.visit("/loans")
      cy.get("table").should("contain", "Type")
    })
  })
})
```

- [ ] **Step 2: Run Cypress tests**

Run: `npx cypress run --spec cypress/e2e/loan-types.cy.ts`

Expected: Tests pass (some may need adjustment based on exact selectors after implementation).

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/loan-types.cy.ts
git commit -m "test: add E2E tests for loan type abstraction"
```

---

### Task 10: Update existing tests for backward compatibility

**Files:**
- Modify: `src/services/__tests__/loan.service.test.ts`
- Modify: `src/services/__tests__/payment.service.test.ts`

- [ ] **Step 1: Update mock loan objects to include loanType**

In both test files, find all `mockLoan` or similar objects and add `loanType: "perpetual"` and `termMonths: null` to them. This ensures existing tests pass with the new schema.

For example, in `src/services/__tests__/loan.service.test.ts`, the `mockLoan` around line 39:

```typescript
const mockLoan = {
  id: "loan-1",
  // ... existing fields
  loanType: "perpetual",
  termMonths: null,
}
```

Do the same in `src/services/__tests__/payment.service.test.ts` for any mock loan objects.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/__tests__/
git commit -m "test: update mock objects with loanType for backward compatibility"
```
