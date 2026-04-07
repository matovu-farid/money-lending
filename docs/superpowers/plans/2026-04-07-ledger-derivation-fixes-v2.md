# Ledger Derivation Fixes v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all remaining non-ledger data sources so every financial calculation derives from the transactions table.

**Architecture:** The `computeLoanOverdueInfo` function currently accepts `payments.interestPortion` from callers — change it to accept `totalInterestPaid` as a pre-computed BigNumber string, and have all callers pass the ledger-derived value from `getInterestEarnedFromLedger`. For `recordPayment`, promote the ledger cross-check to be the authoritative source. For `accrueInterestForLoans`, use `getLoanBalancesFromLedger` instead of `loan.principalAmount`. Fix creditor dual-write and add creditor interest accrual reversal. Fix all zero-balance fallbacks.

**Tech Stack:** TypeScript, Drizzle ORM, BigNumber.js, Effect

---

### Task 1: Change `computeLoanOverdueInfo` to accept `totalInterestPaid` instead of `payments[]`

The function currently sums `payments.interestPortion` internally. Change it to accept a pre-computed `totalInterestPaid` string so callers pass the ledger-derived value.

**Files:**
- Modify: `src/lib/interest/overdue.ts`

- [ ] **Step 1: Change the function signature and body**

Replace the `payments` parameter with `totalInterestPaid` and remove internal summing:

```typescript
// In the params type, replace:
//   payments: { interestPortion: string; paymentDate: Date }[]
// With:
//   totalInterestPaid: string

// In the perpetual branch (line 35-37), replace:
//   const totalInterestPaid = payments.reduce(
//     (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
//   )
// With:
//   const totalInterestPaidBN = new BigNumber(totalInterestPaid)
// And update references from totalInterestPaid to totalInterestPaidBN

// In the term loan branch (line 62-64), same replacement
```

The `payments.length` usage on line 53 (`const actualPayments = payments.length`) needs a new parameter `paymentCount: number`.

- [ ] **Step 2: Commit**

```bash
git add src/lib/interest/overdue.ts
git commit -m "refactor: computeLoanOverdueInfo accepts totalInterestPaid instead of payments array"
```

---

### Task 2: Update all `computeLoanOverdueInfo` callers to pass ledger-derived `totalInterestPaid`

Every caller currently passes `payments.map(p => ({ interestPortion: p.interestPortion, ... }))`. Change them to use `getInterestEarnedFromLedger`.

**Files:**
- Modify: `src/services/dashboard.service.ts` (line ~127)
- Modify: `src/services/daily-collections.service.ts` (line ~109)
- Modify: `src/services/customer.service.ts` (line ~134)
- Modify: `src/services/report.service.ts` (line ~395)
- Modify: `src/services/payment.service.ts` (`getLoanBalanceSummary`, line ~55)
- Modify: `src/actions/loan.actions.ts` (`computeOverdue`, line ~287)

- [ ] **Step 1: Update `dashboard.service.ts`**

The dashboard already batch-fetches loanIds. Add a batch call to `getInterestEarnedFromLedger` and pass the result:

```typescript
// Add import
import { getInterestEarnedFromLedger } from "./transaction.service"

// After the existing getLoanBalancesFromLedger call (line ~110), add:
const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

// In the loop (line ~121-129), change:
//   payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
//   paymentCount: loanPayments.length,
```

- [ ] **Step 2: Update `loan.actions.ts` (`computeOverdue`)**

```typescript
// Add import
import { getInterestEarnedFromLedger } from "@/services/transaction.service"

// After getLoanBalancesFromLedger call (line ~266), add:
const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

// In the loop (line ~287-295), change:
//   payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
//   paymentCount: loanPayments.length,
```

- [ ] **Step 3: Update `daily-collections.service.ts`**

```typescript
// Add import
import { getInterestEarnedFromLedger } from "./transaction.service"

// After getLoanBalancesFromLedger call, add:
const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

// In the loop (line ~103-111), change:
//   payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
//   paymentCount: loanPayments.length,
```

- [ ] **Step 4: Update `customer.service.ts`**

```typescript
// Add import
import { getInterestEarnedFromLedger } from "./transaction.service"

// Before the customer loop, batch-fetch interest earned for all active loans:
const customerLoanIds = activeLoans.map((l) => l.id)
const interestEarnedMap = await getInterestEarnedFromLedger(customerLoanIds)

// In the loop (line ~128-136), change:
//   payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
//   paymentCount: loanPayments.length,
```

- [ ] **Step 5: Update `report.service.ts` (`getPortfolioData`)**

The function already calls `getInterestEarnedFromLedger` but doesn't pass the result to `computeLoanOverdueInfo`. Wire it through:

```typescript
// The interestEarnedMap is already fetched at line ~366. In the loop (line ~395-403), change:
//   payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
//   paymentCount: loanPayments.length,
```

- [ ] **Step 6: Update `payment.service.ts` (`getLoanBalanceSummary`)**

```typescript
// Add import for getInterestEarnedFromLedger (already imports from transaction.service)
import { ..., getInterestEarnedFromLedger } from "./transaction.service"

// After the ledgerBalance call (line ~46), add:
const interestEarnedMap = await getInterestEarnedFromLedger([loanId])

// In the computeLoanOverdueInfo call (line ~55-63), change:
//   payments: activePayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
// To:
//   totalInterestPaid: formatAmount(interestEarnedMap.get(loanId) ?? new BigNumber(0)),
//   paymentCount: activePayments.length,
```

- [ ] **Step 7: Commit**

```bash
git add src/services/dashboard.service.ts src/actions/loan.actions.ts src/services/daily-collections.service.ts src/services/customer.service.ts src/services/report.service.ts src/services/payment.service.ts
git commit -m "fix: all computeLoanOverdueInfo callers use ledger-derived totalInterestPaid"
```

---

### Task 3: Fix `recordPayment` to use ledger balance as authoritative `principalBalanceBefore`

Currently the payments chain is authoritative and the ledger is a cross-check. Flip this.

**Files:**
- Modify: `src/services/payment.service.ts` (lines 253-268)

- [ ] **Step 1: Make ledger balance authoritative in `recordPayment`**

Replace lines 253-268 with:

```typescript
        // Derive principalBalanceBefore from the ledger (single source of truth)
        const ledgerBalance = await getLoanBalanceFromLedger(input.loanId)
        const principalBalanceBefore = ledgerBalance.isGreaterThan(0)
          ? ledgerBalance.toFixed(2)
          : activePayments.length === 0
            ? loan.principalAmount
            : activePayments[activePayments.length - 1].principalBalanceAfter
```

This uses the ledger as primary, falling back to the payments chain only when the ledger has no entries (brand-new loan with no disbursement posted yet — shouldn't happen but safe fallback).

- [ ] **Step 2: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "fix: recordPayment uses ledger balance as authoritative principalBalanceBefore"
```

---

### Task 4: Fix `accrueInterestForLoans` to use ledger-derived outstanding balance

Currently uses `loan.principalAmount` (original principal) which overstates interest for partially-repaid loans.

**Files:**
- Modify: `src/services/transaction.service.ts` (line ~814)

- [ ] **Step 1: Batch-fetch ledger balances and use them for accrual**

Before the loan loop (after line ~806), add:

```typescript
      const loanIds = activeLoans.map((l) => l.id)
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)
```

Replace line 814:
```typescript
        const totalInterestAccrued = calculateInterest(loan.principalAmount, effectiveRate, totalDaysElapsed, 0)
```
With:
```typescript
        const outstandingBalance = ledgerBalances.get(loan.id)
        const principalForAccrual = outstandingBalance && outstandingBalance.isGreaterThan(0)
          ? formatAmount(outstandingBalance)
          : loan.principalAmount
        const totalInterestAccrued = calculateInterest(principalForAccrual, effectiveRate, totalDaysElapsed, 0)
```

- [ ] **Step 2: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "fix: accrueInterestForLoans uses ledger-derived outstanding balance instead of original principal"
```

---

### Task 5: Fix overdue cron to use ledger-derived data

Currently reads `payments.interestPortion` directly and uses `loan.principalAmount` for interest calc.

**Files:**
- Modify: `src/app/api/cron/overdue/route.ts`

- [ ] **Step 1: Rewrite the cron to use ledger functions**

Replace the entire loan-processing loop with code that uses `computeLoanOverdueInfo` with ledger data:

```typescript
import { type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { eq, and, isNull, asc } from "drizzle-orm"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/transaction.service"
import { createNotificationsForLoan } from "@/services/notification.service"
import { formatAmount } from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import type { LoanType } from "@/types"

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const activeLoans = await db
      .select()
      .from(loans)
      .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

    const now = new Date()
    const results: { loanId: string; daysOverdue: string }[] = []
    const alertResults: { loanId: string; daysUntilDue: number }[] = []

    const targetUsersResult = await db.execute(
      sql`SELECT id FROM "user" WHERE role IN ('admin', 'loanOfficer', 'superAdmin')`
    )
    const targetUserIds = (targetUsersResult as unknown as Array<{ id: string }>).map(
      (r) => r.id
    )

    // Batch-fetch ledger data
    const loanIds = activeLoans.map((l) => l.id)
    const ledgerBalances = await getLoanBalancesFromLedger(loanIds)
    const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

    // Batch-fetch payments for payment count and last payment date
    const allPayments = loanIds.length > 0
      ? await db
          .select()
          .from(payments)
          .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))
      : []

    const paymentsByLoan = new Map<string, (typeof allPayments)[number][]>()
    for (const p of allPayments) {
      const list = paymentsByLoan.get(p.loanId) ?? []
      list.push(p)
      paymentsByLoan.set(p.loanId, list)
    }

    for (const loan of activeLoans) {
      try {
        const loanPayments = paymentsByLoan.get(loan.id) ?? []
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const ledgerBalance = ledgerBalances.get(loan.id)
        const outstandingBalance = ledgerBalance && ledgerBalance.isGreaterThan(0)
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount

        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
          paymentCount: loanPayments.length,
          outstandingBalance,
        })

        if (info.daysOverdue >= 30) {
          results.push({
            loanId: loan.id,
            daysOverdue: String(info.daysOverdue),
          })
        }

        const lastPayment = loanPayments.at(-1)
        const referenceDate = lastPayment
          ? new Date(lastPayment.paymentDate)
          : new Date(loan.startDate)

        const nextDueDate = new Date(referenceDate)
        nextDueDate.setDate(nextDueDate.getDate() + 30)

        const daysUntilDue = Math.floor(
          (nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysUntilDue >= 0 && daysUntilDue <= 5) {
          const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, loan.customerId))

          const message = `Loan for ${customer?.fullName ?? "Unknown"} — due in ${daysUntilDue} days`

          await createNotificationsForLoan(
            loan.id,
            message,
            nextDueDate,
            targetUserIds
          )

          alertResults.push({ loanId: loan.id, daysUntilDue })
        }
      } catch (err) {
        console.error(`[Cron] Failed to process loan ${loan.id}:`, err)
      }
    }

    return Response.json({
      processed: activeLoans.length,
      flagged: results.length,
      flaggedLoans: results,
      alerts: alertResults.length,
      alertedLoans: alertResults,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error("[Cron] Overdue detection failed:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/overdue/route.ts
git commit -m "fix: overdue cron uses ledger-derived balances and interest instead of payments table"
```

---

### Task 6: Remove `creditorInvestments.principalBalance` dual-write

Stop writing to the cached column on repayment. Remove fallbacks to it.

**Files:**
- Modify: `src/services/creditor.service.ts` (lines ~256-262, ~358, ~458, ~880)

- [ ] **Step 1: Remove the `principalBalance` update in `recordCreditorRepayment`**

Delete lines 256-262 (the `tx.update(creditorInvestments).set({ principalBalance: ... })` call).

- [ ] **Step 2: Remove fallback to `investment.principalBalance` in `getCreditorDashboard`**

Change line 358:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance);
```
To:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);
```

Using `investment.amount` (original amount) as fallback when no ledger entries exist is correct — it means no repayments have been posted yet.

- [ ] **Step 3: Same fix in `getSystemCapital`**

Change line ~458:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance);
```
To:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);
```

- [ ] **Step 4: Same fix in `accrueInterestForCreditors`**

Change line ~880 in `transaction.service.ts`:
```typescript
return ledgerBal ? ledgerBal.isGreaterThan(0) : new BigNumber(inv.principalBalance).isGreaterThan(0)
```
To:
```typescript
return ledgerBal ? ledgerBal.isGreaterThan(0) : true  // No ledger entries = full amount outstanding
```

And change line ~896:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance)
```
To:
```typescript
const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/creditor.service.ts src/services/transaction.service.ts
git commit -m "fix: remove creditorInvestments.principalBalance dual-write, derive exclusively from ledger"
```

---

### Task 7: Add creditor interest accrual reversal on repayment

The loan side has `reverseInterestAccrual` that reverses outstanding accruals when a cash payment comes in. The creditor side needs the same.

**Files:**
- Modify: `src/services/transaction.service.ts` (add `reverseCreditorInterestAccrual`)
- Modify: `src/services/creditor.service.ts` (call it in `recordCreditorRepayment`)

- [ ] **Step 1: Add `reverseCreditorInterestAccrual` in `transaction.service.ts`**

Add after the existing `reverseInterestAccrual` function (after line ~776):

```typescript
/**
 * Reverse outstanding creditor interest accrual entries (Interest Payable)
 * when a cash repayment is recorded. Mirrors reverseInterestAccrual for loans.
 */
export async function reverseCreditorInterestAccrual(
  tx: DrizzleTransaction,
  params: {
    investmentId: string
    repaymentDate: string
    actorId: string
  }
): Promise<void> {
  const [payableCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Payable"),
        eq(transactionCategories.type, "expense")
      )
    )

  if (!payableCat) return

  const [expenseCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Payments"),
        eq(transactionCategories.type, "expense")
      )
    )

  if (!expenseCat) return

  const accrualRows = await tx
    .select({ amount: transactions.amount, type: transactions.type })
    .from(transactions)
    .where(
      and(
        eq(transactions.referenceType, "interest_accrual"),
        eq(transactions.referenceId, params.investmentId),
        eq(transactions.categoryId, payableCat.id)
      )
    )

  let netAccrual = new BigNumber(0)
  for (const row of accrualRows) {
    if (row.type === "credit") {
      netAccrual = netAccrual.plus(row.amount)
    } else {
      netAccrual = netAccrual.minus(row.amount)
    }
  }

  if (netAccrual.isLessThanOrEqualTo(0)) return

  const reversalAmount = formatAmount(netAccrual)
  const now = new Date(params.repaymentDate)

  await tx.insert(transactions).values({
    type: "debit",
    amount: reversalAmount,
    categoryId: payableCat.id,
    referenceType: "interest_accrual",
    referenceId: params.investmentId,
    description: `Reverse creditor interest accrual on repayment - investment ${params.investmentId}`,
    transactionDate: now,
    recordedBy: params.actorId,
  })

  await tx.insert(transactions).values({
    type: "credit",
    amount: reversalAmount,
    categoryId: expenseCat.id,
    referenceType: "interest_accrual",
    referenceId: params.investmentId,
    description: `Reverse creditor interest accrual on repayment - investment ${params.investmentId}`,
    transactionDate: now,
    recordedBy: params.actorId,
  })
}
```

- [ ] **Step 2: Call it in `recordCreditorRepayment`**

In `creditor.service.ts`, add import:
```typescript
import { ..., reverseCreditorInterestAccrual } from "@/services/transaction.service"
```

In `recordCreditorRepayment`, before the `autoPostInterestExpense` call (line ~275), add:
```typescript
        // Reverse any outstanding creditor interest accrual before posting cash-basis expense
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await reverseCreditorInterestAccrual(tx, {
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
          })
        }
```

Move this BEFORE the existing interest expense posting block (lines 275-283).

- [ ] **Step 3: Commit**

```bash
git add src/services/transaction.service.ts src/services/creditor.service.ts
git commit -m "fix: add creditor interest accrual reversal on repayment, matching loan-side pattern"
```

---

### Task 8: Fix zero-ledger-balance fallback patterns

Multiple locations treat a zero ledger balance as "use original principal" which masks fully-paid loans. The correct fallback is: if the ledger returns zero AND the loan has no ledger entries at all, use `principalAmount`; otherwise zero means zero.

The current `getLoanBalanceFromLedger` already returns `BigNumber(0)` for both "no entries" and "zero balance". The callers do `ledgerBalance.isGreaterThan(0) ? ... : loan.principalAmount` which conflates these. Fix: treat `BigNumber(0)` from the ledger as correct — the only case where we need `principalAmount` is a brand-new loan whose disbursement hasn't been posted. Since disbursement is always posted on creation, this shouldn't happen. Remove the fallbacks.

**Files:**
- Modify: `src/services/payment.service.ts` (`getLoanBalanceSummary`, line ~47-49)
- Modify: `src/services/collateral-settlement.service.ts` (lines ~116-118, ~234-236)
- Modify: `src/services/dashboard.service.ts` (lines ~118-120)
- Modify: `src/services/customer.service.ts` (lines ~124-126)
- Modify: `src/services/daily-collections.service.ts` (lines ~100-102)
- Modify: `src/actions/loan.actions.ts` (lines ~276-278)
- Modify: `src/services/report.service.ts` (lines ~386-389)

- [ ] **Step 1: Fix all fallback patterns**

In each file, change the pattern:
```typescript
const outstandingBalance = ledgerBalance.isGreaterThan(0)
  ? ledgerBalance.toFixed(2)
  : loan.principalAmount
```
To:
```typescript
const outstandingBalance = ledgerBalance.isZero()
  ? loan.principalAmount  // No ledger entries yet (pre-disbursement)
  : ledgerBalance.toFixed(2)
```

Wait — this is the same logic. The real fix is simpler: just use the ledger value directly. If it's zero, the loan is fully paid and that's correct. The only edge case is a loan whose disbursement journal hasn't been posted, which should never happen in normal flow.

Change to:
```typescript
const outstandingBalance = ledgerBalance.toFixed(2)
```

But we need a safety net. The safest approach: check if any ledger entries exist for this loan. If none exist, fall back. The batch function `getLoanBalancesFromLedger` already returns entries only for loans that HAVE transactions. So we can check `ledgerBalances.has(loan.id)`:

For batch callers (dashboard, loan.actions, daily-collections, customer, report):
```typescript
const ledgerBalance = ledgerBalances.get(loan.id)
const outstandingBalance = ledgerBalance !== undefined
  ? ledgerBalance.toFixed(2)
  : loan.principalAmount  // No ledger entries yet
```

For single callers (payment.service getLoanBalanceSummary, collateral-settlement):
Keep as-is since `getLoanBalanceFromLedger` returns `BigNumber(0)` for no entries and we can't distinguish. These are acceptable because:
- `getLoanBalanceSummary` is only called for active loans (always have entries)
- Collateral settlement checks `loan.status === "active"` first

- [ ] **Step 2: Fix batch callers**

In `dashboard.service.ts` (line ~118-120):
```typescript
const ledgerBalance = ledgerBalances.get(loan.id)
const outstandingBalance = ledgerBalance !== undefined
  ? ledgerBalance.toFixed(2)
  : loan.principalAmount
```

Same pattern in: `loan.actions.ts`, `daily-collections.service.ts`, `customer.service.ts`.

In `report.service.ts` (line ~386-389), simplify:
```typescript
const outstandingBalance = ledgerBalances.get(loan.id)
  ?? new BigNumber(loan.principalAmount)
```

- [ ] **Step 3: Commit**

```bash
git add src/services/dashboard.service.ts src/actions/loan.actions.ts src/services/daily-collections.service.ts src/services/customer.service.ts src/services/report.service.ts
git commit -m "fix: zero-ledger-balance fallbacks distinguish 'no entries' from 'zero balance'"
```

---

### Task 9: Update tests to match new `computeLoanOverdueInfo` signature

Tests that mock `computeLoanOverdueInfo` need updated mock signatures.

**Files:**
- Modify: `src/services/__tests__/payment.service.test.ts`
- Modify: `src/services/__tests__/dashboard.service.test.ts`
- Modify: `src/services/__tests__/report.service.test.ts`

- [ ] **Step 1: Update mock signatures in all test files**

The mock factory for `@/lib/interest/overdue` needs to accept the new params:

```typescript
vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn().mockReturnValue({ daysOverdue: 0, dailyRate: "0", unpaidInterest: "0" }),
}))
```

This mock just returns a value regardless of params, so it will work without changes. But any test that inspects the args passed to `computeLoanOverdueInfo` needs to check for `totalInterestPaid` and `paymentCount` instead of `payments`.

Check each test file and update assertions on mock call args if they exist.

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/services/__tests__/payment.service.test.ts src/services/__tests__/dashboard.service.test.ts src/services/__tests__/report.service.test.ts
```

- [ ] **Step 3: Fix any failures and commit**

```bash
git add src/services/__tests__/
git commit -m "test: update computeLoanOverdueInfo mocks for new signature"
```

---

### Task 10: Verify all changes compile and tests pass

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit if any fixes needed**
