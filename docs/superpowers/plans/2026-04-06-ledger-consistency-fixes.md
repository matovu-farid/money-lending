# Ledger Consistency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 ledger consistency issues: rollover principal transfer gap, inconsistent outstanding balance sources, duplicated balance logic, and divergent overdue formulas.

**Architecture:** All fixes are in the service/action layer. Fix 1 adds a missing journal entry in `loan.service.ts`. Fix 2 replaces direct payment-table reads with `getLoanBalancesFromLedger()`. Fix 3 extracts shared balance logic into `payment.service.ts`. Fix 4 replaces the simple "days since last payment" heuristic with the interest-based `calculateDaysOverdue()` formula used everywhere else, renaming `LoanDueToday.daysSinceLastPayment` to `daysOverdue`.

**Tech Stack:** TypeScript, Drizzle ORM, Effect, BigNumber.js, Vitest

---

### Task 1: Fix rollover principal transfer — missing ledger entry

**Files:**
- Modify: `src/services/loan.service.ts:135-172` (rollover block in `createLoan`)
- Modify: `src/services/__tests__/loan.service.test.ts`

When a loan rolls over, the carried principal has no ledger transfer from old loan to new loan. The old loan's "Loans Receivable" stays inflated and the new loan's is understated by `carriedPrincipal`. We need to add a journal entry: DR Loans Receivable (new loan) / CR Loans Receivable (old loan).

- [ ] **Step 1: Write the failing test**

In `src/services/__tests__/loan.service.test.ts`, add a test that verifies `postJournalEntry` is called with the rollover principal transfer. Find the existing rollover test (or add one) and assert the call:

```typescript
it("posts principal transfer journal entry on rollover", async () => {
  const rolloverInput = {
    ...baseLoanInput,
    rollover: {
      fromLoanId: "old-loan-1",
      carriedPrincipal: "400000.00",
      carriedInterest: "50000.00",
    },
  }

  // Mock the existing active loan lookup
  const existingLoan = {
    ...mockLoan,
    id: "old-loan-1",
    status: "active",
  }

  // Setup mocks for the transaction flow
  mockedDb.transaction.mockImplementation(async (fn: any) => {
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockLoan]) }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingLoan]),
        }),
      }),
    }
    return fn(tx)
  })

  // Need to mock the outer select for customer completeness check
  mockedDb.select.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ ...baseCustomer }]),
      }),
    }),
  })

  const { postJournalEntry } = await import("@/services/transaction.service")

  await Effect.runPromise(createLoan(rolloverInput, "actor-1"))

  // Verify the carried principal transfer entry was posted
  expect(postJournalEntry).toHaveBeenCalledWith(
    expect.anything(), // tx
    expect.objectContaining({
      debitCategory: { name: "Loans Receivable", type: "asset" },
      creditCategory: { name: "Loans Receivable", type: "asset" },
      amount: "400000.00",
      referenceType: "rollover",
      loanId: expect.any(String), // new loan id
      description: expect.stringContaining("rolled over"),
    })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/services/__tests__/loan.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `postJournalEntry` is not called with the rollover principal transfer params.

- [ ] **Step 3: Add the rollover principal transfer journal entry**

In `src/services/loan.service.ts`, inside the rollover block (after the carried interest journal entry at ~line 149, before the old loan status update at ~line 153), add:

```typescript
          // Transfer carried principal from old loan to new loan on the ledger
          if (new BigNumber(input.rollover.carriedPrincipal).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: input.rollover.carriedPrincipal,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              description: `Principal transferred - loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()} rolled over into ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              loanId: loan.id,
            })
            // Reverse the old loan's Loans Receivable by the carried principal
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: input.rollover.carriedPrincipal,
              referenceType: "rollover",
              referenceId: loan.id,
              description: `Principal closed - loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()} rolled into ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              loanId: existingActiveLoan.id,
            })
          }
```

Wait — the `postJournalEntry` creates BOTH a debit and a credit row. We need a single entry where the debit side tags `loanId = newLoan.id` and the credit side tags `loanId = oldLoan.id`. But `postJournalEntry` only accepts a single `loanId`. So we need **two** journal entries that net out correctly:

1. Credit Loans Receivable on old loan (reduce old loan's balance)
2. Debit Loans Receivable on new loan (increase new loan's balance)

The cleanest approach: post two separate entries using a manual insert pattern, since `postJournalEntry` applies the same `loanId` to both sides. Actually, let's use the simpler approach — the credit side of entry 1 and debit side of entry 2 hitting a wash account. But that's overengineered.

**Simpler correct approach:** Use two `postJournalEntry` calls. The first reduces the old loan's receivable (DR Cash placeholder → CR Loans Receivable, oldLoanId). The second increases the new loan's receivable (DR Loans Receivable → CR Cash placeholder, newLoanId). But this moves Cash which is wrong.

**Correct approach:** We need to add per-side loanId support to `postJournalEntry`, OR do raw inserts. Since the system already has this limitation, the simplest fix is two raw insert pairs with the same `journalGroupId`:

```typescript
          // Transfer carried principal from old loan to new loan on the ledger
          // This requires per-side loanId (debit on new loan, credit on old loan),
          // so we insert the journal pair directly.
          if (new BigNumber(input.rollover.carriedPrincipal).isGreaterThan(0)) {
            const { randomUUID } = await import("crypto")
            const transferGroupId = randomUUID()
            const loansReceivableId = await getOrCreateCategory(tx, "Loans Receivable", "asset")

            // DR Loans Receivable (new loan) — increases new loan's balance
            await tx.insert(transactions).values({
              type: "debit",
              amount: input.rollover.carriedPrincipal,
              categoryId: loansReceivableId,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              loanId: loan.id,
              description: `Principal carried from loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              journalGroupId: transferGroupId,
            })

            // CR Loans Receivable (old loan) — decreases old loan's balance
            await tx.insert(transactions).values({
              type: "credit",
              amount: input.rollover.carriedPrincipal,
              categoryId: loansReceivableId,
              referenceType: "rollover",
              referenceId: loan.id,
              loanId: existingActiveLoan.id,
              description: `Principal transferred to loan ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              journalGroupId: transferGroupId,
            })
          }
```

But wait — `getOrCreateCategory` is not exported from `transaction.service.ts`. It's a private helper. We need to either export it or use `postJournalEntry` in a creative way.

Looking at the code again: `postJournalEntry` applies the same `loanId` to both the debit and credit rows. For a rollover principal transfer, we need the debit tagged to the new loan and the credit tagged to the old loan. So we need a new helper.

**Final approach:** Add a new `postRolloverPrincipalTransfer` function in `transaction.service.ts` that handles this special case. This keeps the raw insert logic inside the transaction service where it belongs.

In `src/services/transaction.service.ts`, add after `autoPostPrincipalDisbursement`:

```typescript
export async function autoPostRolloverPrincipalTransfer(
  tx: DrizzleTransaction,
  params: {
    amount: string
    newLoanId: string
    oldLoanId: string
    transactionDate: Date
    actorId: string
  }
): Promise<void> {
  const journalGroupId = randomUUID()
  const categoryId = await getOrCreateCategory(tx, "Loans Receivable", "asset")

  // DR Loans Receivable (new loan) — increases new loan's receivable
  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.oldLoanId,
    loanId: params.newLoanId,
    description: `Principal carried from loan ${params.oldLoanId.slice(0, 8).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })

  // CR Loans Receivable (old loan) — decreases old loan's receivable
  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.newLoanId,
    loanId: params.oldLoanId,
    description: `Principal transferred to loan ${params.newLoanId.slice(0, 8).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })
}
```

Then in `src/services/loan.service.ts`, import `autoPostRolloverPrincipalTransfer` and call it in the rollover block:

```typescript
import { autoPostPrincipalDisbursement, autoPostRolloverPrincipalTransfer, postJournalEntry } from "./transaction.service"
```

Then after the carried interest journal entry (~line 150), add:

```typescript
          // Transfer carried principal from old loan to new loan on the ledger
          if (new BigNumber(input.rollover.carriedPrincipal).isGreaterThan(0)) {
            await autoPostRolloverPrincipalTransfer(tx, {
              amount: input.rollover.carriedPrincipal,
              newLoanId: loan.id,
              oldLoanId: existingActiveLoan.id,
              transactionDate: startDate,
              actorId,
            })
          }
```

- [ ] **Step 4: Update the test mock to include the new function**

In `src/services/__tests__/loan.service.test.ts`, update the mock for `@/services/transaction.service`:

```typescript
vi.mock("@/services/transaction.service", () => ({
  postJournalEntry: vi.fn().mockResolvedValue("mock-journal-group-id"),
  autoPostPrincipalDisbursement: vi.fn().mockResolvedValue(undefined),
  autoPostRolloverPrincipalTransfer: vi.fn().mockResolvedValue(undefined),
}))
```

And update the test assertion to check `autoPostRolloverPrincipalTransfer` instead of `postJournalEntry`:

```typescript
  const { autoPostRolloverPrincipalTransfer } = await import("@/services/transaction.service")

  expect(autoPostRolloverPrincipalTransfer).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      amount: "400000.00",
      newLoanId: expect.any(String),
      oldLoanId: "old-loan-1",
    })
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/services/__tests__/loan.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/transaction.service.ts src/services/loan.service.ts src/services/__tests__/loan.service.test.ts
git commit -m "fix: add rollover principal transfer journal entry between old and new loan"
```

---

### Task 2: Consolidate duplicated balance logic into a shared function

**Files:**
- Modify: `src/services/payment.service.ts` (add `getLoanBalanceSummary`)
- Modify: `src/actions/payment.actions.ts:235-298` (simplify `getLoanBalanceAction`)
- Modify: `src/app/(app)/loans/[loanId]/payments/new/page.tsx:48-81` (use shared function)
- Modify: `src/services/__tests__/payment.service.test.ts`

The balance computation (outstanding principal from last payment + accrued interest by loan type + total balance) is duplicated between `getLoanBalanceAction` and the `RecordPaymentPage` server component. Extract into a single function.

- [ ] **Step 1: Write the failing test**

In `src/services/__tests__/payment.service.test.ts`, add a test for the new `getLoanBalanceSummary` function:

```typescript
describe("getLoanBalanceSummary", () => {
  it("returns outstanding principal, accrued interest, and total balance for a perpetual loan", async () => {
    // Mock: loan with one payment
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "loan-1",
          principalAmount: "500000.00",
          interestRate: "0.10",
          interestRateOverride: null,
          minInterestDays: 30,
          minPeriodOverride: null,
          startDate: new Date("2026-03-01"),
          loanType: "perpetual",
          termMonths: null,
        }]),
      }),
    })
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([{
            principalBalanceAfter: "400000.00",
            paymentDate: new Date("2026-03-15"),
          }]),
        }),
      }),
    })

    const result = await getLoanBalanceSummary("loan-1")
    expect(result).toEqual(expect.objectContaining({
      outstandingPrincipal: "400000.00",
      loanType: "perpetual",
    }))
    expect(parseFloat(result.accruedInterest)).toBeGreaterThan(0)
    expect(parseFloat(result.totalBalance)).toBeGreaterThan(400000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/services/__tests__/payment.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `getLoanBalanceSummary` is not exported.

- [ ] **Step 3: Implement `getLoanBalanceSummary` in `payment.service.ts`**

Add at the bottom of `src/services/payment.service.ts`:

```typescript
/**
 * Compute the current balance summary for a loan: outstanding principal,
 * accrued interest, and total balance. Single source of truth used by
 * both the payment recording page and the quick-record dialog.
 */
export async function getLoanBalanceSummary(loanId: string): Promise<{
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
  loanType: string
}> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new LoanNotFound({ id: loanId })

  const activePayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

  const outstandingPrincipal =
    activePayments.length === 0
      ? loan.principalAmount
      : activePayments[activePayments.length - 1].principalBalanceAfter

  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays
  const loanType = loan.loanType ?? "perpetual"

  const prevDate =
    activePayments.length === 0
      ? new Date(loan.startDate)
      : new Date(activePayments[activePayments.length - 1].paymentDate)
  const daysElapsed = daysBetween(prevDate, new Date())

  let accruedInterest: string
  if (loanType === "perpetual") {
    accruedInterest = calculateInterest(outstandingPrincipal, effectiveRate, daysElapsed, minInterestDays).toFixed(2)
  } else if (loanType === "fixed_rate") {
    accruedInterest = new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(effectiveRate)).toFixed(2)
  } else {
    // reducing_balance
    accruedInterest = new BigNumber(outstandingPrincipal).multipliedBy(new BigNumber(effectiveRate)).toFixed(2)
  }

  const totalBalance = new BigNumber(outstandingPrincipal).plus(new BigNumber(accruedInterest)).toFixed(2)

  return { outstandingPrincipal, accruedInterest, totalBalance, loanType }
}
```

Ensure these imports exist at the top of `payment.service.ts` (add any missing ones):
- `import { calculateInterest } from "@/lib/interest/engine"`
- `import { daysBetween } from "@/lib/db/utils"`
- `import BigNumber from "bignumber.js"`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/services/__tests__/payment.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Refactor `getLoanBalanceAction` to use `getLoanBalanceSummary`**

In `src/actions/payment.actions.ts`, replace lines 235-298 with:

```typescript
export async function getLoanBalanceAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  if (!loanId?.trim()) {
    return { error: "Loan ID is required" }
  }

  try {
    const data = await getLoanBalanceSummary(loanId)
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

Update the imports at the top of the file:
- Add: `import { getLoanBalanceSummary } from "@/services/payment.service"` (add to existing import)
- Remove unused imports: `calculateInterest`, `daysBetween`, `BigNumber`, `asc` (if no longer used elsewhere — check first)

- [ ] **Step 6: Refactor `RecordPaymentPage` to use `getLoanBalanceSummary`**

In `src/app/(app)/loans/[loanId]/payments/new/page.tsx`, replace the manual balance computation (lines ~48-81) with:

```typescript
import { getLoanBalanceSummary } from "@/services/payment.service"
```

Replace the payment query + balance computation block with:

```typescript
  const balanceData = await getLoanBalanceSummary(loanId)
```

Remove unused imports: `payments`, `asc`, `isNull`, `calculateInterest`, `daysBetween`, `BigNumber`.

The final page component should look like:

```typescript
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import { getLoanBalanceSummary } from "@/services/payment.service"
import { RecordPaymentForm } from "./record-payment-form"

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params

  const [row] = await db
    .select({
      id: loans.id,
      principalAmount: loans.principalAmount,
      customerName: customers.fullName,
      loanType: loans.loanType,
      termMonths: loans.termMonths,
    })
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(eq(loans.id, loanId))

  if (!row) notFound()

  const balanceData = await getLoanBalanceSummary(loanId)
  const loanReference = row.id.slice(0, 8).toUpperCase()

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerName={row.customerName}
      loanReference={loanReference}
      balanceData={balanceData}
    />
  )
}
```

- [ ] **Step 7: Run all tests and type check**

Run: `pnpm exec vitest run src/services/__tests__/payment.service.test.ts --reporter=verbose 2>&1 | tail -20`
Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: PASS, no type errors

- [ ] **Step 8: Commit**

```bash
git add src/services/payment.service.ts src/actions/payment.actions.ts src/app/\(app\)/loans/\[loanId\]/payments/new/page.tsx src/services/__tests__/payment.service.test.ts
git commit -m "refactor: consolidate duplicated balance logic into getLoanBalanceSummary"
```

---

### Task 3: Unify outstanding balance source — use ledger instead of payments table

**Files:**
- Modify: `src/actions/loan.actions.ts:243-343` (`computeOverdue` function)
- Modify: `src/services/daily-collections.service.ts:52-106` (`getLoansDueToday`)
- Modify: `src/types/index.ts:390-398` (`LoanDueToday` type)

Both `computeOverdue` in loan.actions.ts and `getLoansDueToday` in daily-collections.service.ts read `lastPayment.principalBalanceAfter` for outstanding balance. Both should use `getLoanBalancesFromLedger()` instead, which is already used by the portfolio report and dashboard.

- [ ] **Step 1: Update `computeOverdue` to use ledger balances**

In `src/actions/loan.actions.ts`, add import:

```typescript
import { getLoanBalancesFromLedger } from "@/services/transaction.service"
```

In the `computeOverdue` function, after batch-fetching payments (~line 254), add a ledger balance lookup:

```typescript
  // Derive outstanding balances from the ledger (single source of truth)
  const ledgerBalances = await getLoanBalancesFromLedger(loanIds)
```

Then in the `.map()` loop, replace:

```typescript
      let outstandingBalance = loan.principalAmount
      // ...
      const lastPayment = loanPayments.at(-1)
      if (lastPayment) {
        outstandingBalance = lastPayment.principalBalanceAfter
        lastPaymentDate = lastPayment.paymentDate
      }
```

With:

```typescript
      const ledgerBalance = ledgerBalances.get(loan.id)
      let outstandingBalance = ledgerBalance
        ? ledgerBalance.toFixed(2)
        : loan.principalAmount

      const lastPayment = loanPayments.at(-1)
      let lastPaymentDate: Date | null = lastPayment ? lastPayment.paymentDate : null
```

- [ ] **Step 2: Rewrite `getLoansDueToday` to use ledger + batch queries**

Replace `src/services/daily-collections.service.ts` `getLoansDueToday` (lines 52-106) entirely. This also fixes the N+1 query problem:

```typescript
export const getLoansDueToday = (): Effect.Effect<LoanDueToday[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          startDate: loans.startDate,
          interestRate: loans.interestRate,
          interestRateOverride: loans.interestRateOverride,
          loanType: loans.loanType,
          customerName: customers.fullName,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      if (activeLoans.length === 0) return []

      const loanIds = activeLoans.map((l) => l.id)

      // Batch-fetch payments and ledger balances
      const allPayments = await db
        .select()
        .from(payments)
        .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate))

      const { getLoanBalancesFromLedger } = await import("@/services/transaction.service")
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>()
      for (const p of allPayments) {
        const existing = paymentsByLoanId.get(p.loanId) ?? []
        existing.push(p)
        paymentsByLoanId.set(p.loanId, existing)
      }

      const now = new Date()
      const results: LoanDueToday[] = []

      for (const loan of activeLoans) {
        const loanPayments = paymentsByLoanId.get(loan.id) ?? []
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )
        const totalInterestAccrued = calculateInterest(
          loan.principalAmount, effectiveRate, totalDaysElapsed, 0
        )
        const totalInterestPaid = loanPayments.reduce(
          (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
        )
        const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(
          calculateDailyRate(effectiveRate)
        )
        const daysOverdueBN = calculateDaysOverdue(
          totalInterestAccrued, totalInterestPaid, dailyInterestAmount
        )
        const daysOverdue = Math.floor(daysOverdueBN.toNumber())

        if (daysOverdue >= 30) {
          const ledgerBalance = ledgerBalances.get(loan.id)
          const outstandingBalance = ledgerBalance
            ? ledgerBalance.toFixed(2)
            : loan.principalAmount

          const lastPayment = loanPayments.at(-1)

          results.push({
            loanId: loan.id,
            customerId: loan.customerId,
            customerName: loan.customerName,
            loanAmount: loan.principalAmount,
            outstandingBalance,
            daysOverdue,
            lastPaymentDate: lastPayment ? new Date(lastPayment.paymentDate) : null,
          })
        }
      }

      results.sort((a, b) => b.daysOverdue - a.daysOverdue)
      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

Add these imports at the top of `daily-collections.service.ts`:

```typescript
import { inArray } from "drizzle-orm"
import { calculateInterest, calculateDailyRate, calculateDaysOverdue } from "@/lib/interest/engine"
```

- [ ] **Step 3: Update `LoanDueToday` type**

In `src/types/index.ts`, replace the `LoanDueToday` interface:

```typescript
export interface LoanDueToday {
  loanId: string
  customerId: string
  customerName: string
  loanAmount: string
  outstandingBalance: string
  daysOverdue: number
  lastPaymentDate: Date | null
}
```

The field `daysSinceLastPayment` is renamed to `daysOverdue` since we now use interest-based overdue calculation.

- [ ] **Step 4: Update the UI component that reads `daysSinceLastPayment`**

In `src/app/(app)/payments/DailyCollectionsTab.tsx`, find `loan.daysSinceLastPayment` and replace with `loan.daysOverdue`:

```typescript
// Line 290 (approx):
<OverdueBadge daysOverdue={loan.daysOverdue} />
```

Also check for any other references to `daysSinceLastPayment` in this file and update them.

- [ ] **Step 5: Run type check and fix any remaining references**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -40`

Fix any remaining references to `daysSinceLastPayment` that the type checker catches.

- [ ] **Step 6: Run all tests**

Run: `pnpm exec vitest run --reporter=verbose 2>&1 | tail -30`
Expected: PASS (some daily-collections tests may need mock updates)

- [ ] **Step 7: Commit**

```bash
git add src/actions/loan.actions.ts src/services/daily-collections.service.ts src/types/index.ts src/app/\(app\)/payments/DailyCollectionsTab.tsx
git commit -m "fix: unify outstanding balance to use ledger, replace days-since-payment with interest-based overdue"
```

---

### Task 4: Unify overdue formula across dashboard, loans page, and daily collections

**Files:**
- Create: `src/lib/interest/overdue.ts` (shared overdue computation helper)
- Modify: `src/services/dashboard.service.ts:86-132` (use shared helper)
- Modify: `src/actions/loan.actions.ts:265-340` (use shared helper in `computeOverdue`)

The dashboard and loans page both compute overdue independently with slightly different code. Extract a shared `computeLoanOverdueInfo` function that both callers use.

- [ ] **Step 1: Create the shared overdue helper**

Create `src/lib/interest/overdue.ts`:

```typescript
import BigNumber from "bignumber.js"
import { calculateInterest, calculateDailyRate, calculateDaysOverdue, calculateSchedule } from "./engine"
import type { LoanType, ScheduleEntry } from "@/types"

export interface LoanOverdueInfo {
  daysOverdue: number
  dailyRate: string
  unpaidInterest: string
}

/**
 * Compute overdue info for a single loan given its terms and payment history.
 * Single source of truth — used by dashboard, loans page, and daily collections.
 */
export function computeLoanOverdueInfo(params: {
  principalAmount: string
  effectiveRate: string
  startDate: Date
  loanType: LoanType
  termMonths: number | null
  payments: { interestPortion: string; paymentDate: Date }[]
  outstandingBalance: string
  asOf?: Date
}): LoanOverdueInfo {
  const now = params.asOf ?? new Date()
  const { principalAmount, effectiveRate, startDate, loanType, termMonths, payments, outstandingBalance } = params

  if (loanType === "perpetual" || !loanType) {
    const totalDaysElapsed = Math.floor(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    const totalInterestAccrued = calculateInterest(principalAmount, effectiveRate, totalDaysElapsed, 0)
    const dailyRateBN = calculateDailyRate(effectiveRate)
    const dailyInterestAmount = new BigNumber(principalAmount).multipliedBy(dailyRateBN)
    const totalInterestPaid = payments.reduce(
      (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
    )
    const unpaidInterestBN = totalInterestAccrued.minus(totalInterestPaid)
    const daysOverdueBN = calculateDaysOverdue(totalInterestAccrued, totalInterestPaid, dailyInterestAmount)

    return {
      daysOverdue: Math.floor(daysOverdueBN.toNumber()),
      dailyRate: dailyInterestAmount.toFixed(2),
      unpaidInterest: BigNumber.max(unpaidInterestBN, 0).toFixed(2),
    }
  }

  // Term loans (fixed_rate, reducing_balance)
  const monthsElapsed = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
  )
  const expectedPayments = Math.min(monthsElapsed, termMonths ?? 0)
  const actualPayments = payments.length
  const missedPayments = Math.max(expectedPayments - actualPayments, 0)
  const daysOverdue = missedPayments * 30

  const monthlyInterest = loanType === "fixed_rate"
    ? new BigNumber(principalAmount).multipliedBy(new BigNumber(effectiveRate))
    : new BigNumber(outstandingBalance).multipliedBy(new BigNumber(effectiveRate))
  const dailyRate = monthlyInterest.dividedBy(30).toFixed(2)

  const totalInterestPaid = payments.reduce(
    (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
  )
  const schedule = calculateSchedule(
    principalAmount,
    effectiveRate,
    termMonths!,
    loanType as "fixed_rate" | "reducing_balance"
  )
  const expectedInterest = schedule
    .slice(0, expectedPayments)
    .reduce((s: BigNumber, e: ScheduleEntry) => s.plus(new BigNumber(e.monthlyInterest)), new BigNumber(0))
  const unpaidInterestBN = expectedInterest.minus(totalInterestPaid)

  return {
    daysOverdue,
    dailyRate,
    unpaidInterest: BigNumber.max(unpaidInterestBN, 0).toFixed(2),
  }
}
```

- [ ] **Step 2: Export from the interest barrel**

Check if `src/lib/interest/index.ts` exists and add the export. If it doesn't exist, add it to wherever the interest module is re-exported from. The engine is imported as `@/lib/interest/engine`, so add a direct import path:

```typescript
// In whatever file re-exports from @/lib/interest:
export { computeLoanOverdueInfo } from "./overdue"
export type { LoanOverdueInfo } from "./overdue"
```

- [ ] **Step 3: Refactor dashboard overdue computation**

In `src/services/dashboard.service.ts`, replace lines 86-132 (the overdue counting loop). Add import:

```typescript
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
```

Replace the overdue loop:

```typescript
      let overdueCount = 0

      for (const loan of activeLoans) {
        const loanPayments = paymentsByLoanId.get(loan.id) ?? []
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance: loan.principalAmount, // for term loan monthly interest calc
        })
        if (info.daysOverdue >= 30) {
          overdueCount++
        }
      }
```

Remove the now-unused imports: `calculateInterest`, `calculateDailyRate`, `calculateDaysOverdue` (if they're not used elsewhere in the file).

- [ ] **Step 4: Refactor `computeOverdue` in loan.actions.ts**

In `src/actions/loan.actions.ts`, add import:

```typescript
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
```

Replace the overdue computation inside the `.map()` loop (the `if (loan.status === "active")` block) with:

```typescript
      if (loan.status === "active") {
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const ledgerBalance = ledgerBalances.get(loan.id)
        const balanceForCalc = ledgerBalance ? ledgerBalance.toFixed(2) : loan.principalAmount

        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance: balanceForCalc,
        })
        daysOverdue = info.daysOverdue
        dailyRate = info.dailyRate
        unpaidInterest = info.unpaidInterest
      }
```

Remove unused imports: `calculateDaysOverdue`, `calculateDailyRate`, `calculateInterest`, `calculateSchedule` (check if used elsewhere first).

- [ ] **Step 5: Run type check**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Run all tests**

Run: `pnpm exec vitest run --reporter=verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/interest/overdue.ts src/services/dashboard.service.ts src/actions/loan.actions.ts
git commit -m "refactor: unify overdue formula into shared computeLoanOverdueInfo helper"
```

---

### Task 5: Final verification — run full test suite and type check

- [ ] **Step 1: Run full test suite**

Run: `pnpm exec vitest run --reporter=verbose 2>&1 | tail -40`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Verify no regressions in test files**

Run: `pnpm exec vitest run src/services/__tests__/ --reporter=verbose 2>&1 | tail -40`
Expected: All service tests pass

- [ ] **Step 4: Final commit if any fixups needed**

If any test fixes were needed, commit them:
```bash
git add -u
git commit -m "fix: test adjustments for ledger consistency refactor"
```
