# Full Double-Entry Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the transaction ledger to full double-entry, where every financial event posts both debit and credit entries, with principal movements tracked as "balance_sheet" category type excluded from P&L.

**Architecture:** Add "balance_sheet" category type to separate principal movements from P&L entries. Modify each service that creates financial events to post complete journal entries. Truncate all data tables (dev environment). Filter P&L reports to exclude balance_sheet categories.

**Tech Stack:** Drizzle ORM, Effect-TS, BigNumber.js, PostgreSQL

---

## File Structure

**Create:**
- `drizzle/0018_full_double_entry.sql` — migration: enum value, column, truncate

**Modify:**
- `src/lib/db/schema/transaction-categories.ts` — add "balance_sheet" to enum
- `src/lib/db/schema/transactions.ts` — add depositLocation column
- `src/types/index.ts` — update CategoryType
- `src/services/category.service.ts` — add balance_sheet default categories, update type signatures
- `src/services/transaction.service.ts` — add autoPostPrincipal helpers
- `src/services/loan.service.ts` — post principal disbursement on create; reverse on delete
- `src/services/payment.service.ts` — post principal repayment; reverse on delete/edit; reconcile downstream
- `src/services/collateral-settlement.service.ts` — change "Collateral Recovery" → "Principal Recovery" (balance_sheet)
- `src/services/creditor.service.ts` — post creditor investment + principal repaid entries
- `src/services/fund-transfer.service.ts` — post paired debit/credit entries
- `src/services/report.service.ts` — filter P&L to exclude balance_sheet

---

### Task 1: Database Migration

**Files:**
- Create: `drizzle/0018_full_double_entry.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add balance_sheet category type
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'balance_sheet';

-- Add deposit_location to transactions for fund tracking
ALTER TABLE "transactions" ADD COLUMN "deposit_location" deposit_location;

-- Truncate all data tables (dev environment, no production data)
TRUNCATE TABLE
  transactions,
  payments,
  collateral,
  loans,
  creditor_repayments,
  creditor_investments,
  creditors,
  fund_transfers,
  audit_log,
  notifications,
  rate_change_requests,
  transaction_categories,
  financial_snapshots
CASCADE;
```

- [ ] **Step 2: Commit**

```bash
git add drizzle/0018_full_double_entry.sql
git commit -m "feat: add migration for full double-entry accounting"
```

---

### Task 2: Schema Updates

**Files:**
- Modify: `src/lib/db/schema/transaction-categories.ts`
- Modify: `src/lib/db/schema/transactions.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update category type enum**

In `src/lib/db/schema/transaction-categories.ts`, change line 3:

```typescript
export const categoryTypeEnum = pgEnum("category_type", ["expense", "income", "balance_sheet"])
```

- [ ] **Step 2: Add depositLocation to transactions schema**

In `src/lib/db/schema/transactions.ts`, add import for `depositLocationEnum`:

```typescript
import { depositLocationEnum } from "./fund-transfers"
```

Add after the `recordedBy` field:

```typescript
  depositLocation: depositLocationEnum("deposit_location"),
```

- [ ] **Step 3: Update CategoryType in types**

In `src/types/index.ts`, find `export type CategoryType = "expense" | "income"` and replace with:

```typescript
export type CategoryType = "expense" | "income" | "balance_sheet"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/transaction-categories.ts src/lib/db/schema/transactions.ts src/types/index.ts
git commit -m "feat: add balance_sheet category type and depositLocation to transactions"
```

---

### Task 3: Default Categories & Category Service

**Files:**
- Modify: `src/services/category.service.ts`

- [ ] **Step 1: Add balance_sheet defaults and update type signatures**

In `src/services/category.service.ts`, add after `DEFAULT_INCOME_CATEGORIES`:

```typescript
const DEFAULT_BALANCE_SHEET_CATEGORIES = [
  "Loan Disbursement",
  "Principal Repayment",
  "Principal Recovery",
  "Creditor Investment",
  "Creditor Principal Repaid",
  "Fund Transfer",
]
```

In `seedDefaultCategories`, update the `toInsert` type:

```typescript
      const toInsert: {
        name: string
        type: "expense" | "income" | "balance_sheet"
        isDefault: boolean
      }[] = []
```

Add after the income categories loop:

```typescript
      for (const name of DEFAULT_BALANCE_SHEET_CATEGORIES) {
        if (!existingNames.has(`balance_sheet:${name}`)) {
          toInsert.push({ name, type: "balance_sheet", isDefault: true })
        }
      }
```

Update `listCategories` parameter type:

```typescript
export const listCategories = (
  type?: "expense" | "income" | "balance_sheet"
): Effect.Effect<(typeof transactionCategories.$inferSelect)[], DatabaseError> =>
```

Update `getCategoryByName` parameter type:

```typescript
export const getCategoryByName = (
  name: string,
  type: "expense" | "income" | "balance_sheet"
): Effect.Effect<
```

- [ ] **Step 2: Commit**

```bash
git add src/services/category.service.ts
git commit -m "feat: add balance_sheet default categories and update category service types"
```

---

### Task 4: Transaction Service Helpers

**Files:**
- Modify: `src/services/transaction.service.ts`

- [ ] **Step 1: Add principal posting helpers**

In `src/services/transaction.service.ts`, add these helper functions after the existing `autoPostInterestExpense` function:

```typescript
export async function autoPostPrincipalDisbursement(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    transactionDate: string
    actorId: string
    depositLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Loan Disbursement"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostPrincipalDisbursement] "Loan Disbursement" category not found — skipping')
    return
  }

  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "loan",
    referenceId: params.loanId,
    description: `Principal disbursed - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
    depositLocation: params.depositLocation ?? null,
  })
}

export async function autoPostPrincipalRepayment(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    paymentId: string
    paymentDate: string
    actorId: string
    depositLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Principal Repayment"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostPrincipalRepayment] "Principal Repayment" category not found — skipping')
    return
  }

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "payment",
    referenceId: params.paymentId,
    description: `Principal repaid - loan ${params.loanId.slice(0, 8).toUpperCase()} payment ${params.paymentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
    depositLocation: params.depositLocation ?? null,
  })
}

export async function autoPostPrincipalRecovery(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    transactionDate: string
    actorId: string
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Principal Recovery"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostPrincipalRecovery] "Principal Recovery" category not found — skipping')
    return
  }

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "collateral_settlement",
    referenceId: params.loanId,
    description: `Principal recovered via collateral - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
  })
}

export async function autoPostCreditorInvestment(
  tx: DrizzleTransaction,
  params: {
    amount: string
    investmentId: string
    investmentDate: string
    actorId: string
    depositLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Creditor Investment"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostCreditorInvestment] "Creditor Investment" category not found — skipping')
    return
  }

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "creditor_investment",
    referenceId: params.investmentId,
    description: `Creditor investment received - ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.investmentDate),
    recordedBy: params.actorId,
    depositLocation: params.depositLocation ?? null,
  })
}

export async function autoPostCreditorPrincipalRepaid(
  tx: DrizzleTransaction,
  params: {
    amount: string
    investmentId: string
    repaymentDate: string
    actorId: string
    sourceLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Creditor Principal Repaid"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostCreditorPrincipalRepaid] "Creditor Principal Repaid" category not found — skipping')
    return
  }

  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "creditor_repayment",
    referenceId: params.investmentId,
    description: `Creditor principal repaid - investment ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.repaymentDate),
    recordedBy: params.actorId,
    depositLocation: params.sourceLocation ?? null,
  })
}

export async function autoPostFundTransfer(
  tx: DrizzleTransaction,
  params: {
    amount: string
    transferId: string
    fromLocation: "cash" | "bank" | "strong_room"
    toLocation: "cash" | "bank" | "strong_room"
    transactionDate: string
    actorId: string
  }
): Promise<void> {
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Fund Transfer"),
        eq(transactionCategories.type, "balance_sheet")
      )
    )

  if (!category) {
    console.warn('[autoPostFundTransfer] "Fund Transfer" category not found — skipping')
    return
  }

  // Debit from source
  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "fund_transfer",
    referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
    depositLocation: params.fromLocation,
  })

  // Credit to destination
  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "fund_transfer",
    referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
    depositLocation: params.toLocation,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "feat: add auto-post helpers for principal, creditor, and fund transfer transactions"
```

---

### Task 5: Loan Service — Post Disbursement & Fix Reversals

**Files:**
- Modify: `src/services/loan.service.ts`

- [ ] **Step 1: Add import**

Add to imports:

```typescript
import { autoPostPrincipalDisbursement } from "./transaction.service"
```

- [ ] **Step 2: Post principal disbursement on loan creation**

In `createLoan`, after the issuance fee transaction insert (after `await tx.insert(transactions).values({...})` for the fee), add:

```typescript
        // Auto-post principal disbursement as balance_sheet debit
        await autoPostPrincipalDisbursement(tx, {
          amount: loan.principalAmount,
          loanId: loan.id,
          transactionDate: startDate.toISOString(),
          actorId,
          depositLocation: input.disbursementSource,
        })
```

- [ ] **Step 3: Fix loan deletion to reverse disbursement**

In `deleteLoan`, after reversing the issuance fee transaction, add a section to reverse the principal disbursement. After the `if (feeTx) { ... }` block, add:

```typescript
        // Reverse principal disbursement
        const [disbursementTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.referenceType, "loan"),
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "debit")
            )
          )

        if (disbursementTx) {
          await tx.insert(transactions).values({
            type: "credit",
            amount: disbursementTx.amount,
            categoryId: disbursementTx.categoryId,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - principal disbursement for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: new Date(),
            recordedBy: actorId,
          })
        }
```

Also, in the loop that reverses payment interest transactions, add principal reversal. After the interest reversal `await tx.insert(transactions).values({...})` inside the `for (const p of loanPayments)` loop, add:

```typescript
            // Reverse principal repayment if > 0
            if (new BigNumber(p.principalPortion).isGreaterThan(0)) {
              let [principalCategory] = await tx.select().from(transactionCategories)
                .where(and(
                  eq(transactionCategories.name, "Principal Repayment"),
                  eq(transactionCategories.type, "balance_sheet")
                ))
              if (principalCategory) {
                await tx.insert(transactions).values({
                  type: "debit",
                  amount: p.principalPortion,
                  categoryId: principalCategory.id,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - principal repayment for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
                  transactionDate: new Date(),
                  recordedBy: actorId,
                })
              }
            }
```

- [ ] **Step 4: Commit**

```bash
git add src/services/loan.service.ts
git commit -m "feat: post principal disbursement on loan create and reverse on delete"
```

---

### Task 6: Payment Service — Post Principal Repayment & Fix Reversals

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Add import**

Add to imports:

```typescript
import { autoPostInterestEarned, autoPostPrincipalRepayment } from "./transaction.service"
```

Remove `autoPostInterestEarned` from wherever it's currently imported (it should now come from the combined import).

- [ ] **Step 2: Post principal repayment in recordPayment**

In `recordPayment`, after the existing `autoPostInterestEarned` call, add:

```typescript
        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
            depositLocation: input.depositLocation,
          })
        }
```

- [ ] **Step 3: Fix deletePayment to reverse principal**

In `deletePayment`, after the existing interest reversal block (after `await tx.insert(transactions).values({...})` for interest reversal), add:

```typescript
        // Reverse principal repayment
        if (new BigNumber(payment.principalPortion).isGreaterThan(0)) {
          let [principalCategory] = await tx
            .select()
            .from(transactionCategories)
            .where(
              and(
                eq(transactionCategories.name, "Principal Repayment"),
                eq(transactionCategories.type, "balance_sheet")
              )
            )

          if (principalCategory) {
            await tx.insert(transactions).values({
              type: "debit",
              amount: payment.principalPortion,
              categoryId: principalCategory.id,
              referenceType: "payment_reversal",
              referenceId: input.paymentId,
              description: `Reversal - principal repayment ${input.paymentId} deleted: ${input.reason}`,
              transactionDate: new Date(),
              recordedBy: actorId,
            })
          }
        }
```

- [ ] **Step 4: Fix editPayment to reverse+repost principal**

In `editPayment`, in the section that reverses old interest (the `if (new BigNumber(beforeValue.interestPortion).isGreaterThan(0))` block), add a parallel principal reversal after it:

```typescript
        // Reverse old principal repayment
        if (new BigNumber(beforeValue.principalPortion).isGreaterThan(0)) {
          let [principalCategory] = await tx
            .select()
            .from(transactionCategories)
            .where(
              and(
                eq(transactionCategories.name, "Principal Repayment"),
                eq(transactionCategories.type, "balance_sheet")
              )
            )

          if (principalCategory) {
            await tx.insert(transactions).values({
              type: "debit",
              amount: beforeValue.principalPortion,
              categoryId: principalCategory.id,
              referenceType: "payment_reversal",
              referenceId: input.paymentId,
              description: `Reversal - principal repayment ${input.paymentId} edited: ${input.reason}`,
              transactionDate: new Date(),
              recordedBy: actorId,
            })
          }
        }
```

After the new interest repost (`autoPostInterestEarned` for the updated payment), add:

```typescript
        // Post new principal repayment
        const newPrincipalPortion = updatedPayment.principalPortion
        if (new BigNumber(newPrincipalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: newPrincipalPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: updatedPayment.paymentDate.toISOString(),
            actorId,
          })
        }
```

- [ ] **Step 5: Fix reconcileDownstreamJournals for principal**

In `reconcileDownstreamJournals`, after the existing interest reconciliation logic, add principal reconciliation. The function already captures old interest values — extend it to also track old principal values. Add to the function parameters a `oldPrincipalMap: Map<string, string>` and process it similarly to interest:

After the interest reversal+repost block inside the `for (const dp of downstreamPayments)` loop, add:

```typescript
    // Reconcile principal portion
    const oldPrincipal = oldPrincipalMap?.get(dp.id)
    if (oldPrincipal !== undefined) {
      const oldPrincipalAmount = new BigNumber(oldPrincipal)
      const newPrincipalAmount = new BigNumber(refreshed.principalPortion)

      if (!oldPrincipalAmount.isEqualTo(newPrincipalAmount)) {
        let [principalCategory] = await tx
          .select()
          .from(transactionCategories)
          .where(
            and(
              eq(transactionCategories.name, "Principal Repayment"),
              eq(transactionCategories.type, "balance_sheet")
            )
          )

        if (principalCategory) {
          // Reverse old principal if > 0
          if (oldPrincipalAmount.isGreaterThan(0)) {
            await tx.insert(transactions).values({
              type: "debit",
              amount: oldPrincipal,
              categoryId: principalCategory.id,
              referenceType: "payment_reversal",
              referenceId: dp.id,
              description: `Reversal - downstream principal recalculation from payment ${triggerPaymentId} edit`,
              transactionDate: new Date(),
              recordedBy: actorId,
            })
          }

          // Post new principal if > 0
          if (newPrincipalAmount.isGreaterThan(0)) {
            await autoPostPrincipalRepayment(tx, {
              amount: refreshed.principalPortion,
              loanId: refreshed.loanId,
              paymentId: dp.id,
              paymentDate: refreshed.paymentDate.toISOString(),
              actorId,
            })
          }
        }
      }
    }
```

Update all call sites of `reconcileDownstreamJournals` to also pass `oldPrincipalMap`. At each call site, build the map alongside `oldInterestMap`:

```typescript
const oldPrincipalMap = new Map<string, string>()
// Inside the loop that builds oldInterestMap:
oldPrincipalMap.set(allActive[i].id, allActive[i].principalPortion)
```

Pass it as the additional argument.

- [ ] **Step 6: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "feat: post principal repayment on payment and reverse on delete/edit"
```

---

### Task 7: Collateral Settlement — Use Principal Recovery

**Files:**
- Modify: `src/services/collateral-settlement.service.ts`

- [ ] **Step 1: Replace "Collateral Recovery" with "Principal Recovery"**

In `settleWithCollateral`, find the section that posts the outstanding principal as "Collateral Recovery". Replace the `getOrCreateCategory` call:

Change:
```typescript
          const recoveryCategory = await getOrCreateCategory(tx, "Collateral Recovery", "income")
```

To:
```typescript
          const recoveryCategory = await getOrCreateCategory(tx, "Principal Recovery", "balance_sheet")
```

Also update the `getOrCreateCategory` helper function type to accept `"balance_sheet"`:

```typescript
async function getOrCreateCategory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
  type: "income" | "expense" | "balance_sheet"
) {
```

- [ ] **Step 2: Commit**

```bash
git add src/services/collateral-settlement.service.ts
git commit -m "feat: use Principal Recovery (balance_sheet) for collateral settlement"
```

---

### Task 8: Creditor Service — Post Investment & Principal Repayment

**Files:**
- Modify: `src/services/creditor.service.ts`

- [ ] **Step 1: Add imports**

Add to existing imports:

```typescript
import { autoPostCreditorInvestment, autoPostCreditorPrincipalRepaid } from "./transaction.service"
```

- [ ] **Step 2: Post creditor investment in addInvestment**

In `addInvestment`, after the `writeAuditLog` call and before `return investment`, add:

```typescript
        // Post creditor investment as balance_sheet credit (liability increase)
        await autoPostCreditorInvestment(tx, {
          amount: input.amount,
          investmentId: investment.id,
          investmentDate: input.investmentDate,
          actorId,
          depositLocation: input.depositLocation,
        })
```

- [ ] **Step 3: Post creditor principal repaid in recordCreditorRepayment**

In `recordCreditorRepayment`, after the existing `autoPostInterestExpense` call, add:

```typescript
        // Post creditor principal repaid as balance_sheet debit (liability decrease)
        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostCreditorPrincipalRepaid(tx, {
            amount: allocation.principalPortion,
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
            sourceLocation: input.sourceLocation,
          })
        }
```

- [ ] **Step 4: Commit**

```bash
git add src/services/creditor.service.ts
git commit -m "feat: post creditor investment and principal repayment transactions"
```

---

### Task 9: Fund Transfer Service — Post Paired Entries

**Files:**
- Modify: `src/services/fund-transfer.service.ts`

- [ ] **Step 1: Add import**

```typescript
import { autoPostFundTransfer } from "./transaction.service"
```

- [ ] **Step 2: Post fund transfer entries**

In `createFundTransfer`, after the `writeAuditLog` call and before `return transfer`, add:

```typescript
        // Post paired debit/credit fund transfer entries
        await autoPostFundTransfer(tx, {
          amount: input.amount,
          transferId: transfer.id,
          fromLocation: input.fromLocation,
          toLocation: input.toLocation,
          transactionDate: transfer.createdAt.toISOString(),
          actorId,
        })
```

- [ ] **Step 3: Commit**

```bash
git add src/services/fund-transfer.service.ts
git commit -m "feat: post paired debit/credit entries for fund transfers"
```

---

### Task 10: P&L Report — Filter Out Balance Sheet

**Files:**
- Modify: `src/services/report.service.ts`

- [ ] **Step 1: Add inArray import**

Add `inArray` to the drizzle-orm import:

```typescript
import { eq, and, gte, lte, isNull, desc, sql, inArray } from "drizzle-orm"
```

- [ ] **Step 2: Filter P&L query**

In `getPnlData`, update the `.where()` clause to also filter by category type. Change:

```typescript
        .where(
          and(
            gte(transactions.transactionDate, periodStart),
            lte(transactions.transactionDate, periodEnd)
          )
        )
```

To:

```typescript
        .where(
          and(
            gte(transactions.transactionDate, periodStart),
            lte(transactions.transactionDate, periodEnd),
            inArray(transactionCategories.type, ["income", "expense"])
          )
        )
```

This excludes `balance_sheet` entries from the P&L.

- [ ] **Step 3: Update retained earnings in balance sheet**

In `getBalanceSheetData`, the retained earnings calculation currently sums ALL transactions. It should only sum income/expense transactions (balance_sheet entries cancel out anyway, but being explicit is cleaner).

Update the `allTransactions` query:

```typescript
      const allTransactions = await db
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            lte(transactions.transactionDate, asOfDate),
            inArray(transactionCategories.type, ["income", "expense"])
          )
        )
```

- [ ] **Step 4: Commit**

```bash
git add src/services/report.service.ts
git commit -m "feat: filter P&L and retained earnings to exclude balance_sheet categories"
```

---

### Task 11: Build Verification & Migration

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: Only pre-existing errors (self-referencing loans schema, chat test mocks).

- [ ] **Step 2: Apply migration**

```bash
npx drizzle-kit push
```

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address build issues from double-entry accounting implementation"
```
