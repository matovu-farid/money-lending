# Double-Entry Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-entry transaction ledger to true double-entry bookkeeping with proper accounting classification, paired journal entries, and a ledger-derived balance sheet.

**Architecture:** Add `journalGroupId` to transactions for DR/CR pairing. Replace the 3-value category type enum (`income | expense | balance_sheet`) with a 5-value accounting classification (`asset | liability | equity | revenue | expense`). Create a unified `postJournalEntry` function that replaces all `autoPost*` functions. Rewrite `getBalanceSheetData` to derive everything from the ledger instead of querying operational tables.

**Tech Stack:** Drizzle ORM, PostgreSQL, Effect-TS, Next.js Server Components

**Spec:** `docs/superpowers/specs/2026-04-06-double-entry-ledger-design.md`

---

## File Structure

### New files
- `drizzle/0017_double_entry_ledger.sql` — migration: add journalGroupId, update enum, seed new categories
- _(no new source files — all changes are to existing files)_

### Modified files
- `src/lib/db/schema/transaction-categories.ts` — update enum values
- `src/lib/db/schema/transactions.ts` — add journalGroupId column
- `src/services/transaction.service.ts` — new `postJournalEntry`, rewrite `autoPost*`, update `recordExpense`/`recordIncome`
- `src/services/category.service.ts` — update seed defaults to new types
- `src/services/report.service.ts` — rewrite `getBalanceSheetData`, update P&L/RE type filters
- `src/services/loan.service.ts` — update journal posting in createLoan, updateLoan, deleteLoan
- `src/services/payment.service.ts` — update journal posting in recordPayment, editPayment, deletePayment, reconcileDownstreamJournals
- `src/services/creditor.service.ts` — update journal posting in addInvestment, recordCreditorRepayment
- `src/services/collateral-settlement.service.ts` — update journal posting in settleWithCollateral
- `src/services/fund-transfer.service.ts` — update journal posting in createFundTransfer
- `src/types/index.ts` — update category type union, add depositLocation to expense/income inputs
- `src/app/(app)/expenses/ExpenseListClient.tsx` — add location field to expense form
- `src/app/(app)/income/IncomeListClient.tsx` — add location field to income form
- `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx` — minor updates if needed
- `src/services/__tests__/excel.service.test.ts` — update test fixtures
- `src/services/__tests__/pdf.service.test.ts` — update test fixtures

---

## Task 1: Schema Migration — Add journalGroupId and Update Category Type Enum

**Files:**
- Modify: `src/lib/db/schema/transaction-categories.ts`
- Modify: `src/lib/db/schema/transactions.ts`
- Create: `drizzle/0017_double_entry_ledger.sql`

- [ ] **Step 1: Update the category type enum in the schema**

In `src/lib/db/schema/transaction-categories.ts`, change:

```typescript
export const categoryTypeEnum = pgEnum("category_type", ["expense", "income", "balance_sheet"])
```

to:

```typescript
export const categoryTypeEnum = pgEnum("category_type", ["asset", "liability", "equity", "revenue", "expense"])
```

- [ ] **Step 2: Add journalGroupId to the transactions schema**

In `src/lib/db/schema/transactions.ts`, add after the `depositLocation` line (line 17):

```typescript
  journalGroupId: uuid("journal_group_id"),
```

And add an index in the table's index array:

```typescript
  index("idx_transactions_journal_group_id").on(table.journalGroupId),
```

- [ ] **Step 3: Write the SQL migration**

Create `drizzle/0017_double_entry_ledger.sql`:

```sql
-- Add journalGroupId to transactions
ALTER TABLE "transactions" ADD COLUMN "journal_group_id" uuid;
CREATE INDEX "idx_transactions_journal_group_id" ON "transactions" USING btree ("journal_group_id");

-- Migrate category_type enum: add new values
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'asset';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'liability';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'equity';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'revenue';

-- Migrate existing categories to new types
UPDATE "transaction_categories" SET "type" = 'revenue' WHERE "type" = 'income';
UPDATE "transaction_categories" SET "type" = 'equity' WHERE "name" = 'Share Capital';
UPDATE "transaction_categories" SET "type" = 'liability' WHERE "name" = 'Creditor Investment';
UPDATE "transaction_categories" SET "type" = 'liability' WHERE "name" = 'Creditor Principal Repaid';

-- Rename old balance_sheet categories to asset type
UPDATE "transaction_categories" SET "type" = 'asset', "name" = 'Loans Receivable' WHERE "name" = 'Loan Disbursement';
UPDATE "transaction_categories" SET "type" = 'asset' WHERE "name" = 'Principal Repayment';
UPDATE "transaction_categories" SET "type" = 'asset', "name" = 'Seized Collateral' WHERE "name" = 'Principal Recovery';
UPDATE "transaction_categories" SET "type" = 'asset' WHERE "name" = 'Fund Transfer';

-- Create new Cash asset category
INSERT INTO "transaction_categories" ("id", "name", "type", "is_default")
VALUES (gen_random_uuid(), 'Cash', 'asset', true)
ON CONFLICT DO NOTHING;
```

Note: We cannot remove old enum values from PostgreSQL enums. The old values (`income`, `balance_sheet`) will remain in the enum but won't be used by any rows after migration.

- [ ] **Step 4: Update the drizzle meta journal**

Run: `npx drizzle-kit generate`

This regenerates the snapshot. If it produces a migration that conflicts with our hand-written one, use our hand-written migration and update the journal to point to it.

- [ ] **Step 5: Run the migration**

Run: `npx drizzle-kit push`

Verify no errors. Check that:
- `transactions` table has `journal_group_id` column
- `transaction_categories` has rows with new type values
- A "Cash" category exists with type "asset"

- [ ] **Step 6: Commit**

```bash
git add drizzle/ src/lib/db/schema/transaction-categories.ts src/lib/db/schema/transactions.ts
git commit -m "feat: add journalGroupId and 5-type accounting classification enum"
```

---

## Task 2: Update Category Seed Defaults and Type References

**Files:**
- Modify: `src/services/category.service.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update the seed categories in category.service.ts**

Replace the three category arrays with the new classification:

```typescript
const DEFAULT_ASSET_CATEGORIES = [
  "Cash",
  "Loans Receivable",
  "Seized Collateral",
]

const DEFAULT_LIABILITY_CATEGORIES = [
  "Creditor Investment",
]

const DEFAULT_EQUITY_CATEGORIES = [
  "Share Capital",
]

const DEFAULT_REVENUE_CATEGORIES = [
  "Bonuses",
  "Interest Earned",
  "Issuance Fees",
]

const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Salaries",
  "Office Expenses",
  "Interest Payments",
  "DStv",
]
```

- [ ] **Step 2: Update seedDefaultCategories function**

Replace the body of `seedDefaultCategories` to use the new arrays:

```typescript
export const seedDefaultCategories = (): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const existing = await db.select().from(transactionCategories)
      const existingNames = new Set(existing.map((c) => `${c.type}:${c.name}`))

      const toInsert: {
        name: string
        type: "asset" | "liability" | "equity" | "revenue" | "expense"
        isDefault: boolean
      }[] = []

      for (const name of DEFAULT_ASSET_CATEGORIES) {
        if (!existingNames.has(`asset:${name}`)) {
          toInsert.push({ name, type: "asset", isDefault: true })
        }
      }
      for (const name of DEFAULT_LIABILITY_CATEGORIES) {
        if (!existingNames.has(`liability:${name}`)) {
          toInsert.push({ name, type: "liability", isDefault: true })
        }
      }
      for (const name of DEFAULT_EQUITY_CATEGORIES) {
        if (!existingNames.has(`equity:${name}`)) {
          toInsert.push({ name, type: "equity", isDefault: true })
        }
      }
      for (const name of DEFAULT_REVENUE_CATEGORIES) {
        if (!existingNames.has(`revenue:${name}`)) {
          toInsert.push({ name, type: "revenue", isDefault: true })
        }
      }
      for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        if (!existingNames.has(`expense:${name}`)) {
          toInsert.push({ name, type: "expense", isDefault: true })
        }
      }

      if (toInsert.length > 0) {
        await db.insert(transactionCategories).values(toInsert)
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 3: Update type references in types/index.ts**

Find all occurrences of the old category type union and replace:

Change `"expense" | "income" | "balance_sheet"` to `"asset" | "liability" | "equity" | "revenue" | "expense"` wherever it appears in type definitions.

Update `CreateExpenseInput` (line ~264) — make `location` required:

```typescript
export interface CreateExpenseInput {
  categoryId: string
  amount: string
  transactionDate: string
  notes?: string
  location: "cash" | "bank" | "strong_room"
}
```

Update `CreateIncomeInput` (line ~272) — make `location` required:

```typescript
export interface CreateIncomeInput {
  categoryId: string
  amount: string
  transactionDate: string
  notes?: string
  location: "cash" | "bank" | "strong_room"
}
```

Also update `listCategories` parameter type and `createCategory` input type if they reference the old enum union.

- [ ] **Step 4: Update listCategories and createCategory signatures in category.service.ts**

In `listCategories` (line ~74), change the `type` parameter:

```typescript
export const listCategories = (
  type?: "asset" | "liability" | "equity" | "revenue" | "expense"
): Effect.Effect<(typeof transactionCategories.$inferSelect)[], DatabaseError> =>
```

In `CreateCategoryInput` in `src/types/index.ts`, update:

```typescript
export interface CreateCategoryInput {
  name: string
  type: "asset" | "liability" | "equity" | "revenue" | "expense"
}
```

- [ ] **Step 5: Update getCategoryByName in category.service.ts**

Change the `type` parameter:

```typescript
export const getCategoryByName = (
  name: string,
  type: "asset" | "liability" | "equity" | "revenue" | "expense"
): Effect.Effect<...> =>
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`

Fix any type errors from the enum change. Many callers will now fail because they pass `"income"` or `"balance_sheet"` — that is expected and will be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add src/services/category.service.ts src/types/index.ts
git commit -m "feat: update category seeds and types to 5-type accounting classification"
```

---

## Task 3: Create postJournalEntry and Replace All autoPost Functions

**Files:**
- Modify: `src/services/transaction.service.ts`

This is the core task. Replace all 8 `autoPost*` functions with a single `postJournalEntry` that always posts a DR + CR pair.

- [ ] **Step 1: Add the crypto import and define CategoryType**

At the top of `src/services/transaction.service.ts`, add:

```typescript
import { randomUUID } from "crypto"
```

- [ ] **Step 2: Write the postJournalEntry function**

Add after the `DrizzleTransaction` type alias (line 25):

```typescript
type CategoryType = "asset" | "liability" | "equity" | "revenue" | "expense"

async function getOrCreateCategory(
  tx: DrizzleTransaction,
  name: string,
  type: CategoryType
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )
  if (existing) return existing.id

  const [created] = await tx
    .insert(transactionCategories)
    .values({ name, type, isDefault: true })
    .returning()
  return created.id
}

export async function postJournalEntry(
  tx: DrizzleTransaction,
  params: {
    debitCategory: { name: string; type: CategoryType }
    creditCategory: { name: string; type: CategoryType }
    amount: string
    referenceType: string
    referenceId: string
    description: string
    transactionDate: Date
    recordedBy: string
    debitDepositLocation?: "cash" | "bank" | "strong_room"
    creditDepositLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<string> {
  const journalGroupId = randomUUID()

  const debitCategoryId = await getOrCreateCategory(
    tx,
    params.debitCategory.name,
    params.debitCategory.type
  )
  const creditCategoryId = await getOrCreateCategory(
    tx,
    params.creditCategory.name,
    params.creditCategory.type
  )

  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: debitCategoryId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    description: params.description,
    transactionDate: params.transactionDate,
    recordedBy: params.recordedBy,
    depositLocation: params.debitDepositLocation ?? null,
    journalGroupId,
  })

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: creditCategoryId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    description: params.description,
    transactionDate: params.transactionDate,
    recordedBy: params.recordedBy,
    depositLocation: params.creditDepositLocation ?? null,
    journalGroupId,
  })

  return journalGroupId
}
```

- [ ] **Step 3: Rewrite autoPostInterestEarned**

Replace the existing function body (line ~249) to delegate to `postJournalEntry`:

```typescript
export async function autoPostInterestEarned(
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
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Interest Earned", type: "revenue" },
    amount: params.amount,
    referenceType: "payment",
    referenceId: params.paymentId,
    description: `Interest earned - loan ${params.loanId} payment ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
  })
}
```

- [ ] **Step 4: Rewrite autoPostInterestExpense**

```typescript
export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: {
    amount: string
    investmentId: string
    repaymentDate: string
    actorId: string
    sourceLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Interest Payments", type: "expense" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount,
    referenceType: "creditor_repayment",
    referenceId: params.investmentId,
    description: `Interest paid - investment ${params.investmentId}`,
    transactionDate: new Date(params.repaymentDate),
    recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
  })
}
```

- [ ] **Step 5: Rewrite autoPostPrincipalDisbursement**

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
  await postJournalEntry(tx, {
    debitCategory: { name: "Loans Receivable", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount,
    referenceType: "loan",
    referenceId: params.loanId,
    description: `Principal disbursed - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    creditDepositLocation: params.depositLocation,
  })
}
```

- [ ] **Step 6: Rewrite autoPostPrincipalRepayment**

```typescript
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
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount,
    referenceType: "payment",
    referenceId: params.paymentId,
    description: `Principal repaid - loan ${params.loanId.slice(0, 8).toUpperCase()} payment ${params.paymentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    creditDepositLocation: params.depositLocation,
  })
}
```

- [ ] **Step 7: Rewrite autoPostPrincipalRecovery**

```typescript
export async function autoPostPrincipalRecovery(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    transactionDate: string
    actorId: string
  }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Seized Collateral", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount,
    referenceType: "collateral_settlement",
    referenceId: params.loanId,
    description: `Principal recovered via collateral - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
  })
}
```

- [ ] **Step 8: Rewrite autoPostCreditorInvestment**

```typescript
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
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Creditor Investment", type: "liability" },
    amount: params.amount,
    referenceType: "creditor_investment",
    referenceId: params.investmentId,
    description: `Creditor investment received - ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.investmentDate),
    recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
  })
}
```

- [ ] **Step 9: Rewrite autoPostCreditorPrincipalRepaid**

```typescript
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
  await postJournalEntry(tx, {
    debitCategory: { name: "Creditor Investment", type: "liability" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount,
    referenceType: "creditor_repayment",
    referenceId: params.investmentId,
    description: `Creditor principal repaid - investment ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.repaymentDate),
    recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
  })
}
```

- [ ] **Step 10: Rewrite autoPostFundTransfer**

```typescript
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
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount,
    referenceType: "fund_transfer",
    referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate),
    recordedBy: params.actorId,
    debitDepositLocation: params.toLocation,
    creditDepositLocation: params.fromLocation,
  })
}
```

- [ ] **Step 11: Rewrite recordExpense to post double-entry**

```typescript
export const recordExpense = (
  input: CreateExpenseInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        // recordExpense uses a user-selected categoryId (not a well-known name),
        // so we insert the pair directly instead of using postJournalEntry.
        const groupId = randomUUID()

        const [debitTx] = await tx
          .insert(transactions)
          .values({
            type: "debit",
            amount: input.amount,
            categoryId: input.categoryId,
            description: input.notes ?? null,
            transactionDate: new Date(input.transactionDate),
            recordedBy: actorId,
            journalGroupId: groupId,
          })
          .returning()

        const cashCategoryId = await getOrCreateCategory(tx, "Cash", "asset")

        await tx.insert(transactions).values({
          type: "credit",
          amount: input.amount,
          categoryId: cashCategoryId,
          description: input.notes ?? null,
          transactionDate: new Date(input.transactionDate),
          recordedBy: actorId,
          depositLocation: input.location,
          journalGroupId: groupId,
        })

        await writeAuditLog(tx, {
          actorId,
          action: "transaction.create",
          entityType: "transaction",
          entityId: debitTx.id,
          beforeValue: null,
          afterValue: debitTx,
        })

        return debitTx
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

The expense uses a user-selected `categoryId` directly for the debit side, and "Cash" (asset) for the credit side.

- [ ] **Step 12: Rewrite recordIncome to post double-entry**

```typescript
export const recordIncome = (
  input: CreateIncomeInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const groupId = randomUUID()

        const cashCategoryId = await getOrCreateCategory(tx, "Cash", "asset")

        await tx.insert(transactions).values({
          type: "debit",
          amount: input.amount,
          categoryId: cashCategoryId,
          description: input.notes ?? null,
          transactionDate: new Date(input.transactionDate),
          recordedBy: actorId,
          depositLocation: input.location,
          journalGroupId: groupId,
        })

        const [creditTx] = await tx
          .insert(transactions)
          .values({
            type: "credit",
            amount: input.amount,
            categoryId: input.categoryId,
            description: input.notes ?? null,
            transactionDate: new Date(input.transactionDate),
            recordedBy: actorId,
            journalGroupId: groupId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "transaction.create",
          entityType: "transaction",
          entityId: creditTx.id,
          beforeValue: null,
          afterValue: creditTx,
        })

        return creditTx
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 13: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -40`

Fix any remaining type errors in transaction.service.ts.

- [ ] **Step 14: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "feat: implement postJournalEntry and convert all autoPost functions to double-entry"
```

---

## Task 4: Update Loan Service Journal Posting

**Files:**
- Modify: `src/services/loan.service.ts`

The `autoPost*` function signatures haven't changed — they still accept the same params. But the internal reversal logic in `createLoan`, `updateLoan`, and `deleteLoan` posts single entries manually. These need to become double-entry pairs.

- [ ] **Step 1: Update createLoan — issuance fee posting**

In `createLoan`, the issuance fee block (around line 208-235) currently looks up "Issuance Fees" and inserts a single credit. Replace it with a `postJournalEntry` call:

```typescript
        // Auto-post issuance fee as double-entry (skip if zero)
        if (new BigNumber(input.issuanceFee).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Issuance Fees", type: "revenue" },
            amount: input.issuanceFee,
            referenceType: "loan",
            referenceId: loan.id,
            description: `Issuance fee for loan ${loan.id.slice(0, 8).toUpperCase()}`,
            transactionDate: startDate,
            recordedBy: actorId,
            debitDepositLocation: input.disbursementSource,
          })
        }
```

Add the import at top of file:

```typescript
import { postJournalEntry } from "./transaction.service"
```

- [ ] **Step 2: Update createLoan — rollover interest posting**

The rollover interest credit (around line 138-165) currently posts a single credit to "Interest Earned". Replace with:

```typescript
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Interest Earned", type: "revenue" },
              amount: input.rollover.carriedInterest,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              description: `Interest earned - loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()} rolled over into ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
            })
```

- [ ] **Step 3: Update deleteLoan — issuance fee reversal**

The fee reversal block (around line 454-477) currently posts a single debit. Replace with a double-entry reversal:

```typescript
        if (feeTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Issuance Fees", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: feeTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: feeTx.transactionDate,
            recordedBy: actorId,
            creditDepositLocation: feeTx.depositLocation ?? undefined,
          })
        }
```

Note: The fee lookup query still needs `eq(transactions.type, "credit")` to find the right row for the amount — keep that query, just replace the single reversal insert with `postJournalEntry`.

- [ ] **Step 4: Update deleteLoan — disbursement reversal**

Replace the single credit insert with:

```typescript
        if (disbursementTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Loans Receivable", type: "asset" },
            amount: disbursementTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - principal disbursement for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: disbursementTx.transactionDate,
            recordedBy: actorId,
            debitDepositLocation: disbursementTx.depositLocation ?? undefined,
            creditDepositLocation: disbursementTx.depositLocation ?? undefined,
          })
        }
```

- [ ] **Step 5: Update deleteLoan — payment interest reversals**

The loop that reverses each payment's interest (around line 510-534) currently posts single debits. Replace each with:

```typescript
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: p.interestPortion,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(p.paymentDate),
              recordedBy: actorId,
              creditDepositLocation: p.depositLocation ?? undefined,
            })
```

- [ ] **Step 6: Update deleteLoan — payment principal reversals**

The principal reversal block (around line 537-558) currently posts single debits. Replace with:

```typescript
            if (new BigNumber(p.principalPortion).isGreaterThan(0)) {
              await postJournalEntry(tx, {
                debitCategory: { name: "Loans Receivable", type: "asset" },
                creditCategory: { name: "Cash", type: "asset" },
                amount: p.principalPortion,
                referenceType: "payment_reversal",
                referenceId: p.id,
                description: `Reversal - principal repayment for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
                transactionDate: new Date(p.paymentDate),
                recordedBy: actorId,
                debitDepositLocation: p.depositLocation ?? undefined,
                creditDepositLocation: p.depositLocation ?? undefined,
              })
            }
```

- [ ] **Step 7: Update updateLoan — disbursement reversal/repost**

The principal change block (around line 382-416) posts single debit/credit entries. Replace with two `postJournalEntry` calls — one to reverse the old, one to post the new:

```typescript
          if (oldDisbursement) {
            // Reverse old disbursement
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: oldDisbursement.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - principal updated for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation: (oldDisbursement.depositLocation ?? existingLoan.disbursementSource) as any,
              creditDepositLocation: (oldDisbursement.depositLocation ?? existingLoan.disbursementSource) as any,
            })

            // Post new disbursement
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: input.principalAmount,
              referenceType: "loan",
              referenceId: input.loanId,
              description: `Principal disbursed - loan ${input.loanId.slice(0, 8).toUpperCase()} (updated)`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation: (oldDisbursement.depositLocation ?? existingLoan.disbursementSource) as any,
              creditDepositLocation: (oldDisbursement.depositLocation ?? existingLoan.disbursementSource) as any,
            })
          }
```

- [ ] **Step 8: Clean up old category lookups**

Remove the manual `transactionCategories` lookups in `deleteLoan` that were used to find "Interest Earned" and "Principal Repayment" categories — `postJournalEntry` handles category resolution internally.

- [ ] **Step 9: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep loan.service`

- [ ] **Step 10: Commit**

```bash
git add src/services/loan.service.ts
git commit -m "feat: convert loan service journal postings to double-entry"
```

---

## Task 5: Update Payment Service Journal Posting

**Files:**
- Modify: `src/services/payment.service.ts`

- [ ] **Step 1: Update reconcileDownstreamJournals — interest reversals**

Import `postJournalEntry`:

```typescript
import { autoPostInterestEarned, autoPostPrincipalRepayment, postJournalEntry } from "./transaction.service"
```

Replace the manual interest reversal insert (around line 71-82) with:

```typescript
      await postJournalEntry(tx, {
        debitCategory: { name: "Interest Earned", type: "revenue" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: oldInterest,
        referenceType: "payment_reversal",
        referenceId: dp.id,
        description: `Reversal - downstream recalculation from payment ${triggerPaymentId} edit`,
        transactionDate: dp.paymentDate,
        recordedBy: actorId,
        creditDepositLocation: (dp as any).depositLocation ?? undefined,
      })
```

- [ ] **Step 2: Update reconcileDownstreamJournals — principal reversals**

Replace the manual principal reversal insert (around line 113-124) with:

```typescript
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: oldPrincipal,
              referenceType: "payment_reversal",
              referenceId: dp.id,
              description: `Reversal - downstream principal recalculation from payment ${triggerPaymentId} edit`,
              transactionDate: dp.paymentDate,
              recordedBy: actorId,
            })
```

Remove the manual category lookups for "Interest Earned" and "Principal Repayment" that are no longer needed.

- [ ] **Step 3: Update editPayment — interest reversal**

Replace the manual interest reversal (around line 527-537) with:

```typescript
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: beforeValue.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(beforeValue.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: beforeValue.depositLocation ?? undefined,
          })
```

- [ ] **Step 4: Update editPayment — principal reversal**

Replace the manual principal reversal (around line 552-562) with:

```typescript
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: beforeValue.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(beforeValue.paymentDate),
            recordedBy: actorId,
          })
```

- [ ] **Step 5: Update deletePayment — interest reversal**

Replace the manual interest reversal (around line 721-730) with:

```typescript
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: payment.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
          })
```

- [ ] **Step 6: Update deletePayment — principal reversal**

Replace the manual principal reversal (around line 746-756) with:

```typescript
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: payment.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
          })
```

- [ ] **Step 7: Remove old category lookups**

Remove all manual `transactionCategories` lookups for "Interest Earned" and "Principal Repayment" in `editPayment`, `deletePayment`, and `reconcileDownstreamJournals`. The `postJournalEntry` function handles category resolution internally.

- [ ] **Step 8: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep payment.service`

- [ ] **Step 9: Commit**

```bash
git add src/services/payment.service.ts
git commit -m "feat: convert payment service journal postings to double-entry"
```

---

## Task 6: Update Creditor and Collateral Services

**Files:**
- Modify: `src/services/creditor.service.ts`
- Modify: `src/services/collateral-settlement.service.ts`

- [ ] **Step 1: Update collateral-settlement.service.ts**

The `settleWithCollateral` function posts single entries for interest and principal recovery. Replace:

For the interest posting (around line 165-177):

```typescript
        if (accruedInterest.isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Seized Collateral", type: "asset" },
            creditCategory: { name: "Interest Earned", type: "revenue" },
            amount: formatAmount(accruedInterest),
            referenceType: "collateral_settlement",
            referenceId: input.loanId,
            description: `Accrued interest on collateral settlement for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
            transactionDate: now,
            recordedBy: actorId,
          })
        }
```

For the principal recovery (around line 180-192), the existing `autoPostPrincipalRecovery` call already delegates to `postJournalEntry` after Task 3 — so this just works. But remove the direct `getOrCreateCategory` + `tx.insert` code and use:

```typescript
        if (outstandingPrincipal.isGreaterThan(0)) {
          await autoPostPrincipalRecovery(tx, {
            amount: formatAmount(outstandingPrincipal),
            loanId: input.loanId,
            transactionDate: now.toISOString(),
            actorId,
          })
        }
```

Add import:

```typescript
import { postJournalEntry, autoPostPrincipalRecovery } from "@/services/transaction.service"
```

Remove the local `getOrCreateCategory` function — it's now inside `transaction.service.ts`.

- [ ] **Step 2: Verify no direct tx.insert(transactions) remains in collateral-settlement.service.ts**

All journal posting should go through `postJournalEntry` or `autoPost*` wrappers.

- [ ] **Step 3: Verify creditor.service.ts**

The `addInvestment` and `recordCreditorRepayment` functions already call `autoPostCreditorInvestment`, `autoPostInterestExpense`, and `autoPostCreditorPrincipalRepaid` — which were rewritten in Task 3 to use `postJournalEntry`. No changes needed in creditor.service.ts itself unless there are direct `tx.insert(transactions)` calls.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -E "creditor|collateral"`

- [ ] **Step 5: Commit**

```bash
git add src/services/collateral-settlement.service.ts src/services/creditor.service.ts
git commit -m "feat: convert collateral and creditor services to double-entry"
```

---

## Task 7: Rewrite Balance Sheet to Ledger-Derived

**Files:**
- Modify: `src/services/report.service.ts`

This is the payoff — replace the entire multi-table `getBalanceSheetData` with a single ledger query.

- [ ] **Step 1: Rewrite getBalanceSheetData**

Replace the entire function body (from line ~177 to the closing `)`). The new implementation:

```typescript
export const getBalanceSheetData = (
  asOf: string
): Effect.Effect<BalanceSheetData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      let asOfDate: Date
      if (/^\d{4}-\d{2}$/.test(asOf)) {
        const [year, month] = asOf.split("-").map(Number)
        asOfDate = new Date(year, month, 0, 23, 59, 59, 999)
      } else {
        asOfDate = new Date(asOf + "T23:59:59.999Z")
      }

      // Single ledger query — group by category name, type, transaction type, and location
      const rows = await db
        .select({
          categoryName: transactionCategories.name,
          categoryType: transactionCategories.type,
          txType: transactions.type,
          depositLocation: transactions.depositLocation,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(lte(transactions.transactionDate, asOfDate))
        .groupBy(
          transactionCategories.name,
          transactionCategories.type,
          transactions.type,
          transactions.depositLocation
        )

      // Build balances from ledger using normal balance rules
      // DR normal (asset, expense): balance = debits - credits
      // CR normal (liability, equity, revenue): balance = credits - debits
      const locationBalances: Record<string, BigNumber> = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }
      let totalLoansOutstanding = new BigNumber(0)
      let seizedCollateralValue = new BigNumber(0)
      let totalCreditorBalances = new BigNumber(0)
      let shareCapital = new BigNumber(0)
      let totalRevenue = new BigNumber(0)
      let totalExpenses = new BigNumber(0)

      for (const row of rows) {
        const amount = new BigNumber(row.total)
        const isDebit = row.txType === "debit"

        if (row.categoryName === "Cash" && row.depositLocation) {
          const loc = row.depositLocation
          if (locationBalances[loc] !== undefined) {
            // Asset: DR adds, CR subtracts
            locationBalances[loc] = isDebit
              ? locationBalances[loc].plus(amount)
              : locationBalances[loc].minus(amount)
          }
        } else if (row.categoryName === "Loans Receivable") {
          // Asset: DR adds, CR subtracts
          totalLoansOutstanding = isDebit
            ? totalLoansOutstanding.plus(amount)
            : totalLoansOutstanding.minus(amount)
        } else if (row.categoryName === "Seized Collateral") {
          // Asset: DR adds, CR subtracts
          seizedCollateralValue = isDebit
            ? seizedCollateralValue.plus(amount)
            : seizedCollateralValue.minus(amount)
        } else if (row.categoryName === "Creditor Investment") {
          // Liability: CR adds, DR subtracts
          totalCreditorBalances = isDebit
            ? totalCreditorBalances.minus(amount)
            : totalCreditorBalances.plus(amount)
        } else if (row.categoryName === "Share Capital") {
          // Equity: CR adds, DR subtracts
          shareCapital = isDebit
            ? shareCapital.minus(amount)
            : shareCapital.plus(amount)
        } else if (row.categoryType === "revenue") {
          // Revenue: CR adds, DR subtracts
          totalRevenue = isDebit
            ? totalRevenue.minus(amount)
            : totalRevenue.plus(amount)
        } else if (row.categoryType === "expense") {
          // Expense: DR adds, CR subtracts
          totalExpenses = isDebit
            ? totalExpenses.plus(amount)
            : totalExpenses.minus(amount)
        }
      }

      const cashBalance = locationBalances.cash
      const bankBalance = locationBalances.bank
      const strongRoomBalance = locationBalances.strong_room
      const totalAssets = totalLoansOutstanding
        .plus(cashBalance)
        .plus(bankBalance)
        .plus(strongRoomBalance)
        .plus(seizedCollateralValue)

      const retainedEarnings = totalRevenue.minus(totalExpenses)
      const totalEquity = shareCapital.plus(retainedEarnings)

      const liabilitiesPlusEquity = totalCreditorBalances.plus(totalEquity)
      if (!totalAssets.isEqualTo(liabilitiesPlusEquity)) {
        console.warn(
          `Balance sheet imbalance: Assets=${formatAmount(totalAssets)}, ` +
            `Liabilities+Equity=${formatAmount(liabilitiesPlusEquity)} ` +
            `(diff=${formatAmount(totalAssets.minus(liabilitiesPlusEquity))})`
        )
      }

      return {
        asOf,
        assets: {
          cashBalance: formatAmount(cashBalance),
          bankBalance: formatAmount(bankBalance),
          strongRoomBalance: formatAmount(strongRoomBalance),
          totalLoansOutstanding: formatAmount(totalLoansOutstanding),
          seizedCollateralValue: formatAmount(seizedCollateralValue),
          totalAssets: formatAmount(totalAssets),
        },
        liabilities: {
          totalCreditorBalances: formatAmount(totalCreditorBalances),
        },
        equity: {
          shareCapital: formatAmount(shareCapital),
          retainedEarnings: formatAmount(retainedEarnings),
          totalEquity: formatAmount(totalEquity),
        },
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 2: Remove unused imports**

Remove imports that were only used by the old balance sheet query:
- `loans` (if not used elsewhere in report.service.ts)
- `payments` (if not used elsewhere)
- `fundTransfers`
- `customers` (check if portfolio still needs it)
- `getSystemCapital` from creditor.service
- `isNull`, `desc` (check if still needed by other functions)

Keep imports needed by `getPnlData`, `getRetainedEarningsData`, `getPortfolioData`, and `generateMonthlySnapshot`.

- [ ] **Step 3: Update P&L type filter**

In `getPnlData`, change:

```typescript
inArray(transactionCategories.type, ["income", "expense"])
```

to:

```typescript
inArray(transactionCategories.type, ["revenue", "expense"])
```

- [ ] **Step 4: Update Retained Earnings type filter**

In `getRetainedEarningsData`, change both occurrences of:

```typescript
inArray(transactionCategories.type, ["income", "expense"])
```

to:

```typescript
inArray(transactionCategories.type, ["revenue", "expense"])
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep report.service`

- [ ] **Step 6: Commit**

```bash
git add src/services/report.service.ts
git commit -m "feat: rewrite balance sheet to derive entirely from ledger"
```

---

## Task 8: Update Expense and Income UI Forms

**Files:**
- Modify: `src/app/(app)/expenses/ExpenseListClient.tsx`
- Modify: `src/app/(app)/income/IncomeListClient.tsx`

The `location` field is now required on `CreateExpenseInput` and `CreateIncomeInput`. The UI forms need a location selector.

- [ ] **Step 1: Add location selector to expense form**

In `ExpenseListClient.tsx`, find the form section where amount, category, date are collected. Add a Select for location:

```tsx
<Select value={location} onValueChange={setLocation}>
  <SelectTrigger>
    <SelectValue placeholder="Source location" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="cash">Cash on Hand</SelectItem>
    <SelectItem value="bank">Bank</SelectItem>
    <SelectItem value="strong_room">Strong Room</SelectItem>
  </SelectContent>
</Select>
```

Add the state: `const [location, setLocation] = useState<string>("cash")`

Include `location` in the form data sent to the action.

- [ ] **Step 2: Add location selector to income form**

Same pattern in `IncomeListClient.tsx`.

- [ ] **Step 3: Verify the pages render**

Run: `npx next build 2>&1 | tail -20` (or use dev server)

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/expenses/ExpenseListClient.tsx src/app/(app)/income/IncomeListClient.tsx
git commit -m "feat: add location selector to expense and income forms for double-entry cash tracking"
```

---

## Task 9: Update Test Fixtures and Verify

**Files:**
- Modify: `src/services/__tests__/excel.service.test.ts`
- Modify: `src/services/__tests__/pdf.service.test.ts`
- Modify: any other test files referencing old category types

- [ ] **Step 1: Update test fixtures**

In any test file that references `"income"` or `"balance_sheet"` as category types, update to `"revenue"`, `"asset"`, `"liability"`, or `"equity"` as appropriate.

Search for all occurrences:

```bash
grep -rn '"income"\|"balance_sheet"\|category_type' src/services/__tests__/ src/services/__integration__/
```

Update each occurrence based on the category mapping from the spec.

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`

Fix any remaining type errors.

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run 2>&1 | tail -30`

Fix any test failures. Tests that mock transaction posting will need to account for `journalGroupId` and the new category types.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: update test fixtures for double-entry category types"
```

---

## Task 10: Final Verification and Cleanup

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`

Zero new errors expected (pre-existing loans.ts and chat.service.test.ts errors are acceptable).

- [ ] **Step 2: Verify no direct tx.insert(transactions) remains outside postJournalEntry**

Run: `grep -rn 'tx.insert(transactions)' src/services/ --include='*.ts' | grep -v transaction.service.ts | grep -v __tests__`

Any hits outside `transaction.service.ts` are bugs — they should use `postJournalEntry` or an `autoPost*` wrapper.

- [ ] **Step 3: Verify no old category type references remain**

Run: `grep -rn '"balance_sheet"\|"income"' src/services/ src/types/ --include='*.ts' | grep -v __tests__ | grep -v node_modules`

The only acceptable hits are:
- The enum definition itself (which still has old values for PostgreSQL compatibility)
- Comments explaining the migration

- [ ] **Step 4: Build check**

Run: `npx next build 2>&1 | tail -20`

Verify the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: final cleanup for double-entry ledger migration"
```
