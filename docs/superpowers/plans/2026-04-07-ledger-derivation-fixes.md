# Ledger Derivation Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all financial computations derive from the ledger (transactions table) instead of ad-hoc formulas or denormalized columns, fixing correctness bugs and eliminating inconsistencies.

**Architecture:** Add two new ledger query functions (`getInterestEarnedFromLedger`, `getInterestPayableFromLedger`) to `transaction.service.ts`. Then update all call sites (dashboard, daily-collections, portfolio, customer, creditor, simulator, overdue helper, balance summary, creditor accrual cron) to use ledger-derived values. Remove the `principalBalance` column updates from creditor repayment flow.

**Tech Stack:** TypeScript, Drizzle ORM, BigNumber.js, Effect-TS, Vitest

---

### Task 1: Add `getInterestEarnedFromLedger` and `getInterestPayableFromLedger`

Two new batch query functions that mirror the pattern of `getLoanBalancesFromLedger` and `getCreditorBalancesFromLedger`.

**Files:**
- Modify: `src/services/transaction.service.ts:559` (add after existing ledger query functions)

- [ ] **Step 1: Add `getInterestEarnedFromLedger`**

This function queries the ledger for per-loan total interest earned (cash basis). It sums `Interest Earned` category entries grouped by `loanId`. Revenue account: CR adds, DR subtracts.

```typescript
/**
 * Derive per-loan total interest earned (cash basis) from the ledger.
 * Queries "Interest Earned" entries grouped by loanId.
 * Revenue account: CR adds, DR subtracts.
 */
export async function getInterestEarnedFromLedger(
  loanIds: string[]
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const rows = await db
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        inArray(transactions.loanId, loanIds)
      )
    )
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.loanId) continue;
    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Revenue: CR adds, DR subtracts
    balances.set(
      row.loanId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}
```

- [ ] **Step 2: Add `getInterestPayableFromLedger`**

This function queries the ledger for per-investment total interest payable. It sums `Interest Payable` category entries grouped by `referenceId`. Liability account: CR adds, DR subtracts.

```typescript
/**
 * Derive per-investment total interest payable from the ledger.
 * Queries "Interest Payable" entries grouped by referenceId.
 * Liability account: CR adds, DR subtracts.
 */
export async function getInterestPayableFromLedger(
  investmentIds: string[]
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Payable"),
        inArray(transactions.referenceId, investmentIds)
      )
    )
    .groupBy(transactions.referenceId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = balances.get(row.referenceId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.referenceId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "feat: add getInterestEarnedFromLedger and getInterestPayableFromLedger"
```

---

### Task 2: Fix dashboard overdue calc to use ledger balance

The dashboard passes `loan.principalAmount` (original principal) to `computeLoanOverdueInfo` as `outstandingBalance`. For reducing_balance loans, this overstates the monthly interest and thus the overdue days. It should use the ledger-derived balance instead.

**Files:**
- Modify: `src/services/dashboard.service.ts:86-125`

- [ ] **Step 1: Add ledger balance import and batch fetch**

Add import for `getLoanBalancesFromLedger` and fetch balances in the overdue section:

At the top of the file, add to imports:
```typescript
import { getLoanBalancesFromLedger } from "@/services/transaction.service"
```

Remove the existing unused import of `transactions` and `transactionCategories` from the overdue section (they're used in the KPI ledger query above, keep those). Actually — the file uses its own ledger query for KPIs, but we need `getLoanBalancesFromLedger` for per-loan balances in the overdue loop.

Replace lines 91-125 (the overdue calculation section) with:

```typescript
      const loanIds = activeLoans.map((l) => l.id)
      const allPayments =
        loanIds.length > 0
          ? await db
              .select()
              .from(payments)
              .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
              .orderBy(asc(payments.paymentDate))
          : []

      // Batch-fetch per-loan outstanding balances from ledger
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>()
      for (const p of allPayments) {
        const existing = paymentsByLoanId.get(p.loanId) ?? []
        existing.push(p)
        paymentsByLoanId.set(p.loanId, existing)
      }

      let overdueCount = 0

      for (const loan of activeLoans) {
        const loanPayments = paymentsByLoanId.get(loan.id) ?? []
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const ledgerBalance = ledgerBalances.get(loan.id)
        const outstandingBalance = ledgerBalance
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance,
        })
        if (info.daysOverdue >= 30) {
          overdueCount++
        }
      }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Run existing dashboard tests**

Run: `npx vitest run src/services/__tests__/dashboard.service.test.ts 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/services/dashboard.service.ts
git commit -m "fix: dashboard overdue calc uses ledger balance instead of original principal"
```

---

### Task 3: Fix daily-collections overdue calc to use ledger balance

Same bug as dashboard — passes `loan.principalAmount` as `outstandingBalance` to `computeLoanOverdueInfo`.

**Files:**
- Modify: `src/services/daily-collections.service.ts:96-107`

- [ ] **Step 1: Replace the outstandingBalance in the overdue call**

The file already fetches `ledgerBalances` at line 84. Replace lines 99-107:

```typescript
        const ledgerBalance = ledgerBalances.get(loan.id)
        const outstandingBalance = ledgerBalance
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance,
        })
        const daysOverdue = info.daysOverdue
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/daily-collections.service.ts
git commit -m "fix: daily-collections overdue uses ledger balance instead of original principal"
```

---

### Task 4: Fix portfolio report — use outstanding balance for interest calc and use `computeLoanOverdueInfo`

Two bugs: (1) uses `loan.principalAmount` (original) instead of outstanding balance for interest calculation, overstating interest for loans with principal repayments; (2) uses inline `calculateDaysOverdue` instead of the shared `computeLoanOverdueInfo` helper.

**Files:**
- Modify: `src/services/report.service.ts:356-438`

- [ ] **Step 1: Add import for `computeLoanOverdueInfo`**

At the top of `report.service.ts`, add:
```typescript
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
```

Also ensure `getInterestEarnedFromLedger` is imported from `transaction.service`:
```typescript
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/transaction.service"
```

Remove the import of `calculateDaysOverdue` and `calculateDailyRate` from `@/lib/interest/engine` (they should no longer be needed — check if used elsewhere in the file first; if not used elsewhere, remove them).

- [ ] **Step 2: Rewrite the per-loan loop in `getPortfolioData`**

Replace the per-loan loop body (lines 374-428) with code that uses ledger-derived balance for interest calculation and `computeLoanOverdueInfo` for overdue:

```typescript
      // Batch-fetch interest earned from ledger
      const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

      for (const loan of activeLoans) {
        const [customer] = await db
          .select({ fullName: customers.fullName })
          .from(customers)
          .where(eq(customers.id, loan.customerId))

        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Use ledger-derived balance
        const outstandingBalance = ledgerBalances.get(loan.id)
          ?? (loanPayments.at(-1)
            ? new BigNumber(loanPayments.at(-1)!.principalBalanceAfter)
            : new BigNumber(loan.principalAmount))

        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const loanType = (loan.loanType ?? "perpetual") as LoanType

        // Use computeLoanOverdueInfo for consistent overdue calculation
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance: formatAmount(outstandingBalance),
        })

        results.push({
          loanId: loan.id,
          customerName: customer?.fullName ?? "Unknown",
          principalAmount: loan.principalAmount,
          outstandingBalance: formatAmount(outstandingBalance),
          interestAccrued: info.unpaidInterest,
          daysOverdue: String(info.daysOverdue),
          status: loan.status,
          riskFlag: info.daysOverdue >= 30,
        })
      }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Run existing report tests**

Run: `npx vitest run src/services/__tests__/report.service.test.ts 2>&1 | tail -20`
Expected: All pass (may need test updates if mocks need adjusting — fix if needed)

- [ ] **Step 5: Commit**

```bash
git add src/services/report.service.ts
git commit -m "fix: portfolio uses ledger balance for interest calc and computeLoanOverdueInfo for overdue"
```

---

### Task 5: Fix customer service — use ledger balance for overdue calculation

Uses `loan.principalAmount` and inline `calculateDaysOverdue` instead of ledger-derived balance and `computeLoanOverdueInfo`.

**Files:**
- Modify: `src/services/customer.service.ts:110-137`

- [ ] **Step 1: Add imports and batch-fetch ledger balances**

Add imports at top of file:
```typescript
import { getLoanBalancesFromLedger } from "@/services/transaction.service"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import type { LoanType } from "@/types"
```

Remove imports of `calculateInterest`, `calculateDailyRate`, `calculateDaysOverdue` from `@/lib/interest/engine` if they are no longer needed after this change.

- [ ] **Step 2: Replace the overdue computation in the daysRemainingFilter loop**

Replace the inner loop body (lines 110-137) with:

```typescript
          let maxDaysOverdue = 0

          // Batch-fetch ledger balances for this customer's active loans
          const customerLoanIds = activeLoans.map((l) => l.id)
          const customerLedgerBalances = await getLoanBalancesFromLedger(customerLoanIds)

          for (const loan of activeLoans) {
            const loanPayments = await db
              .select()
              .from(payments)
              .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
              .orderBy(asc(payments.paymentDate))

            const effectiveRate = loan.interestRateOverride ?? loan.interestRate
            const ledgerBalance = customerLedgerBalances.get(loan.id)
            const outstandingBalance = ledgerBalance
              ? ledgerBalance.toFixed(2)
              : loan.principalAmount

            const info = computeLoanOverdueInfo({
              principalAmount: loan.principalAmount,
              effectiveRate,
              startDate: new Date(loan.startDate),
              loanType: (loan.loanType ?? "perpetual") as LoanType,
              termMonths: loan.termMonths,
              payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
              outstandingBalance,
            })
            if (info.daysOverdue > maxDaysOverdue) {
              maxDaysOverdue = info.daysOverdue
            }
          }

          const days = maxDaysOverdue
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/services/customer.service.ts
git commit -m "fix: customer service uses ledger balance and computeLoanOverdueInfo for overdue"
```

---

### Task 6: Fix `getLoanBalanceSummary` — derive accrued interest from ledger

Currently computes interest ad-hoc from loan terms + days elapsed. Should use interest already tracked in the ledger (Interest Earned) and combine with the overdue helper for consistency.

**Files:**
- Modify: `src/services/payment.service.ts:29-73`

- [ ] **Step 1: Rewrite `getLoanBalanceSummary` to use `computeLoanOverdueInfo`**

Replace the function body (lines 29-73) with:

```typescript
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

  // Derive outstanding principal from the ledger (single source of truth)
  const ledgerBalance = await getLoanBalanceFromLedger(loanId)
  const outstandingPrincipal = ledgerBalance.isGreaterThan(0)
    ? ledgerBalance.toFixed(2)
    : loan.principalAmount  // Fallback for loans with no ledger entries yet

  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const loanType = loan.loanType ?? "perpetual"

  // Use computeLoanOverdueInfo for consistent interest calculation
  const info = computeLoanOverdueInfo({
    principalAmount: loan.principalAmount,
    effectiveRate,
    startDate: new Date(loan.startDate),
    loanType: loanType as import("@/types").LoanType,
    termMonths: loan.termMonths,
    payments: activePayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
    outstandingBalance: outstandingPrincipal,
  })

  const accruedInterest = info.unpaidInterest
  const totalBalance = new BigNumber(outstandingPrincipal).plus(new BigNumber(accruedInterest)).toFixed(2)

  return { outstandingPrincipal, accruedInterest, totalBalance, loanType }
}
```

- [ ] **Step 2: Add import for `computeLoanOverdueInfo`**

Add at top of file:
```typescript
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
```

Remove unused imports: `calculateInterest` from `@/lib/interest/engine` and `daysBetween` from `@/lib/db/utils` — only if they're not used elsewhere in the file. Check `recordPayment` and `recalculateFromPayment` first (they use `allocatePayment` and `calculateInterest` — so keep `calculateInterest` if still used). Remove `daysBetween` only if unused.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Run existing payment tests**

Run: `npx vitest run src/services/__tests__/payment.service.test.ts 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "fix: getLoanBalanceSummary uses computeLoanOverdueInfo instead of ad-hoc interest calc"
```

---

### Task 7: Fix creditor accrual cron — use ledger balance instead of `principalBalance` column

`accrueInterestForCreditors` reads `investment.principalBalance` (denormalized column) to determine which investments are active and to calculate interest. Should use `getCreditorBalancesFromLedger` instead.

**Files:**
- Modify: `src/services/transaction.service.ts:745-828`

- [ ] **Step 1: Import `getCreditorBalancesFromLedger` and update function**

The function in `transaction.service.ts` can't import from `creditor.service.ts` (would create circular dependency). Move `getCreditorBalancesFromLedger` into `transaction.service.ts` or inline the query. Since `creditor.service.ts` already imports from `transaction.service.ts`, we should move the ledger query function here.

First, copy `getCreditorBalancesFromLedger` from `creditor.service.ts` to `transaction.service.ts` (after the existing `getLoanBalanceFromLedger`):

```typescript
/**
 * Derive per-investment creditor principal balances from the ledger.
 * Creditor Investment is a liability: CR adds, DR subtracts.
 */
export async function getCreditorBalancesFromLedger(
  investmentIds: string[]
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Creditor Investment"),
        inArray(transactions.referenceId, investmentIds)
      )
    )
    .groupBy(transactions.referenceId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = balances.get(row.referenceId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.referenceId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}
```

Then update `creditor.service.ts` to import from `transaction.service.ts` instead of defining its own copy:
```typescript
import { getCreditorBalancesFromLedger } from "@/services/transaction.service"
```

Remove the local `getCreditorBalancesFromLedger` function from `creditor.service.ts`.

- [ ] **Step 2: Update `accrueInterestForCreditors` to use ledger balances**

Replace lines 765-768 of `transaction.service.ts`:

```typescript
      const allInvestments = await db.select().from(creditorInvestments)

      // Use ledger to determine active investments and their balances
      const investmentIds = allInvestments.map((inv) => inv.id)
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds)

      const activeInvestments = allInvestments.filter((inv) => {
        const ledgerBal = ledgerBalances.get(inv.id)
        return ledgerBal ? ledgerBal.isGreaterThan(0) : new BigNumber(inv.principalBalance).isGreaterThan(0)
      })
```

Then update line 784-785 to use ledger balance:

```typescript
        const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance)
        const daysElapsed = accrualDaysBetween(prevDate, asOfDate)
        const interestSinceLastRepayment = calculateInterest(
          formatAmount(principalBalance), investment.interestRateMonthly, daysElapsed, 0
        )
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run src/services/__tests__/transaction.service.test.ts 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/services/transaction.service.ts src/services/creditor.service.ts
git commit -m "fix: creditor accrual cron uses ledger balance instead of principalBalance column"
```

---

### Task 8: Fix creditor repayment — derive balance from ledger instead of column

`recordCreditorRepayment` reads `investment.principalBalance` for allocation and writes it back after repayment. Should use `getCreditorBalancesFromLedger` as the source.

**Files:**
- Modify: `src/services/creditor.service.ts:240-337`

- [ ] **Step 1: Update allocation to use ledger balance**

In `recordCreditorRepayment`, after fetching the investment and existing repayments, add a ledger balance query and use it for allocation:

After line 260 (after fetching `existingRepayments`), add:
```typescript
        // Derive principal balance from ledger
        const ledgerBalances = await getCreditorBalancesFromLedger([input.investmentId]);
        const principalBalance = ledgerBalances.get(input.investmentId) ?? new BigNumber(investment.principalBalance);
        const principalBalanceStr = formatAmount(principalBalance);
```

Then update line 276 to use `principalBalanceStr` instead of `investment.principalBalance`:
```typescript
        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore: principalBalanceStr,
          monthlyRateDecimal: investment.interestRateMonthly,
          daysElapsed,
          minInterestDays: 0,
```

Keep the `principalBalance` column update at lines 296-302 for backward compatibility (it serves as a cache), but the ledger is now the source of truth for allocation.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/creditor.service.ts
git commit -m "fix: creditor repayment allocation uses ledger balance as source of truth"
```

---

### Task 9: Fix SimulatorPanel — accept ledger balance as prop instead of deriving from payments chain

The SimulatorPanel computes `currentOutstanding` from `lastPayment.principalBalanceAfter` and interest from `loan.principalAmount`. It should receive the ledger-derived balance from the server.

**Files:**
- Modify: `src/components/loans/simulator-panel.tsx:21-78`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` (where SimulatorPanel is rendered — pass `ledgerBalance` prop)

- [ ] **Step 1: Add `ledgerBalance` prop to SimulatorPanel**

Update the interface and usage:

```typescript
interface SimulatorPanelProps {
  loan: Loan
  payments: Payment[]
  ledgerBalance: string | null
}

export function SimulatorPanel({ loan, payments, ledgerBalance }: SimulatorPanelProps) {
```

Replace lines 51-53 (currentOutstanding calculation):
```typescript
  const currentOutstanding = ledgerBalance
    ?? (lastPayment ? lastPayment.principalBalanceAfter : loan.principalAmount)
```

Replace lines 61-66 (totalInterestAccrued — use outstanding balance, not original principal):
```typescript
  const totalInterestAccrued = calculateInterest(
    currentOutstanding,
    effectiveRate,
    totalDaysElapsed,
    0
  )
```

- [ ] **Step 2: Update LoanDetailClient to pass `ledgerBalance` to SimulatorPanel**

Find where `SimulatorPanel` is rendered in `loan-detail-client.tsx` and add the prop:

```typescript
<SimulatorPanel
  loan={loan}
  payments={activePayments}
  ledgerBalance={balanceData?.outstandingPrincipal ?? ledgerBalance}
/>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/components/loans/simulator-panel.tsx src/app/\(app\)/loans/\[loanId\]/loan-detail-client.tsx
git commit -m "fix: SimulatorPanel uses ledger balance prop instead of payments chain"
```

---

### Task 10: Fix `accrueInterestForLoans` cron — use ledger for `cashInterestRecognized`

The cron reads `payments.interestPortion` to determine total cash interest recognized. Should query the ledger for `Interest Earned` entries (from payment journal entries, not accrual entries) instead.

**Files:**
- Modify: `src/services/transaction.service.ts:682-696`

- [ ] **Step 1: Replace payments query with ledger query for cash interest**

Replace lines 688-696 (the payments query and cashInterestRecognized calculation):

```typescript
        // Derive total cash interest already recognized from ledger
        // Interest Earned CR entries from payments (not from accruals — those use Interest Receivable)
        const interestEarnedMap = await getInterestEarnedFromLedger([loan.id])
        const totalInterestEarned = interestEarnedMap.get(loan.id) ?? new BigNumber(0)

        // Subtract interest that was recognized via accrual (DR Interest Earned entries are reversals)
        // The net Interest Earned already accounts for both cash and accrual/reversal entries.
        // existingAccrualRows below tracks Interest Receivable, which is the accrual-basis portion.
        // cashInterestRecognized = totalInterestEarned - netExistingAccrual
        // But wait — Interest Earned includes both cash-basis (payment) and accrual entries.
        // The accrual posts CR Interest Earned, and reversal on payment posts DR Interest Earned.
        // So net Interest Earned = cash interest only (since accrual + reversal cancel out).
        // Therefore: cashInterestRecognized = totalInterestEarned
        const cashInterestRecognized = totalInterestEarned
```

Actually, let me re-examine the logic. The existing code computes:
- `totalInterestAccrued` = formula from loan terms
- `cashInterestRecognized` = sum of `payments.interestPortion`
- `netExistingAccrual` = net Interest Receivable DR entries
- `target` = `totalInterestAccrued - cashInterestRecognized - netExistingAccrual`

The ledger's net `Interest Earned` (CR - DR) already equals `cashInterestRecognized + netExistingAccrual` because:
- Payment posts CR Interest Earned (cash recognition)
- Accrual posts CR Interest Earned
- Reversal of accrual posts DR Interest Earned

So `totalInterestEarned = cashInterestRecognized + netExistingAccrual`, meaning `target = totalInterestAccrued - totalInterestEarned`. This simplifies the logic:

Replace lines 688-713 with:

```typescript
        // Net Interest Earned from ledger = cash interest + accruals - reversals
        const interestEarnedMap = await getInterestEarnedFromLedger([loan.id])
        const totalInterestEarned = interestEarnedMap.get(loan.id) ?? new BigNumber(0)

        const target = totalInterestAccrued.minus(totalInterestEarned)
```

Remove the `existingAccrualRows` query and `netExistingAccrual` computation — they're no longer needed since `totalInterestEarned` from the ledger already accounts for both cash and accrual entries.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "fix: loan interest accrual cron uses ledger instead of payments.interestPortion"
```

---

### Task 11: Update tests to reflect new ledger-derived patterns

Update existing tests that mock the payment chain or ad-hoc interest calculations to instead mock the new ledger query functions.

**Files:**
- Modify: `src/services/__tests__/dashboard.service.test.ts`
- Modify: `src/services/__tests__/report.service.test.ts`
- Modify: `src/services/__tests__/payment.service.test.ts`

- [ ] **Step 1: Update dashboard tests**

The dashboard test needs to mock `getLoanBalancesFromLedger` since the overdue section now calls it. Add the mock:

```typescript
vi.mock("@/services/transaction.service", () => ({
  getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
}))
```

Update any test assertions that verify `outstandingBalance` values to use ledger-derived values.

- [ ] **Step 2: Update report tests**

The report test needs to mock both `getLoanBalancesFromLedger` and `getInterestEarnedFromLedger`:

```typescript
vi.mock("@/services/transaction.service", () => ({
  getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
  getInterestEarnedFromLedger: vi.fn().mockResolvedValue(new Map()),
}))
```

- [ ] **Step 3: Update payment service tests**

The payment test needs to ensure `computeLoanOverdueInfo` is properly called/mocked if `getLoanBalanceSummary` tests exist.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/services/__tests__/
git commit -m "test: update mocks for ledger-derived balance and interest queries"
```

---

### Task 12: Final verification — build and full test suite

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All pass

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type/test issues from ledger derivation migration"
```
