# Ledger as Single Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cached financial columns from payments/creditor_repayments tables and derive all values from the ledger (transactions table), fixing several bugs along the way.

**Architecture:** Add `getPaymentPortionsFromLedger()` and `getCreditorRepaymentPortionsFromLedger()` helpers that query journal entries by `referenceId`. Update all read paths to use these. Simplify write paths by removing the `recalculateFromPayment` chain. Fix collateral settlement double-counting, `markPaymentWrong` missing ledger reversal, and Active Loans Total Amount bug.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Effect, Vitest, Next.js Server Components

---

### Task 1: Add `getPaymentPortionsFromLedger` helper

**Files:**
- Modify: `src/services/transaction.service.ts`
- Test: `src/services/__tests__/transaction.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/__tests__/transaction.service.test.ts`:

```typescript
describe("getPaymentPortionsFromLedger", () => {
  it("returns interest and principal portions per payment from ledger entries", async () => {
    const { getPaymentPortionsFromLedger } = await import("@/services/transaction.service")
    // Mock transactions for two payments
    const mockRows = [
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "credit", total: "50000.00" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "100000.00" },
      { referenceId: "pay-2", categoryName: "Interest Earned", txType: "credit", total: "40000.00" },
      { referenceId: "pay-2", categoryName: "Loans Receivable", txType: "credit", total: "60000.00" },
    ]
    const { db: mockedDb } = await import("@/lib/db")
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue(mockRows),
          }),
        }),
      }),
    })

    const result = await getPaymentPortionsFromLedger(["pay-1", "pay-2"])

    expect(result.get("pay-1")).toEqual({ interestPortion: "50000.00", principalPortion: "100000.00" })
    expect(result.get("pay-2")).toEqual({ interestPortion: "40000.00", principalPortion: "60000.00" })
  })

  it("returns empty map for empty input", async () => {
    const { getPaymentPortionsFromLedger } = await import("@/services/transaction.service")
    const result = await getPaymentPortionsFromLedger([])
    expect(result.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/transaction.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `getPaymentPortionsFromLedger` is not exported

- [ ] **Step 3: Write the implementation**

Add to `src/services/transaction.service.ts`:

```typescript
/**
 * Derive per-payment interest and principal portions from ledger journal entries.
 * Queries transactions where referenceType = 'payment' grouped by referenceId.
 * Interest = credits to "Interest Earned" (net of reversals).
 * Principal = credits to "Loans Receivable" (net of reversals).
 */
export async function getPaymentPortionsFromLedger(
  paymentIds: string[]
): Promise<Map<string, { interestPortion: string; principalPortion: string }>> {
  if (paymentIds.length === 0) return new Map()

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
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
        inArray(transactions.referenceId, paymentIds),
        sql`${transactions.referenceType} IN ('payment', 'payment_reversal')`,
        sql`${transactionCategories.name} IN ('Interest Earned', 'Loans Receivable')`
      )
    )
    .groupBy(transactions.referenceId, transactionCategories.name, transactions.type)

  const result = new Map<string, { interestPortion: BigNumber; principalPortion: BigNumber }>()

  for (const row of rows) {
    const refId = row.referenceId
    if (!refId) continue
    const entry = result.get(refId) ?? { interestPortion: new BigNumber(0), principalPortion: new BigNumber(0) }
    const amount = new BigNumber(row.total)

    if (row.categoryName === "Interest Earned") {
      // Revenue: CR adds, DR subtracts
      entry.interestPortion = row.txType === "credit"
        ? entry.interestPortion.plus(amount)
        : entry.interestPortion.minus(amount)
    } else if (row.categoryName === "Loans Receivable") {
      // Asset being credited = principal repaid: CR adds to principal portion
      entry.principalPortion = row.txType === "credit"
        ? entry.principalPortion.plus(amount)
        : entry.principalPortion.minus(amount)
    }

    result.set(refId, entry)
  }

  // Convert to string map
  const stringResult = new Map<string, { interestPortion: string; principalPortion: string }>()
  for (const [id, entry] of result) {
    stringResult.set(id, {
      interestPortion: entry.interestPortion.toFixed(2),
      principalPortion: entry.principalPortion.toFixed(2),
    })
  }
  return stringResult
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/transaction.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/transaction.service.ts src/services/__tests__/transaction.service.test.ts
git commit -m "feat: add getPaymentPortionsFromLedger helper to derive payment splits from ledger"
```

---

### Task 2: Add `getCreditorRepaymentPortionsFromLedger` helper

**Files:**
- Modify: `src/services/transaction.service.ts`
- Test: `src/services/__tests__/transaction.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/__tests__/transaction.service.test.ts`:

```typescript
describe("getCreditorRepaymentPortionsFromLedger", () => {
  it("returns interest and principal portions per repayment from ledger entries", async () => {
    const { getCreditorRepaymentPortionsFromLedger } = await import("@/services/transaction.service")
    const mockRows = [
      { referenceId: "rep-1", categoryName: "Interest Payments", txType: "debit", total: "20000.00" },
      { referenceId: "rep-1", categoryName: "Creditor Investment", txType: "debit", total: "80000.00" },
    ]
    const { db: mockedDb } = await import("@/lib/db")
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue(mockRows),
          }),
        }),
      }),
    })

    const result = await getCreditorRepaymentPortionsFromLedger(["rep-1"])
    expect(result.get("rep-1")).toEqual({ interestPortion: "20000.00", principalPortion: "80000.00" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/transaction.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

Add to `src/services/transaction.service.ts`:

```typescript
/**
 * Derive per-creditor-repayment interest and principal portions from ledger.
 * Interest = debits to "Interest Payments" (expense account).
 * Principal = debits to "Creditor Investment" (liability decrease).
 */
export async function getCreditorRepaymentPortionsFromLedger(
  repaymentIds: string[]
): Promise<Map<string, { interestPortion: string; principalPortion: string }>> {
  if (repaymentIds.length === 0) return new Map()

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
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
        inArray(transactions.referenceId, repaymentIds),
        eq(transactions.referenceType, "creditor_repayment"),
        sql`${transactionCategories.name} IN ('Interest Payments', 'Creditor Investment')`
      )
    )
    .groupBy(transactions.referenceId, transactionCategories.name, transactions.type)

  const result = new Map<string, { interestPortion: BigNumber; principalPortion: BigNumber }>()

  for (const row of rows) {
    const refId = row.referenceId
    if (!refId) continue
    const entry = result.get(refId) ?? { interestPortion: new BigNumber(0), principalPortion: new BigNumber(0) }
    const amount = new BigNumber(row.total)

    if (row.categoryName === "Interest Payments") {
      // Expense: DR adds
      entry.interestPortion = row.txType === "debit"
        ? entry.interestPortion.plus(amount)
        : entry.interestPortion.minus(amount)
    } else if (row.categoryName === "Creditor Investment") {
      // Liability DR = decrease = principal repaid
      entry.principalPortion = row.txType === "debit"
        ? entry.principalPortion.plus(amount)
        : entry.principalPortion.minus(amount)
    }

    result.set(refId, entry)
  }

  const stringResult = new Map<string, { interestPortion: string; principalPortion: string }>()
  for (const [id, entry] of result) {
    stringResult.set(id, {
      interestPortion: entry.interestPortion.toFixed(2),
      principalPortion: entry.principalPortion.toFixed(2),
    })
  }
  return stringResult
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/transaction.service.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/transaction.service.ts src/services/__tests__/transaction.service.test.ts
git commit -m "feat: add getCreditorRepaymentPortionsFromLedger helper"
```

---

### Task 3: Fix collateral settlement double-counting (HIGH bug)

**Files:**
- Modify: `src/services/collateral-settlement.service.ts`

- [ ] **Step 1: Add `reverseInterestAccrual` call before posting interest earned**

In `src/services/collateral-settlement.service.ts`, update the import to include `reverseInterestAccrual`:

```typescript
import { postJournalEntry, autoPostPrincipalRecovery, getLoanBalanceFromLedger, reverseInterestAccrual } from "@/services/transaction.service"
```

Then inside `settleWithCollateral`, before the interest journal entry (before line 133), add:

```typescript
        // Reverse any outstanding interest accrual before posting settlement interest
        if (accruedInterest.isGreaterThan(0)) {
          await reverseInterestAccrual(tx, {
            loanId: input.loanId,
            paymentDate: now.toISOString(),
            actorId,
          })
        }
```

The existing `if (accruedInterest.isGreaterThan(0))` block at line 133 stays as-is — it posts the settlement interest earned. The reversal happens first to avoid double-counting with any month-end accrual entries.

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: PASS — no test changes needed, this is additive behavior.

- [ ] **Step 3: Commit**

```bash
git add src/services/collateral-settlement.service.ts
git commit -m "fix: reverse outstanding interest accrual before collateral settlement to prevent double-counting"
```

---

### Task 4: Fix Active Loans "Total Amount" bug (MEDIUM)

**Files:**
- Modify: `src/app/(app)/reports/active-loans/ActiveLoansClient.tsx`

- [ ] **Step 1: Fix the calculation**

In `src/app/(app)/reports/active-loans/ActiveLoansClient.tsx`, change line 64 from:

```tsx
        const total = new BigNumber(row.principalAmount).plus(
          new BigNumber(row.unpaidInterest)
        )
```

to:

```tsx
        const total = new BigNumber(row.outstandingBalance).plus(
          new BigNumber(row.unpaidInterest)
        )
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/reports/active-loans/ActiveLoansClient.tsx
git commit -m "fix: Active Loans Total Amount uses outstandingBalance instead of original principalAmount"
```

---

### Task 5: Fix `markPaymentWrong` / `unmarkPaymentWrong` to reverse/repost ledger entries

**Files:**
- Modify: `src/actions/payment.actions.ts`

- [ ] **Step 1: Update imports**

In `src/actions/payment.actions.ts`, add the ledger imports:

```typescript
import { getPaymentPortionsFromLedger, postJournalEntry, autoPostInterestEarned, autoPostPrincipalRepayment, reverseInterestAccrual, getLoanBalanceFromLedger } from "@/services/transaction.service"
import { allocatePayment } from "@/lib/interest/engine"
import { loans } from "@/lib/db/schema/loans"
import BigNumber from "bignumber.js"
import { daysBetween } from "@/lib/db/utils"
```

- [ ] **Step 2: Update `markPaymentWrongAction` to reverse journals**

Replace the `markPaymentWrongAction` function body (after the permission check and payment fetch) with:

```typescript
    // Reverse ledger entries for this payment
    const portions = await getPaymentPortionsFromLedger([paymentId])
    const portion = portions.get(paymentId)

    await db.transaction(async (tx) => {
      // Mark the payment as wrong
      await tx
        .update(payments)
        .set({
          markedWrong: true,
          markedWrongReason: reason.trim(),
          markedWrongBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId))

      // Reverse interest journal if any
      if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
        await postJournalEntry(tx, {
          debitCategory: { name: "Interest Earned", type: "revenue" },
          creditCategory: { name: "Cash", type: "asset" },
          amount: portion.interestPortion,
          referenceType: "payment_reversal",
          referenceId: paymentId,
          description: `Reversal - payment ${paymentId} marked wrong: ${reason.trim()}`,
          transactionDate: new Date(payment.paymentDate),
          recordedBy: session.user.id,
          creditDepositLocation: payment.depositLocation ?? undefined,
          loanId: payment.loanId,
        })
      }

      // Reverse principal journal if any
      if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
        await postJournalEntry(tx, {
          debitCategory: { name: "Loans Receivable", type: "asset" },
          creditCategory: { name: "Cash", type: "asset" },
          amount: portion.principalPortion,
          referenceType: "payment_reversal",
          referenceId: paymentId,
          description: `Reversal - principal ${paymentId} marked wrong: ${reason.trim()}`,
          transactionDate: new Date(payment.paymentDate),
          recordedBy: session.user.id,
          creditDepositLocation: payment.depositLocation ?? undefined,
          loanId: payment.loanId,
        })
      }

      // Check if loan should revert from fully_paid to active
      const ledgerBalance = await getLoanBalanceFromLedger(payment.loanId)
      if (ledgerBalance.isGreaterThan(0)) {
        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (loan?.status === "fully_paid") {
          await tx.update(loans).set({ status: "active", updatedAt: new Date() }).where(eq(loans.id, payment.loanId))
        }
      }
    })

    const [updated] = await db.select().from(payments).where(eq(payments.id, paymentId))

    revalidatePath("/payments")
    revalidatePath(`/loans/${payment.loanId}`)

    return { data: updated }
```

- [ ] **Step 3: Update `unmarkPaymentWrongAction` to repost journals**

Replace the `unmarkPaymentWrongAction` function body (after the permission check and payment fetch) with:

```typescript
    await db.transaction(async (tx) => {
      // Unmark the payment
      await tx
        .update(payments)
        .set({
          markedWrong: false,
          markedWrongReason: null,
          markedWrongBy: null,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId))

      // Recompute the allocation for this payment
      const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
      if (!loan) return

      const activePayments = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

      const paymentIdx = activePayments.findIndex((p) => p.id === paymentId)
      const prevDate = paymentIdx === 0
        ? new Date(loan.startDate)
        : new Date(activePayments[paymentIdx - 1].paymentDate)
      const daysElapsed = daysBetween(prevDate, new Date(payment.paymentDate))

      const ledgerBalance = await getLoanBalanceFromLedger(payment.loanId)
      const principalBalanceBefore = ledgerBalance.isGreaterThan(0)
        ? ledgerBalance.toFixed(2)
        : loan.principalAmount

      const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
      const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

      const allocation = allocatePayment({
        paymentAmount: payment.amount,
        principalBalanceBefore,
        monthlyRateDecimal,
        daysElapsed,
        minInterestDays,
        loanType: loan.loanType ?? "perpetual",
        originalPrincipal: loan.principalAmount,
        termMonths: loan.termMonths ?? undefined,
        paymentNumber: paymentIdx + 1,
      })

      // Repost interest journal
      if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
        await reverseInterestAccrual(tx, {
          loanId: payment.loanId,
          paymentDate: new Date(payment.paymentDate).toISOString(),
          actorId: session.user.id,
        })
        await autoPostInterestEarned(tx, {
          amount: allocation.interestPortion,
          loanId: payment.loanId,
          paymentId,
          paymentDate: new Date(payment.paymentDate).toISOString(),
          actorId: session.user.id,
          depositLocation: payment.depositLocation ?? undefined,
        })
      }

      // Repost principal journal
      if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
        await autoPostPrincipalRepayment(tx, {
          amount: allocation.principalPortion,
          loanId: payment.loanId,
          paymentId,
          paymentDate: new Date(payment.paymentDate).toISOString(),
          actorId: session.user.id,
          depositLocation: payment.depositLocation ?? undefined,
        })
      }

      // Check if loan should be marked fully_paid
      const newBalance = await getLoanBalanceFromLedger(payment.loanId)
      if (newBalance.isZero()) {
        await tx.update(loans).set({ status: "fully_paid", updatedAt: new Date() }).where(eq(loans.id, payment.loanId))
      }
    })

    const [updated] = await db.select().from(payments).where(eq(payments.id, paymentId))

    revalidatePath("/payments")
    revalidatePath(`/loans/${payment.loanId}`)

    return { data: updated }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/actions/payment.actions.ts
git commit -m "fix: markPaymentWrong/unmarkPaymentWrong now reverse/repost ledger entries"
```

---

### Task 6: Remove cached columns from payments schema

**Files:**
- Modify: `src/lib/db/schema/payments.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Remove the 4 cached columns from the schema**

In `src/lib/db/schema/payments.ts`, remove these 4 lines:

```typescript
  interestPortion: numeric("interest_portion", { precision: 15, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 15, scale: 2 }).notNull(),
  principalBalanceBefore: numeric("principal_balance_before", { precision: 15, scale: 2 }).notNull(),
  principalBalanceAfter: numeric("principal_balance_after", { precision: 15, scale: 2 }).notNull(),
```

- [ ] **Step 2: Update `PaymentWithCustomer` type**

In `src/types/index.ts`, the `PaymentWithCustomer` interface currently has `interestPortion`, `principalPortion`, `principalBalanceAfter`. These are now derived from the ledger at query time. Keep them in the interface (the UI still needs them) but they'll be populated by the service layer:

```typescript
export interface PaymentWithCustomer {
  id: string
  loanId: string
  customerId: string
  customerName: string
  paymentDate: Date
  amount: string
  interestPortion: string    // derived from ledger at query time
  principalPortion: string   // derived from ledger at query time
  principalBalanceAfter: string // computed running balance from ledger
  recordedBy: string
  depositLocation: DepositLocation
  createdAt: Date
}
```

This type stays the same structurally — just add comments noting the derivation source.

- [ ] **Step 3: Update `DailyCollectionRow` type**

In `src/types/index.ts`, `DailyCollectionRow` keeps its shape — same fields, derived from ledger. Add comments:

```typescript
export interface DailyCollectionRow {
  paymentId: string
  loanId: string
  customerName: string
  amount: string
  interestPortion: string    // derived from ledger
  principalPortion: string   // derived from ledger
  paymentDate: Date
  depositLocation: DepositLocation
}
```

- [ ] **Step 4: Commit (will have compile errors — those are fixed in subsequent tasks)**

```bash
git add src/lib/db/schema/payments.ts src/types/index.ts
git commit -m "refactor: remove cached financial columns from payments schema"
```

---

### Task 7: Update `recordPayment` — stop writing cached columns

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Remove cached columns from the insert**

In `recordPayment`, change the `.values()` call (around line 310-320) from:

```typescript
        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
            depositLocation: input.depositLocation,
          })
          .returning()
```

to:

```typescript
        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            recordedBy: actorId,
            depositLocation: input.depositLocation,
          })
          .returning()
```

- [ ] **Step 2: Change fully-paid check to use ledger balance**

Replace the existing fully-paid check (around line 323-328):

```typescript
        if (allocation.loanFullyPaid) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        }
```

with a ledger-based check AFTER the journal entries are posted (move it after the `autoPostPrincipalRepayment` block, around line 365):

```typescript
        // Check if loan is fully paid based on ledger balance
        const postPaymentBalance = await getLoanBalanceFromLedger(input.loanId)
        if (postPaymentBalance.isZero()) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        }
```

- [ ] **Step 3: Update the return type**

The `recordPayment` function returns `Payment` which is `InferSelectModel<typeof payments>`. Since the schema no longer has the cached columns, the return type automatically excludes them. However, callers may need the allocation for display (e.g., the receipt). Change the return to include allocation data:

Add a return type at the end of the transaction:

```typescript
        return { ...newPayment, allocation }
```

And update the Effect generic type from `Effect.Effect<Payment, ...>` to `Effect.Effect<Payment & { allocation: { interestPortion: string; principalPortion: string; principalBalanceBefore: string; principalBalanceAfter: string } }, ...>`.

- [ ] **Step 4: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "refactor: recordPayment stops writing cached columns, uses ledger for fully-paid check"
```

---

### Task 8: Simplify `editPayment` — remove chain recalculation

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Rewrite `editPayment`**

Replace the entire `editPayment` function with a simplified version that:
1. Reverses old journals using `getPaymentPortionsFromLedger`
2. Recomputes allocation with new amount/date
3. Posts new journals
4. Checks ledger for fully-paid status
5. No `recalculateFromPayment`, no `reconcileDownstreamJournals`, no cross-check

```typescript
export const editPayment = (
  input: EditPaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId }

        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

        const newAmount = input.amount ?? payment.amount
        const newPaymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date(payment.paymentDate)

        // L2: Reject zero or negative payment amounts
        if (new BigNumber(newAmount).isLessThanOrEqualTo(0)) {
          throw { _tag: "ValidationError", message: "Payment amount must be greater than zero", field: "amount" }
        }

        // L1: Reject payments dated before the loan start date
        if (newPaymentDate < new Date(loan.startDate)) {
          throw { _tag: "ValidationError", message: "Payment date cannot be before loan start date", field: "paymentDate" }
        }

        // Reverse old journals for this payment
        const oldPortions = await getPaymentPortionsFromLedger([input.paymentId])
        const oldPortion = oldPortions.get(input.paymentId)

        if (oldPortion && new BigNumber(oldPortion.interestPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        if (oldPortion && new BigNumber(oldPortion.principalPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // Recompute allocation with new values
        const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
        const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays
        const loanType = loan.loanType ?? "perpetual"

        // Get current ledger balance (after reversals)
        const currentBalance = await getLoanBalanceFromLedger(payment.loanId)
        const principalBalanceBefore = currentBalance.isGreaterThan(0)
          ? currentBalance.toFixed(2)
          : loan.principalAmount

        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
        const paymentIdx = activePayments.findIndex((p) => p.id === input.paymentId)

        const prevDate = paymentIdx === 0
          ? new Date(loan.startDate)
          : new Date(activePayments[paymentIdx - 1].paymentDate)
        const daysElapsed = daysBetween(prevDate, newPaymentDate)
        const paymentNumber = paymentIdx + 1

        const allocation = allocatePayment({
          paymentAmount: newAmount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
          loanType,
          originalPrincipal: loan.principalAmount,
          termMonths: loan.termMonths ?? undefined,
          paymentNumber,
        })

        // M2: Reject overpayments
        let totalOwed: BigNumber
        if (loanType === "fixed_rate") {
          const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(new BigNumber(monthlyRateDecimal))
          const remainingMonths = Math.max((loan.termMonths ?? 0) - paymentNumber + 1, 1)
          totalOwed = new BigNumber(principalBalanceBefore).plus(monthlyInterest.multipliedBy(remainingMonths))
        } else if (loanType === "reducing_balance") {
          const currentInterest = new BigNumber(principalBalanceBefore).multipliedBy(new BigNumber(monthlyRateDecimal))
          totalOwed = new BigNumber(principalBalanceBefore).plus(currentInterest)
        } else {
          totalOwed = new BigNumber(allocation.interestPortion).plus(new BigNumber(principalBalanceBefore))
        }
        if (new BigNumber(newAmount).isGreaterThan(totalOwed)) {
          throw {
            _tag: "ValidationError",
            message: `Payment amount ${newAmount} exceeds total owed ${formatAmount(totalOwed)}`,
            field: "amount",
          }
        }

        const beforeValue = { ...payment }

        // Update the payment row
        const updates: { updatedAt: Date; editReason: string; amount?: string; paymentDate?: Date } = {
          updatedAt: new Date(),
          editReason: input.reason,
        }
        if (input.amount !== undefined) updates.amount = input.amount
        if (input.paymentDate !== undefined) updates.paymentDate = new Date(input.paymentDate)

        await tx.update(payments).set(updates).where(eq(payments.id, input.paymentId))

        // Post new journals
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          })
        }

        // Check fully-paid status
        const postEditBalance = await getLoanBalanceFromLedger(payment.loanId)
        if (postEditBalance.isZero()) {
          await tx.update(loans).set({ status: "fully_paid", updatedAt: new Date() }).where(eq(loans.id, payment.loanId))
        } else if (loan.status === "fully_paid") {
          await tx.update(loans).set({ status: "active", updatedAt: new Date() }).where(eq(loans.id, payment.loanId))
        }

        const [updatedPayment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId))

        await writeAuditLog(tx, {
          actorId,
          action: "payment.update",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue,
          afterValue: { ...updatedPayment, reason: input.reason },
        })

        return updatedPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      if (e?._tag === "ValidationError") return new ValidationError({ message: e.message, field: e.field })
      return new DatabaseError({ cause: e })
    },
  })
```

- [ ] **Step 2: Add `getPaymentPortionsFromLedger` to the import**

Update the import from `transaction.service` at the top of `payment.service.ts`:

```typescript
import { autoPostInterestEarned, autoPostPrincipalRepayment, postJournalEntry, getLoanBalanceFromLedger, reverseInterestAccrual, getInterestEarnedFromLedger, getPaymentPortionsFromLedger } from "./transaction.service"
```

- [ ] **Step 3: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "refactor: simplify editPayment — reverse+repost journals, no chain recalculation"
```

---

### Task 9: Simplify `deletePayment` — remove chain recalculation

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Rewrite `deletePayment`**

Replace the entire `deletePayment` function with a simplified version:

```typescript
export const deletePayment = (
  input: DeletePaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId }

        const [loan] = await tx.select().from(loans).where(eq(loans.id, payment.loanId))
        if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

        const now = new Date()

        // Soft-delete the payment
        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(eq(payments.id, input.paymentId))

        await writeAuditLog(tx, {
          actorId,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue: payment,
          afterValue: { ...payment, deletedAt: now, deletedBy: actorId, deleteReason: input.reason },
        })

        // Reverse journals using ledger-derived amounts
        const portions = await getPaymentPortionsFromLedger([input.paymentId])
        const portion = portions.get(input.paymentId)

        if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            loanId: payment.loanId,
          })
        }

        // Check loan status
        const postDeleteBalance = await getLoanBalanceFromLedger(payment.loanId)
        if (postDeleteBalance.isGreaterThan(0) && loan.status === "fully_paid") {
          await tx.update(loans).set({ status: "active", updatedAt: now }).where(eq(loans.id, payment.loanId))
        }

        const [deletedRow] = await tx.select().from(payments).where(eq(payments.id, input.paymentId))
        return deletedRow
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "refactor: simplify deletePayment — reverse journals from ledger, no chain recalculation"
```

---

### Task 10: Delete `recalculateFromPayment` and `reconcileDownstreamJournals`

**Files:**
- Modify: `src/services/payment.service.ts`
- Modify: `src/services/loan.service.ts`

- [ ] **Step 1: Remove the two functions from payment.service.ts**

Delete the `reconcileDownstreamJournals` function (lines ~78-164) and the `recalculateFromPayment` function (lines ~166-224) from `src/services/payment.service.ts`.

- [ ] **Step 2: Update loan.service.ts to remove the import and usage**

In `src/services/loan.service.ts`, remove the import:

```typescript
import { recalculateFromPayment, reconcileDownstreamJournals } from "./payment.service"
```

In `updateLoan`, replace the recalculation block (around lines 440-457) with a ledger-based approach. When the principal changes, all existing payment journals become incorrect. Reverse them all and repost:

```typescript
          // When principal changes, reverse and repost all payment journals
          const activePayments = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

          if (activePayments.length > 0) {
            const { getPaymentPortionsFromLedger, autoPostInterestEarned, autoPostPrincipalRepayment } = await import("./transaction.service")

            // Get all current portions from ledger
            const paymentIds = activePayments.map(p => p.id)
            const portions = await getPaymentPortionsFromLedger(paymentIds)

            // Reverse all payment journals
            for (const p of activePayments) {
              const portion = portions.get(p.id)
              if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Interest Earned", type: "revenue" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.interestPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - loan principal updated for ${input.loanId.slice(0, 8).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  loanId: input.loanId,
                })
              }
              if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Loans Receivable", type: "asset" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.principalPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - loan principal updated for ${input.loanId.slice(0, 8).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  loanId: input.loanId,
                })
              }
            }

            // Repost with new allocations
            const updatedPrincipal = input.principalAmount!
            const updatedRate = input.interestRate ?? existingLoan.interestRate
            const updatedMinDays = input.minInterestDays ?? existingLoan.minInterestDays
            const loanType = existingLoan.loanType ?? "perpetual"
            let runningBalance = new BigNumber(updatedPrincipal)

            for (let i = 0; i < activePayments.length; i++) {
              const p = activePayments[i]
              const prevDate = i === 0 ? new Date(existingLoan.startDate) : new Date(activePayments[i - 1].paymentDate)
              const daysElapsed = daysBetween(prevDate, new Date(p.paymentDate))

              const allocation = allocatePayment({
                paymentAmount: p.amount,
                principalBalanceBefore: runningBalance.toFixed(2),
                monthlyRateDecimal: updatedRate,
                daysElapsed,
                minInterestDays: updatedMinDays,
                loanType,
                originalPrincipal: updatedPrincipal,
                termMonths: existingLoan.termMonths ?? undefined,
                paymentNumber: i + 1,
              })

              if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
                await autoPostInterestEarned(tx, {
                  amount: allocation.interestPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: new Date(p.paymentDate).toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                })
              }

              if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
                await autoPostPrincipalRepayment(tx, {
                  amount: allocation.principalPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: new Date(p.paymentDate).toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                })
              }

              runningBalance = runningBalance.minus(new BigNumber(allocation.principalPortion))
            }
          }
```

Add the needed imports to `loan.service.ts`:

```typescript
import { allocatePayment } from "@/lib/interest/engine"
import { daysBetween } from "@/lib/db/utils"
import BigNumber from "bignumber.js"
```

- [ ] **Step 3: Commit**

```bash
git add src/services/payment.service.ts src/services/loan.service.ts
git commit -m "refactor: delete recalculateFromPayment and reconcileDownstreamJournals"
```

---

### Task 11: Update `listPayments` and `getPaymentsForLoan` to derive from ledger

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Update `listPayments`**

In the `listPayments` function, after the database query, enrich the results with ledger-derived portions:

```typescript
export const listPayments = (
  input: ListPaymentsInput
): Effect.Effect<{ rows: PaymentWithCustomer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 25
      const offset = (page - 1) * pageSize

      const conditions = [isNull(payments.deletedAt)]
      if (input.dateFrom) conditions.push(gte(payments.paymentDate, new Date(input.dateFrom)))
      if (input.dateTo) conditions.push(lte(payments.paymentDate, new Date(input.dateTo + "T23:59:59.999Z")))
      if (input.amountMin) conditions.push(gte(payments.amount, input.amountMin))
      if (input.amountMax) conditions.push(lte(payments.amount, input.amountMax))
      if (input.customerName) conditions.push(ilike(customers.fullName, `%${escapeLikePattern(input.customerName)}%`))

      const where = and(...conditions)

      const [baseRows, [{ value: total }]] = await Promise.all([
        db
          .select({
            id: payments.id,
            loanId: payments.loanId,
            customerId: loans.customerId,
            customerName: customers.fullName,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
            recordedBy: payments.recordedBy,
            depositLocation: payments.depositLocation,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where)
          .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ value: count() })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where),
      ])

      // Enrich with ledger-derived portions
      const paymentIds = baseRows.map(r => r.id)
      const portions = await getPaymentPortionsFromLedger(paymentIds)

      // Compute principalBalanceAfter per loan
      const loanIds = [...new Set(baseRows.map(r => r.loanId))]
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      const rows: PaymentWithCustomer[] = baseRows.map(r => {
        const portion = portions.get(r.id)
        return {
          ...r,
          interestPortion: portion?.interestPortion ?? "0.00",
          principalPortion: portion?.principalPortion ?? "0.00",
          principalBalanceAfter: ledgerBalances.get(r.loanId)?.toFixed(2) ?? "0.00",
        }
      })

      return { rows, total: Number(total) }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

Add `getLoanBalancesFromLedger` to the import from `transaction.service`:

```typescript
import { autoPostInterestEarned, autoPostPrincipalRepayment, postJournalEntry, getLoanBalanceFromLedger, reverseInterestAccrual, getInterestEarnedFromLedger, getPaymentPortionsFromLedger, getLoanBalancesFromLedger } from "./transaction.service"
```

- [ ] **Step 2: Update `getPaymentsForLoan`**

This function returns `Payment[]` which no longer has the cached columns. The callers that need portions will need to fetch them separately. Since `getPaymentsForLoan` is used by the loan detail page (which already fetches `ledgerBalance` separately), keep it simple:

```typescript
export const getPaymentsForLoan = (
  loanId: string
): Effect.Effect<Payment[], LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: loanId }

      return await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
```

This doesn't change much structurally — it just returns the Payment without cached columns (which the schema change already handles).

- [ ] **Step 3: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "refactor: listPayments derives interest/principal portions from ledger"
```

---

### Task 12: Update `getDailyCollections` to derive from ledger

**Files:**
- Modify: `src/services/daily-collections.service.ts`

- [ ] **Step 1: Update the service**

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { sql, eq, and, isNull, asc, inArray } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import BigNumber from "bignumber.js"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getPaymentPortionsFromLedger } from "@/services/transaction.service"
import type { DailyCollectionsSummary, LoanDueToday, LoanType } from "@/types"

export const getDailyCollections = (
  date: string
): Effect.Effect<DailyCollectionsSummary, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const baseRows = await db
        .select({
          paymentId: payments.id,
          loanId: payments.loanId,
          customerName: customers.fullName,
          amount: payments.amount,
          paymentDate: payments.paymentDate,
          depositLocation: payments.depositLocation,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(
          and(
            isNull(payments.deletedAt),
            sql`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}::date`
          )
        )
        .orderBy(asc(payments.paymentDate))

      // Enrich with ledger-derived portions
      const paymentIds = baseRows.map(r => r.paymentId)
      const portions = await getPaymentPortionsFromLedger(paymentIds)

      const rows = baseRows.map(r => ({
        ...r,
        interestPortion: portions.get(r.paymentId)?.interestPortion ?? "0.00",
        principalPortion: portions.get(r.paymentId)?.principalPortion ?? "0.00",
      }))

      const totalCollected = rows
        .reduce((sum, r) => sum.plus(new BigNumber(r.amount)), new BigNumber(0))
        .toFixed(2)

      return {
        date,
        totalCollected,
        paymentCount: rows.length,
        rows,
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

The `getLoansDueToday` function doesn't need changes — it already uses ledger-derived values.

- [ ] **Step 2: Commit**

```bash
git add src/services/daily-collections.service.ts
git commit -m "refactor: getDailyCollections derives payment portions from ledger"
```

---

### Task 13: Update loan detail page to pass ledger-derived portions

**Files:**
- Modify: `src/app/(app)/loans/[loanId]/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- Modify: `src/actions/payment.actions.ts`

- [ ] **Step 1: Update the server page to fetch payment portions from ledger**

In `src/app/(app)/loans/[loanId]/page.tsx`, after fetching payments, also fetch their ledger portions. Add to the data-fetching section:

```typescript
import { getPaymentPortionsFromLedger } from "@/services/transaction.service"

// After fetching paymentsResult:
const activePaymentIds = paymentsResult.data
  ?.filter(p => p.deletedAt === null)
  .map(p => p.id) ?? []
const paymentPortions = await getPaymentPortionsFromLedger(activePaymentIds)
```

Pass `paymentPortions` (serialized as a plain object) to the client component:

```typescript
const portionsMap = Object.fromEntries(paymentPortions)
// Pass to client:
<LoanDetailClient
  loan={loan}
  payments={paymentsResult.data ?? []}
  ledgerBalance={ledgerBalance.toFixed(2)}
  paymentPortions={portionsMap}
  ...
/>
```

- [ ] **Step 2: Update the client component**

In `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`:

Add the `paymentPortions` prop to the component interface:

```typescript
paymentPortions: Record<string, { interestPortion: string; principalPortion: string }>
```

Remove the `paymentsChainBalance` fallback (lines 161-165). Use `ledgerBalance` directly:

```typescript
const outstandingBalance = ledgerBalance ?? loan.principalAmount
```

In the payment history table rendering, replace `payment.interestPortion`, `payment.principalPortion`, `payment.principalBalanceAfter` with values from `paymentPortions`:

```tsx
const portion = paymentPortions[payment.id]
// Use portion?.interestPortion ?? "0.00" instead of payment.interestPortion
// Use portion?.principalPortion ?? "0.00" instead of payment.principalPortion
// For principalBalanceAfter: use ledgerBalance (single current value) — this is a simplification
```

- [ ] **Step 3: Update `getPaymentsByLoanAction` to include ledger data**

In `src/actions/payment.actions.ts`, update `getPaymentsByLoanAction` to also return portions:

```typescript
export async function getPaymentsByLoanAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  if (!loanId?.trim()) return { error: "Loan ID is required" }

  try {
    const rows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

    const { getPaymentPortionsFromLedger } = await import("@/services/transaction.service")
    const portions = await getPaymentPortionsFromLedger(rows.map(r => r.id))

    return { data: rows, portions: Object.fromEntries(portions) }
  } catch {
    return { error: "Internal server error" }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/loans/[loanId]/page.tsx src/app/(app)/loans/[loanId]/loan-detail-client.tsx src/actions/payment.actions.ts
git commit -m "refactor: loan detail page derives payment portions from ledger"
```

---

### Task 14: Update receipt page and record-payment-form

**Files:**
- Modify: `src/app/(app)/receipts/repayment/[paymentId]/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`

- [ ] **Step 1: Update receipt page to fetch portions from ledger**

In `src/app/(app)/receipts/repayment/[paymentId]/page.tsx`, after fetching the payment, also fetch portions:

```typescript
import { getPaymentPortionsFromLedger, getLoanBalanceFromLedger } from "@/services/transaction.service"

// After fetching payment:
const portions = await getPaymentPortionsFromLedger([paymentId])
const portion = portions.get(paymentId)
const ledgerBalance = payment ? await getLoanBalanceFromLedger(payment.loanId) : null
```

Then replace `payment.interestPortion` with `portion?.interestPortion ?? "0.00"`, `payment.principalPortion` with `portion?.principalPortion ?? "0.00"`, and `payment.principalBalanceAfter` with `ledgerBalance?.toFixed(2) ?? "0.00"` in the JSX.

Update the RCPT-03 completeness check: instead of checking `payment?.interestPortion`, check `portion?.interestPortion`.

- [ ] **Step 2: Update record-payment-form to use allocation from response**

In `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`, the receipt shown after recording uses `result.interestPortion`, `result.principalPortion`, `result.principalBalanceAfter`. Since `recordPayment` now returns `{ ...payment, allocation }`, update these references to use `result.allocation.interestPortion`, `result.allocation.principalPortion`, `result.allocation.principalBalanceAfter`.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/receipts/repayment/[paymentId]/page.tsx src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx
git commit -m "refactor: receipt page and payment form derive portions from ledger"
```

---

### Task 15: Update customer page and creditor profile

**Files:**
- Modify: `src/app/(app)/customers/[id]/page.tsx`
- Modify: `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx`

- [ ] **Step 1: Update customer page**

In `src/app/(app)/customers/[id]/page.tsx`, where payment history is displayed, the template reads `payment.interestPortion`, `payment.principalPortion`, `payment.principalBalanceAfter`. Fetch portions from ledger in the server component and pass to the table:

```typescript
import { getPaymentPortionsFromLedger } from "@/services/transaction.service"

// After fetching loan payments:
const paymentIds = loanPayments.map(p => p.id)
const paymentPortions = await getPaymentPortionsFromLedger(paymentIds)
```

Then in the table rendering, replace `payment.interestPortion` with `paymentPortions.get(payment.id)?.interestPortion ?? "0.00"`, etc.

- [ ] **Step 2: Update creditor profile**

In `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx`, repayments display `repayment.interestPortion`, `repayment.principalPortion`, `repayment.principalBalanceAfter`. The creditor profile server page should fetch creditor repayment portions from ledger:

```typescript
import { getCreditorRepaymentPortionsFromLedger } from "@/services/transaction.service"

// After fetching repayments:
const repaymentIds = repayments.map(r => r.id)
const repaymentPortions = await getCreditorRepaymentPortionsFromLedger(repaymentIds)
```

Pass `repaymentPortions` to the client and use it in the table.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/customers/[id]/page.tsx src/app/(app)/creditors/[id]/CreditorProfileClient.tsx
git commit -m "refactor: customer and creditor pages derive portions from ledger"
```

---

### Task 16: Remove cached columns from creditor schemas

**Files:**
- Modify: `src/lib/db/schema/creditor-investments.ts`
- Modify: `src/lib/db/schema/creditor-repayments.ts`
- Modify: `src/services/creditor.service.ts`

- [ ] **Step 1: Remove `principalBalance` from creditor_investments schema**

In `src/lib/db/schema/creditor-investments.ts`, remove:

```typescript
  principalBalance: numeric("principal_balance", { precision: 15, scale: 2 }).notNull(),
```

- [ ] **Step 2: Remove cached columns from creditor_repayments schema**

In `src/lib/db/schema/creditor-repayments.ts`, remove:

```typescript
  interestPortion: numeric("interest_portion", { precision: 15, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 15, scale: 2 }).notNull(),
  principalBalanceBefore: numeric("principal_balance_before", { precision: 15, scale: 2 }).notNull(),
  principalBalanceAfter: numeric("principal_balance_after", { precision: 15, scale: 2 }).notNull(),
```

- [ ] **Step 3: Update `recordCreditorRepayment` to stop writing cached columns**

In `src/services/creditor.service.ts`, in `recordCreditorRepayment`, update the `.values()` call to remove the 4 cached columns:

```typescript
        const [repayment] = await tx
          .insert(creditorRepayments)
          .values({
            investmentId: input.investmentId,
            repaymentDate: new Date(input.repaymentDate),
            amount: input.amount,
            recordedBy: actorId,
          })
          .returning();
```

Also remove the `principalBalance: input.amount` from `addInvestment`'s `.values()`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/creditor-investments.ts src/lib/db/schema/creditor-repayments.ts src/services/creditor.service.ts
git commit -m "refactor: remove cached columns from creditor investment and repayment schemas"
```

---

### Task 17: Update tests

**Files:**
- Modify: `src/services/__tests__/payment.service.test.ts`
- Modify: `src/services/__tests__/daily-collections.service.test.ts`
- Modify: `src/services/__tests__/loan.service.test.ts`
- Modify: `src/services/__tests__/creditor.service.test.ts`

- [ ] **Step 1: Update payment service tests**

In `src/services/__tests__/payment.service.test.ts`:

1. Remove `interestPortion`, `principalPortion`, `principalBalanceBefore`, `principalBalanceAfter` from `mockPayment`.
2. Add `getPaymentPortionsFromLedger` to the mock of `@/services/transaction.service`:
   ```typescript
   getPaymentPortionsFromLedger: vi.fn().mockResolvedValue(new Map()),
   getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
   ```
3. Update the `recordPayment` test assertions — remove checks for `result.principalBalanceAfter` since that's no longer on the return type. Instead check that `autoPostInterestEarned` and `autoPostPrincipalRepayment` were called.
4. Remove the `editPayment: triggers recalculation cascade` test (the cascade no longer exists). Replace with a simpler test that verifies edit reverses old journals and posts new ones.
5. Remove references to `payment.interestPortion` in the delete test.

- [ ] **Step 2: Update daily collections test**

In `src/services/__tests__/daily-collections.service.test.ts`:

1. Remove `interestPortion` and `principalPortion` from `makePaymentRow`.
2. Add `getPaymentPortionsFromLedger` to the transaction service mock:
   ```typescript
   getPaymentPortionsFromLedger: vi.fn().mockResolvedValue(
     new Map([["pay-1", { interestPortion: "100000.00", principalPortion: "50000.00" }]])
   ),
   ```
3. Update assertions to verify enriched rows contain the ledger-derived values.

- [ ] **Step 3: Update loan service test**

In `src/services/__tests__/loan.service.test.ts`:

1. Remove any imports of `recalculateFromPayment` or `reconcileDownstreamJournals`.
2. Add `getPaymentPortionsFromLedger` to the transaction service mock.
3. Update tests that verify loan update recalculation — they should now verify journal reversal + repost instead of chain recalculation.

- [ ] **Step 4: Update creditor service test**

In `src/services/__tests__/creditor.service.test.ts`:

1. Remove `interestPortion`, `principalPortion`, `principalBalanceBefore`, `principalBalanceAfter` from mock repayment objects.
2. Add `getCreditorRepaymentPortionsFromLedger` to the transaction service mock.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/__tests__/
git commit -m "test: update all tests to reflect ledger-derived payment portions"
```

---

### Task 18: Generate and run database migration

**Files:**
- Create: `drizzle/XXXX_drop_cached_columns.sql` (generated by Drizzle)

- [ ] **Step 1: Generate the migration**

Run: `npx drizzle-kit generate`

This will detect the dropped columns and generate a migration SQL file.

- [ ] **Step 2: Review the generated migration**

The migration should contain:
```sql
ALTER TABLE "payments" DROP COLUMN "interest_portion";
ALTER TABLE "payments" DROP COLUMN "principal_portion";
ALTER TABLE "payments" DROP COLUMN "principal_balance_before";
ALTER TABLE "payments" DROP COLUMN "principal_balance_after";

ALTER TABLE "creditor_repayments" DROP COLUMN "interest_portion";
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_portion";
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_balance_before";
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_balance_after";

ALTER TABLE "creditor_investments" DROP COLUMN "principal_balance";
```

- [ ] **Step 3: Run the migration**

Run: `npx drizzle-kit push`

- [ ] **Step 4: Run all tests again to verify nothing is broken**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add drizzle/
git commit -m "migration: drop cached financial columns from payments, creditor_repayments, creditor_investments"
```

---

### Task 19: Final cleanup and export audit

**Files:**
- Modify: `src/services/payment.service.ts` (if any unused imports remain)
- Modify: `src/services/export/excel.service.ts` (if it references cached columns)
- Modify: `src/services/export/pdf.service.ts` (if it references cached columns)

- [ ] **Step 1: Check export services for cached column references**

Search `excel.service.ts` and `pdf.service.ts` for `interestPortion`, `principalPortion`, `principalBalanceAfter`. If found, update them to use `getPaymentPortionsFromLedger`.

- [ ] **Step 2: Check for any remaining references to deleted functions or columns**

Run: `grep -rn "recalculateFromPayment\|reconcileDownstreamJournals\|principalBalanceBefore\|principalBalanceAfter\|payments\.interestPortion\|payments\.principalPortion" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "__tests__" | grep -v "\.md"`

Fix any remaining references.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 4: Type-check the entire project**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: No errors

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup — remove all references to deleted cached columns"
```
