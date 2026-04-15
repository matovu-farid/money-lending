# Bank Accounts as Sub-Location Ledger Accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bank account management so each bank account is a first-class ledger account with independent balance tracking, selectable inline whenever "Bank" is chosen as a deposit location.

**Architecture:** New `bank_accounts` table + nullable `subLocationId` FK on loans, payments, transactions, fund_transfers. TanStack DB collection for bank accounts. Inline bank account dropdown appears in all deposit location selects when "Bank" is chosen. Balance computation extended to return per-account balances. All journal entries tag the specific bank account.

**Tech Stack:** Drizzle ORM, Effect, Next.js Server Actions, TanStack React DB, React Hook Form, shadcn/ui

---

### Task 1: Database Schema — `bank_accounts` Table

**Files:**
- Create: `src/lib/db/schema/bank-accounts.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the bank_accounts schema file**

```ts
// src/lib/db/schema/bank-accounts.ts
import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core"

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 2: Export from schema index**

In `src/lib/db/schema/index.ts`, add:

```ts
export * from "./bank-accounts"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema/bank-accounts.ts src/lib/db/schema/index.ts
git commit -m "feat: add bank_accounts schema table"
```

---

### Task 2: Add `subLocationId` Columns to Existing Tables

**Files:**
- Modify: `src/lib/db/schema/loans.ts`
- Modify: `src/lib/db/schema/payments.ts`
- Modify: `src/lib/db/schema/transactions.ts`
- Modify: `src/lib/db/schema/fund-transfers.ts`

- [ ] **Step 1: Add subLocationId to loans**

In `src/lib/db/schema/loans.ts`, add import and column:

```ts
import { bankAccounts } from "./bank-accounts"
```

Add after the `disbursementSource` column definition:

```ts
  subLocationId: uuid("sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
```

- [ ] **Step 2: Add subLocationId to payments**

In `src/lib/db/schema/payments.ts`, add import and column:

```ts
import { bankAccounts } from "./bank-accounts"
```

Add after the `depositLocation` column definition:

```ts
  subLocationId: uuid("sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
```

- [ ] **Step 3: Add subLocationId to transactions**

In `src/lib/db/schema/transactions.ts`, add import and column:

```ts
import { bankAccounts } from "./bank-accounts"
```

Add after the `depositLocation` column definition:

```ts
  subLocationId: uuid("sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
```

- [ ] **Step 4: Add fromSubLocationId and toSubLocationId to fund_transfers**

In `src/lib/db/schema/fund-transfers.ts`, add import and columns:

```ts
import { bankAccounts } from "./bank-accounts"
```

Add after the `toLocation` column definition:

```ts
  fromSubLocationId: uuid("from_sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
  toSubLocationId: uuid("to_sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
```

- [ ] **Step 5: Push schema to database**

```bash
npx drizzle-kit push
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema/loans.ts src/lib/db/schema/payments.ts src/lib/db/schema/transactions.ts src/lib/db/schema/fund-transfers.ts
git commit -m "feat: add subLocationId FK columns to loans, payments, transactions, fund_transfers"
```

---

### Task 3: Types — Bank Account & Input Types

**Files:**
- Create: `src/types/bank-account.ts`
- Modify: `src/types/index.ts`
- Modify: `src/types/fund-transfer.ts`
- Modify: `src/types/loan.ts`
- Modify: `src/types/payment.ts`
- Modify: `src/types/transaction.ts`

- [ ] **Step 1: Create bank-account type file**

```ts
// src/types/bank-account.ts
import type { InferSelectModel } from "drizzle-orm"
import type { bankAccounts } from "@/lib/db/schema/bank-accounts"

export type BankAccount = InferSelectModel<typeof bankAccounts>

export interface CreateBankAccountInput {
  id?: string
  name: string
}

export interface UpdateBankAccountInput {
  id: string
  name?: string
  isActive?: boolean
}
```

- [ ] **Step 2: Export from types index**

In `src/types/index.ts`, add:

```ts
export * from "./bank-account"
```

- [ ] **Step 3: Add subLocationId to CreateFundTransferInput and CreateCapitalInjectionInput**

In `src/types/fund-transfer.ts`, update both interfaces:

```ts
export interface CreateFundTransferInput {
  id?: string
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string
  note?: string
  fromSubLocationId?: string
  toSubLocationId?: string
}

export interface CreateCapitalInjectionInput {
  id?: string
  toLocation: DepositLocation
  amount: string
  note?: string
  toSubLocationId?: string
}
```

- [ ] **Step 4: Add subLocationId to CreateLoanInput**

In `src/types/loan.ts`, add to the `CreateLoanInput` interface:

```ts
  subLocationId?: string
```

Add it after the `disbursementSource` field.

- [ ] **Step 5: Add subLocationId to RecordPaymentInput**

In `src/types/payment.ts`, add to the `RecordPaymentInput` interface:

```ts
  subLocationId?: string
```

Add it after the `depositLocation` field.

- [ ] **Step 6: Add subLocationId to CreateTransactionInput**

In `src/types/transaction.ts`, add to the `CreateTransactionInput` interface:

```ts
  subLocationId?: string
```

Add it after the `location` field.

- [ ] **Step 7: Commit**

```bash
git add src/types/bank-account.ts src/types/index.ts src/types/fund-transfer.ts src/types/loan.ts src/types/payment.ts src/types/transaction.ts
git commit -m "feat: add bank account types and subLocationId to all input types"
```

---

### Task 4: Bank Account Service

**Files:**
- Create: `src/services/bank-account.service.ts`

- [ ] **Step 1: Create the service**

```ts
// src/services/bank-account.service.ts
import { Effect } from "effect"
import { db } from "@/lib/db"
import { bankAccounts } from "@/lib/db/schema/bank-accounts"
import { eq, asc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import type { CreateBankAccountInput, UpdateBankAccountInput, BankAccount } from "@/types"

export const createBankAccount = (
  input: CreateBankAccountInput,
  actorId: string
): Effect.Effect<BankAccount, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [account] = await tx
          .insert(bankAccounts)
          .values({
            ...(input.id ? { id: input.id } : {}),
            name: input.name.trim(),
            createdBy: actorId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "bank_account.create",
          entityType: "bank_account",
          entityId: account.id,
          beforeValue: null,
          afterValue: account,
        })

        return account
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createBankAccount({ ...input, id: undefined }, actorId)
    )
  )

export const updateBankAccount = (
  input: UpdateBankAccountInput,
  actorId: string
): Effect.Effect<BankAccount, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(bankAccounts)
          .where(eq(bankAccounts.id, input.id))

        if (!before) throw new Error("Bank account not found")

        const updates: Partial<typeof bankAccounts.$inferInsert> = {}
        if (input.name !== undefined) updates.name = input.name.trim()
        if (input.isActive !== undefined) updates.isActive = input.isActive

        const [updated] = await tx
          .update(bankAccounts)
          .set(updates)
          .where(eq(bankAccounts.id, input.id))
          .returning()

        const action = input.isActive === false
          ? "bank_account.deactivate"
          : input.isActive === true && !before.isActive
            ? "bank_account.reactivate"
            : "bank_account.update"

        await writeAuditLog(tx, {
          actorId,
          action,
          entityType: "bank_account",
          entityId: updated.id,
          beforeValue: before,
          afterValue: updated,
        })

        return updated
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listBankAccounts = (): Effect.Effect<BankAccount[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(bankAccounts)
        .orderBy(asc(bankAccounts.name))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/services/bank-account.service.ts
git commit -m "feat: add bank account service (create, update, list)"
```

---

### Task 5: Bank Account Server Actions

**Files:**
- Create: `src/actions/bank-account.actions.ts`

- [ ] **Step 1: Create the actions file**

```ts
// src/actions/bank-account.actions.ts
"use server"

import { withAction } from "@/lib/with-action"
import { createBankAccount, updateBankAccount, listBankAccounts } from "@/services/bank-account.service"
import type { CreateBankAccountInput, UpdateBankAccountInput } from "@/types"

export const createBankAccountAction = withAction<CreateBankAccountInput, any>({
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.name || input.name.trim().length === 0) {
      return { error: "Bank account name is required" }
    }
    if (input.name.trim().length > 100) {
      return { error: "Bank account name must be 100 characters or fewer" }
    }

    try {
      const { Effect } = await import("effect")
      const data = await Effect.runPromise(createBankAccount(input, session.user.id))
      return { data }
    } catch {
      return { error: "Failed to create bank account. Name may already be in use." }
    }
  },
})

export const updateBankAccountAction = withAction<UpdateBankAccountInput, any>({
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.id) {
      return { error: "Bank account ID is required" }
    }

    // Deactivation/reactivation requires admin role
    if (input.isActive !== undefined) {
      const role = (session.user as any).role
      if (role !== "admin" && role !== "superAdmin") {
        return { error: "Only admins can deactivate or reactivate bank accounts" }
      }
    }

    if (input.name !== undefined && input.name.trim().length === 0) {
      return { error: "Bank account name cannot be empty" }
    }

    try {
      const { Effect } = await import("effect")
      const data = await Effect.runPromise(updateBankAccount(input, session.user.id))
      return { data }
    } catch {
      return { error: "Failed to update bank account" }
    }
  },
})

export const listBankAccountsAction = withAction({
  permission: "fund-transfer:read",
  forbiddenMessage: "Forbidden",
  effect: () => listBankAccounts(),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/bank-account.actions.ts
git commit -m "feat: add bank account server actions"
```

---

### Task 6: Query Keys & TanStack DB Collection

**Files:**
- Modify: `src/lib/query-keys.ts`
- Create: `src/collections/bank-accounts.ts`
- Modify: `src/collections/index.ts`

- [ ] **Step 1: Add bankAccounts query key**

In `src/lib/query-keys.ts`, add after the `fundTransfers` key:

```ts
  // ── Bank Accounts ────────────────────────────────────────────────────
  bankAccounts: {
    all: ["bank-accounts"] as const,
  },
```

- [ ] **Step 2: Create the bank-accounts collection**

```ts
// src/collections/bank-accounts.ts
"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listBankAccountsAction,
  createBankAccountAction,
  updateBankAccountAction,
} from "@/actions/bank-account.actions"
import type { BankAccount, CreateBankAccountInput, UpdateBankAccountInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const pendingInsertInputs = new Map<string, CreateBankAccountInput>()
const pendingUpdateInputs = new Map<string, UpdateBankAccountInput>()

export const bankAccountCollection = createCollection(
  queryCollectionOptions<BankAccount>({
    queryKey: [...queryKeys.bankAccounts.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<BankAccount>> => {
      const result = await listBankAccountsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (account) => account.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing bank account input for optimistic insert")
      }
      const result = await createBankAccountAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingInsertInputs.delete(modified.id)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all })
    },
    onUpdate: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingUpdateInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing bank account input for optimistic update")
      }
      const result = await updateBankAccountAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      pendingUpdateInputs.delete(modified.id)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all })
    },
  })
)

export function insertBankAccountWithInput(
  id: string,
  optimistic: BankAccount,
  input: CreateBankAccountInput
) {
  pendingInsertInputs.set(id, input)
  bankAccountCollection.insert(optimistic)
}

export function updateBankAccountWithInput(
  input: UpdateBankAccountInput,
  optimisticUpdates: Partial<BankAccount>
) {
  pendingUpdateInputs.set(input.id, input)
  bankAccountCollection.update({
    where: { id: input.id },
    set: optimisticUpdates,
  })
}
```

- [ ] **Step 3: Export from collections index**

In `src/collections/index.ts`, add:

```ts
export {
  bankAccountCollection,
  insertBankAccountWithInput,
  updateBankAccountWithInput,
} from "./bank-accounts"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/query-keys.ts src/collections/bank-accounts.ts src/collections/index.ts
git commit -m "feat: add bank accounts TanStack DB collection and query keys"
```

---

### Task 7: Extend `postJournalEntry` to Accept `subLocationId`

**Files:**
- Modify: `src/services/transaction.service.ts` (the `postJournalEntry` function)

- [ ] **Step 1: Add subLocationId params to postJournalEntry**

In `src/services/transaction.service.ts`, update the `postJournalEntry` function's params type to add:

```ts
    debitSubLocationId?: string
    creditSubLocationId?: string
```

Add these after `creditDepositLocation` in the params object.

Then in the debit insert `.values()` call, add:

```ts
    subLocationId: params.debitSubLocationId ?? null,
```

And in the credit insert `.values()` call, add:

```ts
    subLocationId: params.creditSubLocationId ?? null,
```

- [ ] **Step 2: Update recordExpense to pass subLocationId**

In `recordExpense()`, update the credit-side `Cash` insert to also pass `subLocationId`:

Change the credit insert `.values()` to include:

```ts
    subLocationId: input.subLocationId ?? null,
```

- [ ] **Step 3: Update recordIncome to pass subLocationId**

In `recordIncome()`, update the debit-side `Cash` insert to also pass `subLocationId`:

```ts
    subLocationId: input.subLocationId ?? null,
```

- [ ] **Step 4: Commit**

```bash
git add src/services/transaction.service.ts
git commit -m "feat: extend postJournalEntry to accept subLocationId"
```

---

### Task 8: Extend Auto-Post Functions for subLocationId

**Files:**
- Modify: `src/services/auto-post.service.ts`

- [ ] **Step 1: Add subLocationId to all auto-post function params**

Update each function's params type to include optional `subLocationId?: string` (or `fromSubLocationId`/`toSubLocationId` for fund transfers). Then pass them through to the `postJournalEntry` calls.

For `autoPostInterestEarned` — add `subLocationId?: string` to params, pass as `debitSubLocationId`:

```ts
export async function autoPostInterestEarned(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Interest Earned", type: "revenue" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Interest earned - loan ${params.loanId} payment ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}
```

For `autoPostPrincipalDisbursement` — add `subLocationId?: string`, pass as `creditSubLocationId`:

```ts
export async function autoPostPrincipalDisbursement(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; transactionDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Loans Receivable", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "loan", referenceId: params.loanId,
    description: `Principal disbursed - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    creditDepositLocation: params.depositLocation,
    creditSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}
```

For `autoPostPrincipalRepayment` — add `subLocationId?: string`, pass as `debitSubLocationId`:

```ts
export async function autoPostPrincipalRepayment(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Principal repaid - loan ${shortId(params.loanId).toUpperCase()} payment ${shortId(params.paymentId).toUpperCase()}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}
```

For `autoPostCreditorInvestment` — add `subLocationId?: string`, pass as `debitSubLocationId`:

```ts
export async function autoPostCreditorInvestment(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; investmentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Creditor Investment", type: "liability" },
    amount: params.amount, referenceType: "creditor_investment", referenceId: params.investmentId,
    description: `Creditor investment received - ${shortId(params.investmentId).toUpperCase()}`,
    transactionDate: new Date(params.investmentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
  })
}
```

For `autoPostInterestExpense` — add `subLocationId?: string`, pass as `creditSubLocationId`:

```ts
export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentId?: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Interest Payments", type: "expense" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.repaymentId ?? params.investmentId,
    description: `Interest paid - investment ${params.investmentId}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
    creditSubLocationId: params.subLocationId,
  })
}
```

For `autoPostCreditorPrincipalRepaid` — add `subLocationId?: string`, pass as `creditSubLocationId`:

```ts
export async function autoPostCreditorPrincipalRepaid(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentId?: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Creditor Investment", type: "liability" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.repaymentId ?? params.investmentId,
    description: `Creditor principal repaid - investment ${shortId(params.investmentId).toUpperCase()}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
    creditSubLocationId: params.subLocationId,
  })
}
```

For `autoPostFundTransfer` — add `fromSubLocationId?: string` and `toSubLocationId?: string`:

```ts
export async function autoPostFundTransfer(
  tx: DrizzleTransaction,
  params: { amount: string; transferId: string; fromLocation: "cash" | "bank" | "strong_room"; toLocation: "cash" | "bank" | "strong_room"; transactionDate: string; actorId: string; fromSubLocationId?: string; toSubLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "fund_transfer", referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    debitDepositLocation: params.toLocation, creditDepositLocation: params.fromLocation,
    debitSubLocationId: params.toSubLocationId, creditSubLocationId: params.fromSubLocationId,
  })
}
```

For `autoPostCapitalInjection` — add `subLocationId?: string`:

```ts
export async function autoPostCapitalInjection(
  tx: DrizzleTransaction,
  params: { amount: string; transferId: string; toLocation: "cash" | "bank" | "strong_room"; transactionDate: string; actorId: string; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Share Capital", type: "equity" },
    amount: params.amount, referenceType: "capital_injection", referenceId: params.transferId,
    description: `Capital injection to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    debitDepositLocation: params.toLocation,
    debitSubLocationId: params.subLocationId,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/auto-post.service.ts
git commit -m "feat: pass subLocationId through all auto-post journal entries"
```

---

### Task 9: Pass subLocationId Through Services

**Files:**
- Modify: `src/services/fund-transfer.service.ts`
- Modify: `src/services/loan.service.ts` (the `createLoan` function — find where `autoPostPrincipalDisbursement` is called)
- Modify: `src/services/payment.service.ts` (where `autoPostInterestEarned` and `autoPostPrincipalRepayment` are called)

- [ ] **Step 1: Fund transfer service — pass subLocationId fields**

In `src/services/fund-transfer.service.ts`, update `createFundTransfer`:

In the `.values()` call, add:

```ts
  fromSubLocationId: input.fromSubLocationId ?? null,
  toSubLocationId: input.toSubLocationId ?? null,
```

In the `autoPostFundTransfer` call, add:

```ts
  fromSubLocationId: input.fromSubLocationId,
  toSubLocationId: input.toSubLocationId,
```

Update `createCapitalInjection`:

In the `.values()` call, add:

```ts
  toSubLocationId: input.toSubLocationId ?? null,
```

In the `autoPostCapitalInjection` call, add:

```ts
  subLocationId: input.toSubLocationId,
```

- [ ] **Step 2: Loan service — pass subLocationId on disbursement**

Find the `createLoan` function in `src/services/loan.service.ts`. In the loan insert `.values()`, add:

```ts
  subLocationId: input.subLocationId ?? null,
```

In the `autoPostPrincipalDisbursement` call, add:

```ts
  subLocationId: input.subLocationId,
```

- [ ] **Step 3: Payment service — pass subLocationId on payment recording**

Find `recordPayment` in `src/services/payment.service.ts`. In the payment insert `.values()`, add:

```ts
  subLocationId: input.subLocationId ?? null,
```

In both `autoPostInterestEarned` and `autoPostPrincipalRepayment` calls, add:

```ts
  subLocationId: input.subLocationId,
```

- [ ] **Step 4: Commit**

```bash
git add src/services/fund-transfer.service.ts src/services/loan.service.ts src/services/payment.service.ts
git commit -m "feat: pass subLocationId through fund transfer, loan, and payment services"
```

---

### Task 10: Server Action Validation for subLocationId

**Files:**
- Modify: `src/actions/fund-transfer.actions.ts`
- Modify: `src/actions/payment.actions.ts`
- Modify: `src/actions/expense.actions.ts`

- [ ] **Step 1: Fund transfer actions — validate subLocationId when bank**

In `src/actions/fund-transfer.actions.ts`, in `createFundTransferAction`:

After the existing location validations, add:

```ts
    if (input.fromLocation === "bank" && !input.fromSubLocationId) {
      return { error: "Please select a bank account for the source" }
    }
    if (input.toLocation === "bank" && !input.toSubLocationId) {
      return { error: "Please select a bank account for the destination" }
    }
```

In `createCapitalInjectionAction`, after the toLocation validation, add:

```ts
    if (input.toLocation === "bank" && !input.toSubLocationId) {
      return { error: "Please select a bank account" }
    }
```

- [ ] **Step 2: Payment actions — validate subLocationId when bank**

In `src/actions/payment.actions.ts`, in `recordPaymentAction`, after the depositLocation validation, add:

```ts
    if (input.depositLocation === "bank" && !input.subLocationId) {
      return { error: "Please select a bank account" }
    }
```

- [ ] **Step 3: Expense actions — validate subLocationId when bank**

In `src/actions/expense.actions.ts`, in `recordExpenseAction`, after the location validation, add:

```ts
    if (input.location === "bank" && !input.subLocationId) {
      return { error: "Please select a bank account" }
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/fund-transfer.actions.ts src/actions/payment.actions.ts src/actions/expense.actions.ts
git commit -m "feat: validate subLocationId required when deposit location is bank"
```

---

### Task 11: Extend Balance Computation for Per-Account Balances

**Files:**
- Modify: `src/services/report.service.ts`

- [ ] **Step 1: Update getLocationBalances return type and logic**

Update `getLocationBalances` to also return per-bank-account balances:

```ts
export const getLocationBalances = (): Effect.Effect<
  {
    cash: string
    bank: string
    strong_room: string
    bankAccounts: Record<string, string>
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          txType: transactions.type,
          depositLocation: transactions.depositLocation,
          subLocationId: transactions.subLocationId,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(eq(transactionCategories.name, "Cash"))
        .groupBy(transactions.type, transactions.depositLocation, transactions.subLocationId)

      const balances = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }
      const bankAccountBalances: Record<string, BigNumber> = {}

      for (const row of rows) {
        const amount = new BigNumber(row.total)
        const loc = (row.depositLocation ?? "cash") as keyof typeof balances
        if (balances[loc] !== undefined) {
          balances[loc] = row.txType === "debit"
            ? balances[loc].plus(amount)
            : balances[loc].minus(amount)
        }

        // Track per-bank-account balance
        if (loc === "bank" && row.subLocationId) {
          const existing = bankAccountBalances[row.subLocationId] ?? new BigNumber(0)
          bankAccountBalances[row.subLocationId] = row.txType === "debit"
            ? existing.plus(amount)
            : existing.minus(amount)
        }
      }

      const bankAccountsFormatted: Record<string, string> = {}
      for (const [id, bal] of Object.entries(bankAccountBalances)) {
        bankAccountsFormatted[id] = formatAmount(bal)
      }

      return {
        cash: formatAmount(balances.cash),
        bank: formatAmount(balances.bank),
        strong_room: formatAmount(balances.strong_room),
        bankAccounts: bankAccountsFormatted,
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 2: Update getBalanceSheetData to show per-bank-account balances**

In `getBalanceSheetData`, update the `locationBalances` initialization and the processing loop to also track per-bank-account balances, similar to the pattern above. Add `subLocationId` to the select and groupBy.

Add to the `locationBalances` object initialization:

```ts
const bankAccountBalances: Record<string, BigNumber> = {}
```

In the `for (const row of rows)` loop, inside the `if (row.categoryName === "Cash")` block, add after updating `locationBalances[loc]`:

```ts
          if (loc === "bank" && row.subLocationId) {
            const existing = bankAccountBalances[row.subLocationId] ?? new BigNumber(0)
            bankAccountBalances[row.subLocationId] = isDebit
              ? existing.plus(amount)
              : existing.minus(amount)
          }
```

Then in the return value, add `bankAccountBalances` to the assets:

```ts
        assets: {
          cashBalance: formatAmount(cashBalance),
          bankBalance: formatAmount(bankBalance),
          strongRoomBalance: formatAmount(strongRoomBalance),
          bankAccountBalances: Object.fromEntries(
            Object.entries(bankAccountBalances).map(([id, bal]) => [id, formatAmount(bal)])
          ),
          // ... rest of assets
        },
```

- [ ] **Step 3: Update BalanceSheetData type**

In `src/types/transaction.ts`, update the `BalanceSheetData.assets` type:

Add:

```ts
    bankAccountBalances: Record<string, string>
```

- [ ] **Step 4: Commit**

```bash
git add src/services/report.service.ts src/types/transaction.ts
git commit -m "feat: extend location balances and balance sheet for per-bank-account tracking"
```

---

### Task 12: Bank Account Picker Component

**Files:**
- Create: `src/components/ui/bank-account-select.tsx`

- [ ] **Step 1: Create the inline bank account select component**

```tsx
// src/components/ui/bank-account-select.tsx
"use client"

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { useLiveQuery } from "@tanstack/react-db"
import { bankAccountCollection } from "@/collections"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"

interface BankAccountSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  label?: string
  disabled?: boolean
  id?: string
  /** Per-bank-account balances keyed by account ID */
  bankAccountBalances?: Record<string, string>
  /** Whether to show balances next to account names */
  showBalances?: boolean
}

function BankAccountSelect<T extends FieldValues>({
  name,
  control,
  label = "Bank Account",
  disabled,
  id = "bank-account",
  bankAccountBalances,
  showBalances = true,
}: BankAccountSelectProps<T>) {
  const { data: allAccounts } = useLiveQuery((q) =>
    q.from({ ba: bankAccountCollection }).select(({ ba }) => ba)
  )
  const activeAccounts = (allAccounts ?? []).filter((a) => a.isActive)

  if (activeAccounts.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <p className="text-sm text-muted-foreground">
          No bank accounts configured. Ask a supervisor to create one in Fund Transfers.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        rules={{ required: "Bank account is required" }}
        render={({ field, fieldState }) => (
          <>
            <Select
              value={field.value ?? ""}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Select bank account" />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account) => {
                  const balance = bankAccountBalances?.[account.id]
                  return (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                      {showBalances && balance != null && (
                        <span className="text-muted-foreground ml-2">
                          — {formatCurrency(balance)}
                        </span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {fieldState.error?.message && (
              <p className="text-sm text-destructive">{fieldState.error.message}</p>
            )}
          </>
        )}
      />
    </div>
  )
}

export { BankAccountSelect, type BankAccountSelectProps }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/bank-account-select.tsx
git commit -m "feat: add BankAccountSelect inline dropdown component"
```

---

### Task 13: Update DepositLocationSelect with Inline Bank Account Picker

**Files:**
- Modify: `src/components/ui/deposit-location-select.tsx`

- [ ] **Step 1: Add inline BankAccountSelect when bank is selected**

Update `DepositLocationSelect` to accept and render inline bank account dropdown:

```tsx
"use client"

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DEPOSIT_LOCATION_OPTIONS } from "@/lib/constants"
import { BankAccountSelect } from "./bank-account-select"

interface DepositLocationSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  label?: string
  disabled?: boolean
  id?: string
  /** Field name for the bank account sub-location ID */
  subLocationName?: Path<T>
  /** Per-bank-account balances keyed by account ID */
  bankAccountBalances?: Record<string, string>
}

/**
 * Shared deposit-location selector for money-in flows (payments, expenses, income).
 * When "Bank" is selected and subLocationName is provided, shows an inline
 * bank account dropdown below.
 * For money-out (loan disbursement) with balance checks, use DisbursementSourceSelect instead.
 */
function DepositLocationSelect<T extends FieldValues>({
  name,
  control,
  label = "Source Location",
  disabled,
  id = "deposit-location",
  subLocationName,
  bankAccountBalances,
}: DepositLocationSelectProps<T>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        rules={{ required: "Deposit location is required" }}
        render={({ field, fieldState }) => (
          <>
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error?.message && (
              <p className="text-sm text-destructive">{fieldState.error.message}</p>
            )}
            {field.value === "bank" && subLocationName && (
              <BankAccountSelect
                name={subLocationName}
                control={control}
                disabled={disabled}
                bankAccountBalances={bankAccountBalances}
              />
            )}
          </>
        )}
      />
    </div>
  )
}

export { DepositLocationSelect, type DepositLocationSelectProps }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/deposit-location-select.tsx
git commit -m "feat: show inline bank account picker in DepositLocationSelect"
```

---

### Task 14: Update DisbursementSourceSelect with Inline Bank Account Picker

**Files:**
- Modify: `src/components/loans/disbursement-source-select.tsx`

- [ ] **Step 1: Add subLocationName prop and inline picker**

Update the component props to add:

```ts
  subLocationName?: Path<T>
  bankAccountBalances?: Record<string, string>
```

Then inside the `render` callback, after the `Select` component (and after the insufficient funds messages), add:

```tsx
              {field.value === "bank" && subLocationName && (
                <BankAccountSelect
                  name={subLocationName}
                  control={control}
                  disabled={disabled}
                  bankAccountBalances={bankAccountBalances}
                  showBalances={true}
                />
              )}
```

Import `BankAccountSelect` at the top of the file:

```ts
import { BankAccountSelect } from "@/components/ui/bank-account-select"
```

- [ ] **Step 2: Commit**

```bash
git add src/components/loans/disbursement-source-select.tsx
git commit -m "feat: show inline bank account picker in DisbursementSourceSelect"
```

---

### Task 15: Bank Account Management UI on Fund Transfers Page

**Files:**
- Modify: `src/app/(app)/fund-transfers/page.tsx`

- [ ] **Step 1: Add bank account management section**

This is the largest UI task. Update the fund transfers page to:

1. Import bank account collection and helpers
2. Add "New Bank Account" dialog
3. Add bank accounts list section
4. Add inline bank account dropdowns to transfer/injection dialogs
5. Wire up form state for subLocationId fields

Add imports:

```ts
import { bankAccountCollection, insertBankAccountWithInput, updateBankAccountWithInput } from "@/collections"
import { BankAccountSelect } from "@/components/ui/bank-account-select"
import { locationBalancesCollection } from "@/collections"
import type { BankAccount } from "@/types"
import { MoreHorizontal, Building2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
```

Update `TransferFormValues` to add:

```ts
  fromSubLocationId: string
  toSubLocationId: string
```

Update `InjectionFormValues` to add:

```ts
  toSubLocationId: string
```

Add a new dialog state for bank account creation:

```ts
const [bankAccountDialogOpen, setBankAccountDialogOpen] = useState(false)
const bankAccountForm = useForm<{ name: string }>({ defaultValues: { name: "" } })
```

Query bank accounts:

```ts
const { data: allBankAccounts } = useLiveSuspenseQuery((q) =>
  q.from({ ba: bankAccountCollection }).select(({ ba }) => ba)
)
const bankAccountsList = allBankAccounts ?? []
```

Query location balances for bank account balances:

```ts
const { data: locationBalanceRows } = useLiveSuspenseQuery((q) =>
  q.from({ lb: locationBalancesCollection }).select(({ lb }) => lb)
)
const locationBalances = locationBalanceRows?.[0] ?? null
const bankAccountBalances = (locationBalances as any)?.bankAccounts ?? {}
```

Add bank account creation handler:

```ts
function onCreateBankAccount(data: { name: string }) {
  const id = generateClientId()
  const input = { id, name: data.name.trim() }
  const optimistic: BankAccount = {
    id,
    name: data.name.trim(),
    isActive: true,
    createdBy: session.user.id,
    createdAt: new Date(),
  }
  try {
    insertBankAccountWithInput(id, optimistic, input)
    toast.success("Bank account created")
    bankAccountForm.reset()
    setBankAccountDialogOpen(false)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to create bank account")
  }
}
```

Update `onSubmit` for transfers to include sub-location IDs:

```ts
const input = {
  id,
  fromLocation: data.fromLocation,
  toLocation: data.toLocation,
  amount: data.amount.trim(),
  note: data.note.trim() || undefined,
  fromSubLocationId: data.fromLocation === "bank" ? data.fromSubLocationId : undefined,
  toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : undefined,
}
const optimistic: FundTransfer = {
  id,
  transferType: "internal",
  fromLocation: data.fromLocation,
  toLocation: data.toLocation,
  fromSubLocationId: data.fromLocation === "bank" ? data.fromSubLocationId : null,
  toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : null,
  amount: data.amount.trim(),
  transferredBy: session.user.id,
  note: data.note.trim() || null,
  createdAt: new Date(),
}
```

Update `onInjectionSubmit` similarly:

```ts
const input = {
  id,
  toLocation: data.toLocation,
  amount: data.amount.trim(),
  note: data.note.trim() || undefined,
  toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : undefined,
}
const optimistic: FundTransfer = {
  id,
  transferType: "capital_injection",
  fromLocation: null,
  toLocation: data.toLocation,
  fromSubLocationId: null,
  toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : null,
  amount: data.amount.trim(),
  transferredBy: session.user.id,
  note: data.note.trim() || null,
  createdAt: new Date(),
}
```

Add inline bank account selects inside the transfer dialog after each location select (when bank is selected):

After the "From" select:

```tsx
{fromLocation === "bank" && (
  <BankAccountSelect
    name="fromSubLocationId"
    control={control}
    label="From Bank Account"
    bankAccountBalances={bankAccountBalances}
  />
)}
```

After the "To" select (watch `toLocation` too):

```tsx
{watch("toLocation") === "bank" && (
  <BankAccountSelect
    name="toSubLocationId"
    control={control}
    label="To Bank Account"
    bankAccountBalances={bankAccountBalances}
  />
)}
```

Similarly in the injection dialog, after the toLocation select:

```tsx
{injectionForm.watch("toLocation") === "bank" && (
  <BankAccountSelect
    name="toSubLocationId"
    control={injectionForm.control}
    label="Bank Account"
    bankAccountBalances={bankAccountBalances}
  />
)}
```

Add the Bank Accounts section before the transfers table — a Card with a header "Bank Accounts", a "New Bank Account" button, and a table listing bank accounts with name, balance, status, and actions (edit/deactivate):

```tsx
<Card>
  <CardContent className="p-0">
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Bank Accounts</h3>
      </div>
      <Dialog open={bankAccountDialogOpen} onOpenChange={setBankAccountDialogOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              New Account
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Bank Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={bankAccountForm.handleSubmit(onCreateBankAccount)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="bankAccountName">Account Name</Label>
              <Controller
                name="name"
                control={bankAccountForm.control}
                rules={{ required: "Account name is required" }}
                render={({ field, fieldState }) => (
                  <>
                    <input
                      id="bankAccountName"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="e.g. Stanbic Main Account"
                      {...field}
                    />
                    {fieldState.error?.message && (
                      <p className="text-sm text-destructive">{fieldState.error.message}</p>
                    )}
                  </>
                )}
              />
            </div>
            <Button type="submit" className="w-full">Create Account</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    {bankAccountsList.length === 0 ? (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No bank accounts yet. Create one to start tracking bank balances individually.
      </div>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {bankAccountsList.map((account) => (
            <TableRow key={account.id} className={!account.isActive ? "opacity-50" : ""}>
              <TableCell className="font-medium">{account.name}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCurrency(bankAccountBalances[account.id] ?? "0")}
              </TableCell>
              <TableCell>
                {account.isActive ? (
                  <Badge variant="outline" className="rounded-full bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                ) : (
                  <Badge variant="outline" className="rounded-full bg-gray-50 text-gray-500 border-gray-200">Inactive</Badge>
                )}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        const newName = prompt("Rename bank account:", account.name)
                        if (newName && newName.trim() !== account.name) {
                          updateBankAccountWithInput(
                            { id: account.id, name: newName.trim() },
                            { name: newName.trim() }
                          )
                          toast.success("Bank account renamed")
                        }
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    {(session.user as any).role === "admin" || (session.user as any).role === "superAdmin" ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          updateBankAccountWithInput(
                            { id: account.id, isActive: !account.isActive },
                            { isActive: !account.isActive }
                          )
                          toast.success(account.isActive ? "Bank account deactivated" : "Bank account reactivated")
                        }}
                      >
                        {account.isActive ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/fund-transfers/page.tsx
git commit -m "feat: add bank account management UI and inline pickers on fund transfers page"
```

---

### Task 16: Wire Inline Bank Account Picker in Payment Forms

**Files:**
- Modify: `src/app/(app)/payments/QuickRecordDialog.tsx`

- [ ] **Step 1: Add subLocationId to form and pass to collection**

Add `subLocationId: string` to the form values type. Add `subLocationId: ""` to form defaults.

Import and use `DepositLocationSelect` with the `subLocationName` prop (if not already using it), or add `BankAccountSelect` inline after the deposit location select when `depositLocation === "bank"`.

When calling `insertPaymentWithInput`, include:

```ts
subLocationId: data.depositLocation === "bank" ? data.subLocationId : undefined,
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/payments/QuickRecordDialog.tsx
git commit -m "feat: add inline bank account picker to payment forms"
```

---

### Task 17: Wire Inline Bank Account Picker in Loan Creation

**Files:**
- Modify: `src/app/(app)/loans/new/_components/loan-details-step.tsx`

- [ ] **Step 1: Add subLocationId to loan form and pass through**

Add `subLocationId` to the form's loan store/state. Pass `subLocationName` and `bankAccountBalances` props to `DisbursementSourceSelect`.

When the loan is submitted, include `subLocationId` in the `CreateLoanInput`.

The `DisbursementSourceSelect` already accepts `subLocationName` and `bankAccountBalances` after Task 14 — wire them here:

```tsx
<DisbursementSourceSelect
  name="disbursementSource"
  control={control}
  locationBalances={locationBalances}
  amount={principalAmount}
  userRole={userRole}
  subLocationName="subLocationId"
  bankAccountBalances={locationBalances?.bankAccounts}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/loans/new/_components/loan-details-step.tsx
git commit -m "feat: add inline bank account picker to loan creation form"
```

---

### Task 18: Wire Inline Bank Account Picker in Expense/Income Forms

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx`

- [ ] **Step 1: Add subLocationId to expense form**

Add `subLocationId: ""` to expense form defaults. Pass `subLocationName="subLocationId"` to `DepositLocationSelect`. When submitting, include `subLocationId` if location is bank.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/expenses/page.tsx
git commit -m "feat: add inline bank account picker to expense form"
```

---

### Task 19: Update Balance Sheet Display for Per-Account Balances

**Files:**
- Identify and modify the balance sheet report component (the component that renders `BalanceSheetData`)

- [ ] **Step 1: Show individual bank account balances**

In the balance sheet report UI, instead of showing a single "Bank" line, iterate over `bankAccountBalances` and show each as its own line item. Fall back to the aggregate `bankBalance` if no individual accounts exist.

Use `bankAccountCollection` or the bank accounts list to resolve account names from IDs.

Example rendering pattern:

```tsx
{/* Individual bank account lines */}
{Object.entries(data.assets.bankAccountBalances ?? {}).map(([accountId, balance]) => {
  const account = bankAccountsList.find(a => a.id === accountId)
  return (
    <TableRow key={accountId}>
      <TableCell className="pl-8">{account?.name ?? "Bank Account"}</TableCell>
      <TableCell className="text-right font-mono">{formatCurrency(balance)}</TableCell>
    </TableRow>
  )
})}
{/* Only show aggregate Bank row if no individual accounts */}
{Object.keys(data.assets.bankAccountBalances ?? {}).length === 0 && (
  <TableRow>
    <TableCell className="pl-8">Bank</TableCell>
    <TableCell className="text-right font-mono">{formatCurrency(data.assets.bankBalance)}</TableCell>
  </TableRow>
)}
```

- [ ] **Step 2: Commit**

```bash
git commit -am "feat: show per-bank-account balances in balance sheet report"
```

---

### Task 20: Verify Build & Fix TypeScript Errors

**Files:**
- Any files with type errors

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: May have type errors from the new `bankAccounts` field on `getLocationBalances` return type, or from the extended `FundTransfer` type now having `fromSubLocationId`/`toSubLocationId`.

- [ ] **Step 2: Fix any type errors**

Update all call sites of `getLocationBalances` that destructure the return value to also handle the new `bankAccounts` field.

Update any place that constructs a `FundTransfer` optimistic object to include the new `fromSubLocationId` and `toSubLocationId` fields.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 4: Commit fixes**

```bash
git commit -am "fix: resolve TypeScript errors from bank accounts changes"
```

---

### Task 21: E2E Tests — Bank Account Management

**Files:**
- Create: `cypress/e2e/bank-accounts.cy.ts`

- [ ] **Step 1: Write Cypress E2E tests**

```ts
describe("Bank Accounts", () => {
  beforeEach(() => {
    // Login as supervisor+ user
    cy.login("supervisor")
    cy.visit("/fund-transfers")
  })

  it("shows bank accounts section on fund transfers page", () => {
    cy.contains("Bank Accounts").should("be.visible")
  })

  it("creates a new bank account", () => {
    cy.contains("New Account").click()
    cy.get("#bankAccountName").type("Stanbic Main")
    cy.contains("Create Account").click()
    cy.contains("Bank account created").should("be.visible")
    cy.contains("Stanbic Main").should("be.visible")
  })

  it("shows inline bank account dropdown when Bank is selected in transfer dialog", () => {
    // First create a bank account
    cy.contains("New Account").click()
    cy.get("#bankAccountName").type("Test Bank")
    cy.contains("Create Account").click()

    // Open transfer dialog
    cy.contains("New Transfer").click()
    // Select Bank as from location
    cy.get("#fromLocation").click()
    cy.contains("Bank").click()
    // Bank account dropdown should appear
    cy.contains("From Bank Account").should("be.visible")
  })

  it("shows inline bank account dropdown when Bank is selected in injection dialog", () => {
    cy.contains("New Account").click()
    cy.get("#bankAccountName").type("Test Inject Bank")
    cy.contains("Create Account").click()

    cy.contains("Capital Injection").click()
    cy.get("#injectionToLocation").click()
    cy.contains("Bank").click()
    cy.contains("Bank Account").should("be.visible")
  })

  it("prevents submission without selecting bank account when Bank is chosen", () => {
    cy.contains("New Account").click()
    cy.get("#bankAccountName").type("Required Bank")
    cy.contains("Create Account").click()

    cy.contains("Capital Injection").click()
    cy.get("#injectionToLocation").click()
    cy.contains("Bank").click()
    // Try submit without selecting account
    cy.get("#injectionAmount").type("1000000")
    cy.contains("Record Injection").click()
    cy.contains("Bank account is required").should("be.visible")
  })

  it("admin can deactivate and reactivate a bank account", () => {
    cy.login("admin")
    cy.visit("/fund-transfers")

    cy.contains("New Account").click()
    cy.get("#bankAccountName").type("Deactivate Me")
    cy.contains("Create Account").click()

    // Find the row and open menu
    cy.contains("Deactivate Me").parents("tr").find("button").last().click()
    cy.contains("Deactivate").click()
    cy.contains("Bank account deactivated").should("be.visible")
    cy.contains("Inactive").should("be.visible")

    // Reactivate
    cy.contains("Deactivate Me").parents("tr").find("button").last().click()
    cy.contains("Reactivate").click()
    cy.contains("Bank account reactivated").should("be.visible")
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npx cypress run --spec cypress/e2e/bank-accounts.cy.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/bank-accounts.cy.ts
git commit -m "test: add E2E tests for bank account management"
```
