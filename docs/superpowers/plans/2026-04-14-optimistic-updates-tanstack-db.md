# Optimistic Updates with TanStack DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual TanStack Query cache management with TanStack DB collections for all mutable entities, enabling instant optimistic updates and client-side-first navigation.

**Architecture:** TanStack DB `QueryCollection` wraps each mutable entity. Collections load data via TanStack Query (`queryCollectionOptions`) and persist mutations through existing server actions. Client-side UUIDs enable instant detail page navigation. TanStack DB's built-in rollback handles failures. Read-only data (dashboard, reports, activities) stays on plain TanStack Query.

**Tech Stack:** `@tanstack/react-db`, `@tanstack/query-db-collection`, TanStack Query v5, Next.js 16, server actions, Effect-TS

**Spec:** `docs/superpowers/specs/2026-04-14-optimistic-updates-tanstack-db-design.md`

---

## File Structure

### New files:
```
src/lib/client-id.ts                          # generateClientId() utility
src/collections/customers.ts                  # customerCollection
src/collections/loans.ts                      # loanCollection
src/collections/payments.ts                   # paymentCollection
src/collections/expenses.ts                   # expenseCollection
src/collections/income.ts                     # incomeCollection
src/collections/creditors.ts                  # creditorCollection
src/collections/fund-transfers.ts             # fundTransferCollection
src/collections/rate-change-requests.ts       # rateChangeRequestCollection
src/collections/delegations.ts                # delegationCollection
src/collections/settlements.ts                # settlementCollection
src/collections/index.ts                      # Re-exports all collections
```

### Modified files:
```
package.json                                  # Add @tanstack/react-db, @tanstack/query-db-collection
src/actions/loan.actions.ts                   # Accept optional id in CreateLoanInput
src/actions/customer.actions.ts               # Accept optional id in CreateCustomerInput
src/actions/payment.actions.ts                # Accept optional id in RecordPaymentInput
src/actions/expense.actions.ts                # Accept optional id
src/actions/income.actions.ts                 # Accept optional id
src/actions/creditor.actions.ts               # Accept optional id
src/actions/fund-transfer.actions.ts          # Accept optional id
src/actions/rate-change-request.actions.ts    # Accept optional id
src/actions/delegation.actions.ts             # Accept optional id
src/actions/settlement.actions.ts             # Accept optional id
src/app/(app)/loans/[loanId]/page.tsx         # SSR → "use client" + useLiveQuery
src/app/(app)/loans/[loanId]/loan-detail-client.tsx  # Remove SSR props, use collections
src/app/(app)/loans/new/page.tsx              # Use loanCollection.insert + instant nav
src/app/(app)/loans/[loanId]/payments/new/*   # Use paymentCollection.insert + instant nav
src/app/(app)/customers/[id]/page.tsx         # Replace useCustomer with useLiveQuery
src/app/(app)/customers/page.tsx              # Replace useCustomers with useLiveQuery
src/app/(app)/payments/PaymentsClient.tsx     # Replace usePayments with useLiveQuery
src/app/(app)/expenses/page.tsx               # Replace with expenseCollection
src/app/(app)/creditors/page.tsx              # Replace with creditorCollection
src/app/(app)/fund-transfers/*                # Replace with fundTransferCollection
src/hooks/query-keys.ts                       # Remove keys for collection-managed entities
```

### Deleted files:
```
src/hooks/use-loans.ts
src/hooks/use-customers.ts
src/hooks/use-customer.ts
src/hooks/use-payments.ts
src/hooks/use-create-loan.ts
src/hooks/use-create-customer.ts
src/hooks/use-search-active-loans.ts
```

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install TanStack DB packages**

```bash
cd /Users/faridmatovu/projects/money-lending && npm install @tanstack/react-db @tanstack/query-db-collection
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/faridmatovu/projects/money-lending && node -e "require('@tanstack/react-db'); require('@tanstack/query-db-collection'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add package.json package-lock.json && git commit -m "chore: add @tanstack/react-db and @tanstack/query-db-collection"
```

---

## Task 2: Create Client ID Utility

**Files:**
- Create: `src/lib/client-id.ts`

- [ ] **Step 1: Create the utility**

```typescript
// src/lib/client-id.ts
export function generateClientId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/lib/client-id.ts && git commit -m "feat: add generateClientId utility"
```

---

## Task 3: Create Customer Collection

**Files:**
- Create: `src/collections/customers.ts`
- Create: `src/collections/index.ts`

- [ ] **Step 1: Create the customer collection**

Read `src/actions/customer.actions.ts` to confirm the exact function signatures for `createCustomerAction`, `updateCustomerAction`, and `searchCustomersAction`. Then create:

```typescript
// src/collections/customers.ts
import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  createCustomerAction,
  updateCustomerAction,
  searchCustomersAction,
} from "@/actions/customer.actions"
import type { Customer } from "@/types"

export const customerCollection = createCollection<Customer>(
  queryCollectionOptions({
    queryKey: ["customers"],
    queryFn: async () => {
      const result = await searchCustomersAction({ page: 1, pageSize: 10000 })
      if ("error" in result) throw new Error(result.error)
      return result.data.rows
    },
    getKey: (customer) => customer.id,
    onInsert: async ({ transaction }) => {
      const { modified: newCustomer } = transaction.mutations[0]
      const result = await createCustomerAction(newCustomer)
      if ("error" in result) throw new Error(result.error)
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const result = await updateCustomerAction(original.id, changes)
      if ("error" in result) throw new Error(result.error)
    },
  }),
)
```

**Important:** Read the actual `searchCustomersAction` signature — it may return `{ data: { rows, total } }` or `{ error }`. The `queryFn` must unwrap this correctly. Also read `createCustomerAction` — it currently takes `CreateCustomerInput` (not a full `Customer` object), so the `onInsert` handler must extract the relevant fields from `modified`:

```typescript
onInsert: async ({ transaction }) => {
  const { modified } = transaction.mutations[0]
  const result = await createCustomerAction({
    id: modified.id,
    fullName: modified.fullName,
    nin: modified.nin,
    contact: modified.contact,
    address: modified.address,
  })
  if ("error" in result) throw new Error(result.error)
},
```

Similarly for `updateCustomerAction` — read whether it takes `(id, input)` or a single object.

- [ ] **Step 2: Create the collections index**

```typescript
// src/collections/index.ts
export { customerCollection } from "./customers"
```

This file will grow as we add more collections in later tasks.

- [ ] **Step 3: Verify the build compiles**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to collections.

- [ ] **Step 4: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/collections/ && git commit -m "feat: add customerCollection with TanStack DB"
```

---

## Task 4: Create Loan Collection

**Files:**
- Create: `src/collections/loans.ts`
- Modify: `src/collections/index.ts`

- [ ] **Step 1: Read action signatures**

Read `src/actions/loan.actions.ts` to confirm `createLoanAction` and `listLoansWithOverdueAction` signatures and return types. Loans are immutable (no update/delete).

- [ ] **Step 2: Create the loan collection**

```typescript
// src/collections/loans.ts
import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { createLoanAction, listLoansWithOverdueAction } from "@/actions/loan.actions"
import type { LoanListEntry } from "@/types"

export const loanCollection = createCollection<LoanListEntry>(
  queryCollectionOptions({
    queryKey: ["loans"],
    queryFn: async () => {
      const result = await listLoansWithOverdueAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    getKey: (loan) => loan.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      // Extract CreateLoanInput fields from the optimistic LoanListEntry
      const result = await createLoanAction({
        id: modified.id,
        customerId: modified.customerId,
        principalAmount: modified.principalAmount,
        issuanceFee: modified.issuanceFee,
        interestRate: modified.interestRate,
        minInterestDays: modified.minInterestDays,
        startDate: new Date(modified.startDate).toISOString(),
        collateral: modified._collateralInput, // See note below
        disbursementSource: modified.disbursementSource,
        loanType: modified.loanType ?? "perpetual",
        termMonths: modified.termMonths ?? undefined,
        interestRateOverride: modified.interestRateOverride,
        minPeriodOverride: modified.minPeriodOverride,
        rollover: modified._rolloverInput, // See note below
        backdateNote: modified._backdateNote,
      })
      if ("error" in result) throw new Error(result.error)
    },
    // No onUpdate — loans are immutable
    // No onDelete — loans are never deleted
  }),
)
```

**Note on collateral/rollover:** The `LoanListEntry` type doesn't include `collateral` or `rollover` fields. When inserting optimistically, we need to pass the original form input to the server action. There are two approaches:

1. **Store extra fields on the optimistic record** with underscore-prefixed keys (`_collateralInput`, `_rolloverInput`, `_backdateNote`) that the UI ignores but `onInsert` reads. These fields are not part of `LoanListEntry` — extend the type or use `as any`.
2. **Use a side-channel** — store the full `CreateLoanInput` in a `Map<clientId, CreateLoanInput>` that `onInsert` reads from.

Read the form submission code in `src/app/(app)/loans/new/page.tsx` to determine which approach fits better. The side-channel Map is cleaner:

```typescript
// src/collections/loans.ts
const pendingInputs = new Map<string, CreateLoanInput>()

export function insertLoanWithInput(id: string, optimistic: LoanListEntry, input: CreateLoanInput) {
  pendingInputs.set(id, input)
  loanCollection.insert(optimistic)
}

// In onInsert:
onInsert: async ({ transaction }) => {
  const { modified } = transaction.mutations[0]
  const input = pendingInputs.get(modified.id)
  if (!input) throw new Error("Missing input for optimistic loan")
  pendingInputs.delete(modified.id)
  const result = await createLoanAction({ ...input, id: modified.id })
  if ("error" in result) throw new Error(result.error)
},
```

- [ ] **Step 3: Add to index**

```typescript
// Add to src/collections/index.ts
export { loanCollection, insertLoanWithInput } from "./loans"
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/collections/ && git commit -m "feat: add loanCollection with TanStack DB"
```

---

## Task 5: Create Payment Collection

**Files:**
- Create: `src/collections/payments.ts`
- Modify: `src/collections/index.ts`

- [ ] **Step 1: Read action signatures**

Read `src/actions/payment.actions.ts` to confirm `recordPaymentAction`, `editPaymentAction`, `deletePaymentAction`, and `listPaymentsAction` signatures. Payments use server-side pagination (can grow to tens of thousands).

- [ ] **Step 2: Create the payment collection**

```typescript
// src/collections/payments.ts
import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
  listPaymentsAction,
} from "@/actions/payment.actions"
import type { PaymentWithCustomer } from "@/types"

// Side-channel for form inputs (same pattern as loans)
const pendingInputs = new Map<string, any>()

export function insertPaymentWithInput(id: string, optimistic: PaymentWithCustomer, input: any) {
  pendingInputs.set(id, input)
  paymentCollection.insert(optimistic)
}

export const paymentCollection = createCollection<PaymentWithCustomer>(
  queryCollectionOptions({
    queryKey: ["payments"],
    queryFn: async () => {
      // Load initial page — collection will hold what's been loaded
      const result = await listPaymentsAction({ page: 1, pageSize: 100 })
      if ("error" in result) throw new Error(result.error)
      return result.data.rows
    },
    getKey: (payment) => payment.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInputs.get(modified.id)
      if (!input) throw new Error("Missing input for optimistic payment")
      pendingInputs.delete(modified.id)
      const result = await recordPaymentAction({ ...input, id: modified.id })
      if ("error" in result) throw new Error(result.error)
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const result = await editPaymentAction({
        paymentId: original.id,
        amount: changes.amount,
        paymentDate: changes.paymentDate
          ? new Date(changes.paymentDate).toISOString()
          : undefined,
        reason: changes._reason ?? "Updated via UI",
      })
      if ("error" in result) throw new Error(result.error)
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await deletePaymentAction({
        paymentId: original.id,
        reason: original._deleteReason ?? "Deleted via UI",
      })
      if ("error" in result) throw new Error(result.error)
    },
  }),
)
```

**Important:** Read the actual action signatures. The `editPaymentAction` takes `EditPaymentInput` which requires `reason`. The `deletePaymentAction` takes `DeletePaymentInput` which requires `reason`. These are audit fields not present on `PaymentWithCustomer` — use the side-channel pattern or pass reason as metadata.

- [ ] **Step 3: Add to index**

```typescript
// Add to src/collections/index.ts
export { paymentCollection, insertPaymentWithInput } from "./payments"
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/collections/ && git commit -m "feat: add paymentCollection with TanStack DB"
```

---

## Task 6: Create Remaining Collections (Expenses, Income, Creditors, Fund Transfers, Rate Changes, Delegations, Settlements)

**Files:**
- Create: `src/collections/expenses.ts`
- Create: `src/collections/income.ts`
- Create: `src/collections/creditors.ts`
- Create: `src/collections/fund-transfers.ts`
- Create: `src/collections/rate-change-requests.ts`
- Create: `src/collections/delegations.ts`
- Create: `src/collections/settlements.ts`
- Modify: `src/collections/index.ts`

- [ ] **Step 1: Read all action files**

For each action file (`expense.actions.ts`, `income.actions.ts`, `creditor.actions.ts`, `fund-transfer.actions.ts`, `rate-change-request.actions.ts`, `delegation.actions.ts`, `settlement.actions.ts`), read the mutation function signatures and the corresponding list/read functions.

Also read the type files to understand each entity's shape:
- `src/types/transaction.ts` — for expenses/income types
- `src/types/creditor.ts` — for creditor types
- `src/types/fund-transfer.ts` — for fund transfer types
- `src/types/rate-change.ts` — for rate change request types

- [ ] **Step 2: Create each collection**

Follow the same pattern as Tasks 3-5. Each collection:

1. Uses `createCollection` + `queryCollectionOptions`
2. `queryFn` calls the list/read action and unwraps the result
3. `getKey` returns the entity `id`
4. `onInsert` extracts form input (via side-channel Map if needed) and calls the create action
5. `onUpdate` calls the update action (if entity supports it)
6. `onDelete` calls the delete action (if entity supports it)
7. Throws on server error to trigger TanStack DB rollback

**Expenses collection (`src/collections/expenses.ts`):**
- `queryFn`: call the list expenses action
- `onInsert`: call `recordExpenseAction`
- `onDelete`: call `deleteExpenseAction`
- No `onUpdate`

**Income collection (`src/collections/income.ts`):**
- Same pattern as expenses but with `recordIncomeAction`/`deleteIncomeAction`

**Creditors collection (`src/collections/creditors.ts`):**
- `queryFn`: call the list creditors action
- `onInsert`: call `createCreditorAction`
- `onUpdate`: call `updateCreditorAction` (or `addInvestmentAction` — read the action to determine)
- No `onDelete`

**Fund Transfers collection (`src/collections/fund-transfers.ts`):**
- `queryFn`: call the list fund transfers action
- `onInsert`: call `createFundTransferAction`
- No `onUpdate`, no `onDelete`

**Rate Change Requests collection (`src/collections/rate-change-requests.ts`):**
- `queryFn`: call the list rate change requests action
- `onInsert`: call `requestRateChangeAction`
- No `onUpdate`, no `onDelete`

**Delegations collection (`src/collections/delegations.ts`):**
- `queryFn`: call the list delegations action
- `onInsert`: call `createDelegationAction`
- `onDelete`: call `revokeDelegationAction`
- No `onUpdate`

**Settlements collection (`src/collections/settlements.ts`):**
- `onInsert`: call `settleWithCollateralAction`
- No `queryFn` needed if settlements don't have a list view — check the UI
- No `onUpdate`, no `onDelete`

- [ ] **Step 3: Add all to index**

```typescript
// src/collections/index.ts
export { customerCollection } from "./customers"
export { loanCollection, insertLoanWithInput } from "./loans"
export { paymentCollection, insertPaymentWithInput } from "./payments"
export { expenseCollection } from "./expenses"
export { incomeCollection } from "./income"
export { creditorCollection } from "./creditors"
export { fundTransferCollection } from "./fund-transfers"
export { rateChangeRequestCollection } from "./rate-change-requests"
export { delegationCollection } from "./delegations"
export { settlementCollection } from "./settlements"
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/collections/ && git commit -m "feat: add remaining TanStack DB collections (expenses, income, creditors, fund-transfers, rate-changes, delegations, settlements)"
```

---

## Task 7: Modify Server Actions to Accept Optional Client ID

**Files:**
- Modify: `src/actions/loan.actions.ts`
- Modify: `src/actions/customer.actions.ts`
- Modify: `src/actions/payment.actions.ts`
- Modify: `src/actions/expense.actions.ts`
- Modify: `src/actions/income.actions.ts`
- Modify: `src/actions/creditor.actions.ts`
- Modify: `src/actions/fund-transfer.actions.ts`
- Modify: `src/actions/rate-change-request.actions.ts`
- Modify: `src/actions/delegation.actions.ts`
- Modify: `src/actions/settlement.actions.ts`

- [ ] **Step 1: Add `id?: string` to all create input types**

For each entity's input type in `src/types/`, add an optional `id` field:

```typescript
// src/types/customer.ts — add to CreateCustomerInput
export interface CreateCustomerInput {
  id?: string  // client-generated UUID for optimistic updates
  fullName: string
  nin: string
  contact: string
  address: string
}
```

```typescript
// src/types/loan.ts — add to CreateLoanInput
export interface CreateLoanInput {
  id?: string  // client-generated UUID for optimistic updates
  customerId: string
  // ... rest unchanged
}
```

```typescript
// src/types/payment.ts — add to RecordPaymentInput
export interface RecordPaymentInput {
  id?: string  // client-generated UUID for optimistic updates
  loanId: string
  // ... rest unchanged
}
```

Do the same for all other create input types: `CreateTransactionInput` (expenses/income), `CreateCreditorInput`, `CreateFundTransferInput`, `CreateRateChangeRequestInput`, etc. Read each type file to find the exact interface name.

- [ ] **Step 2: Modify service layer to use client ID**

For each service that inserts records, read the service file and modify the insert to use `input.id` when provided. Add collision fallback.

Read `src/services/loan.service.ts` (or wherever `createLoan` is defined) and find the `db.insert()` call. Modify it:

```typescript
// Before (example pattern)
const [newLoan] = await db.insert(loans).values({
  id: crypto.randomUUID(), // or uses Drizzle default
  ...loanData,
}).returning()

// After
const id = input.id ?? crypto.randomUUID()
try {
  const [newLoan] = await db.insert(loans).values({
    id,
    ...loanData,
  }).returning()
  return newLoan
} catch (error) {
  // UUID collision fallback
  if (input.id && isUniqueConstraintError(error)) {
    const fallbackId = crypto.randomUUID()
    const [newLoan] = await db.insert(loans).values({
      id: fallbackId,
      ...loanData,
    }).returning()
    return newLoan
  }
  throw error
}
```

**To detect unique constraint violations**, read the Drizzle/Postgres error handling in the codebase. Search for existing patterns:

```bash
cd /Users/faridmatovu/projects/money-lending && grep -r "unique" src/services/ --include="*.ts" -l
```

The Postgres error code for unique violation is `23505`. Create a helper if one doesn't exist:

```typescript
// src/lib/db-errors.ts (or add to existing error util)
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as any).code === "23505"
  )
}
```

Apply this pattern to every service that creates a record. Read each service file first:
- `src/services/loan.service.ts`
- `src/services/customer.service.ts` (or wherever customer insert lives)
- `src/services/payment.service.ts`
- And each remaining entity's service

- [ ] **Step 3: Ensure actions pass `id` through to services**

Read each action file and confirm the `id` from input is passed to the service layer. For actions using `withAction` with Effect mode, ensure the Effect pipeline receives the `id`:

```typescript
// Example for loan action
export async function createLoanAction(input: CreateLoanInput) {
  // ... auth/permission checks ...
  const data = await Effect.runPromise(
    createLoan({ ...loanInput, id: input.id }, session.user.id)
  )
  // ...
}
```

- [ ] **Step 4: Verify build and existing tests**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

```bash
cd /Users/faridmatovu/projects/money-lending && npx vitest run 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/types/ src/services/ src/actions/ src/lib/ && git commit -m "feat: accept optional client-side ID in all create actions with collision fallback"
```

---

## Task 8: Convert Loan Detail Page (SSR → Client)

**Files:**
- Modify: `src/app/(app)/loans/[loanId]/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`

- [ ] **Step 1: Read current files**

Read both files in full:
- `src/app/(app)/loans/[loanId]/page.tsx` (146 lines — SSR server component)
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` (the client component that receives SSR props)

Understand every prop passed from server to client, and every query the client component makes.

- [ ] **Step 2: Replace the server page with a thin client wrapper**

The current `page.tsx` is a server component that fetches ~8 pieces of data via Effect. Replace it with a client component that reads from the loan collection and fetches derived data via TanStack Query:

```typescript
// src/app/(app)/loans/[loanId]/page.tsx
"use client"

import { use } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { loanCollection } from "@/collections"
import { LoanDetailClient } from "./loan-detail-client"
// ... other imports

export default function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = use(params)

  // Read loan from collection — instant if optimistic data exists
  const { data: loans } = useLiveQuery((q) =>
    q.from({ loan: loanCollection }).where(({ loan }) => eq(loan.id, loanId))
  )
  const loan = loans?.[0] ?? null

  if (!loan) {
    // Could be loading, or record was rolled back
    // Show skeleton or redirect — read loan-detail-client.tsx to see
    // how it currently handles loading state
    return <LoanDetailSkeleton />
  }

  return <LoanDetailClient loan={loan} loanId={loanId} />
}
```

- [ ] **Step 3: Modify LoanDetailClient to fetch its own derived data**

The client component currently receives `initialPayments`, `ledgerBalance`, `paymentPortions`, `userNameMap`, `customerName`, `userRole`, `collateralNature`, `daysOverdue` as props from SSR.

Convert each to a client-side query:

```typescript
// Inside LoanDetailClient — replace SSR props with hooks

// Payments — from paymentCollection filtered by loanId
const { data: payments } = useLiveQuery((q) =>
  q.from({ payment: paymentCollection })
   .where(({ payment }) => eq(payment.loanId, loanId))
   .orderBy(({ payment }) => payment.paymentDate, "desc")
)

// Balance — stays on TanStack Query (derived from ledger)
const { data: balance } = useQuery({
  queryKey: queryKeys.loans.balance(loanId),
  queryFn: () => getLoanBalanceAction(loanId).then(unwrapAction),
})

// Payment portions — stays on TanStack Query (derived from ledger)
const { data: portions } = useQuery({
  queryKey: queryKeys.payments.portions(loanId),
  queryFn: () => getPaymentPortionsAction(activePaymentIds).then(unwrapAction),
  enabled: activePaymentIds.length > 0,
})

// Customer name — from customerCollection
const { data: customers } = useLiveQuery((q) =>
  q.from({ c: customerCollection }).where(({ c }) => eq(c.id, loan.customerId))
)
const customerName = customers?.[0]?.fullName ?? "Unknown"

// User role — from session hook or action
const { data: role } = useQuery({
  queryKey: ["session", "role"],
  queryFn: () => getSessionRoleAction().then(unwrapAction),
})
```

Read the existing `loan-detail-client.tsx` carefully to identify ALL data dependencies and convert each one. The key principle: data from collections uses `useLiveQuery`, derived/computed data stays on `useQuery`.

- [ ] **Step 4: Handle rollback redirect**

Add an effect that redirects when the loan is rolled back (optimistic record removed):

```typescript
const router = useRouter()
const hasMounted = useRef(false)

useEffect(() => {
  if (hasMounted.current && !loan) {
    toast.error("Loan could not be saved")
    router.replace("/loans")
  }
  hasMounted.current = true
}, [loan])
```

Place this in the page component (not the client component) since the page is where `loan` can be `null`.

- [ ] **Step 5: Verify the page loads**

```bash
cd /Users/faridmatovu/projects/money-lending && npm run build 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/app/\(app\)/loans/ && git commit -m "feat: convert loan detail page from SSR to client-side with TanStack DB"
```

---

## Task 9: Convert Loan Create Page (Instant Navigation)

**Files:**
- Modify: `src/app/(app)/loans/new/page.tsx`

- [ ] **Step 1: Read the current create page**

Read `src/app/(app)/loans/new/page.tsx` in full. Understand:
- How the form is structured
- How `useCreateLoan()` mutation is called
- What happens after success (POS receipt modal, then navigation)
- What data is used to build the optimistic entry

- [ ] **Step 2: Replace useCreateLoan with collection insert + instant navigation**

The current flow:
1. Form submit → `createLoan.mutate(input)`
2. Wait for `onSuccess` → show POS receipt modal
3. Modal close → navigate to `/customers/{customerId}`

New flow:
1. Form submit → `generateClientId()` → build optimistic `LoanListEntry` → `insertLoanWithInput(id, optimistic, input)` → show POS receipt modal immediately
2. Modal close → `router.push(/loans/{id})` — instant, data in collection
3. Server syncs in background

```typescript
import { generateClientId } from "@/lib/client-id"
import { insertLoanWithInput } from "@/collections"

function handleSubmit(formData: CreateLoanInput) {
  const id = generateClientId()
  
  // Build optimistic LoanListEntry with known fields
  const optimistic: LoanListEntry = {
    id,
    customerId: formData.customerId,
    customerName: selectedCustomerName, // from form state
    customerContact: selectedCustomerContact,
    principalAmount: formData.principalAmount,
    issuanceFee: formData.issuanceFee,
    interestRate: formData.interestRate || "0.10",
    minInterestDays: formData.minInterestDays || 30,
    startDate: new Date(formData.startDate),
    status: "active",
    disbursementSource: formData.disbursementSource,
    loanType: formData.loanType ?? "perpetual",
    // Fill remaining LoanListEntry fields with defaults
    daysOverdue: 0,
    outstandingBalance: formData.principalAmount,
    dailyRate: "0",
    lastPaymentDate: null,
    unpaidInterest: "0",
    // ... other Loan fields
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // Insert optimistically + queue server action
  insertLoanWithInput(id, optimistic, formData)
  
  // Show POS receipt with optimistic data
  setReceiptData({ ...optimistic })
  setShowReceipt(true)
  
  // On receipt close: navigate to detail page (instant from collection)
  // router.push(`/loans/${id}`)
}
```

Read the current `page.tsx` to get the exact field mapping — the optimistic entry must match `LoanListEntry` shape exactly. Fill all fields the UI needs to render the detail page and list row.

- [ ] **Step 3: Remove useCreateLoan import**

Replace `import { useCreateLoan } from "@/hooks/use-create-loan"` with the collection import. Remove all `createLoan.mutate()` calls and `createLoan.isPending` checks — replace with local state if needed for form disable.

- [ ] **Step 4: Verify the page compiles**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/app/\(app\)/loans/new/ && git commit -m "feat: loan creation uses TanStack DB collection with instant navigation"
```

---

## Task 10: Convert Payment Recording Page (Instant Navigation)

**Files:**
- Modify: `src/app/(app)/loans/[loanId]/payments/new/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` (or wherever the form lives)

- [ ] **Step 1: Read current payment creation flow**

Read the payment creation page and form. Understand:
- How `recordPaymentAction` is called
- POS receipt modal flow
- Navigation after success (currently `router.push(/loans/{loanId})`)

- [ ] **Step 2: Replace with collection insert + instant navigation**

Same pattern as Task 9:

```typescript
import { generateClientId } from "@/lib/client-id"
import { insertPaymentWithInput } from "@/collections"

function handleSubmit(formData: RecordPaymentInput) {
  const id = generateClientId()
  
  const optimistic: PaymentWithCustomer = {
    id,
    loanId: formData.loanId,
    customerId: loanCustomerId, // from loan context
    customerName: loanCustomerName,
    paymentDate: new Date(formData.paymentDate),
    amount: formData.amount,
    interestPortion: "0", // unknown until server computes
    principalPortion: "0",
    principalBalanceAfter: "0",
    outstandingBalance: "0",
    recordedBy: "",
    recorderName: "",
    depositLocation: formData.depositLocation,
    createdAt: new Date(),
  }

  insertPaymentWithInput(id, optimistic, formData)
  
  // Show POS receipt, then navigate back to loan detail
  setReceiptData({ ... })
  setShowReceipt(true)
  // On close: router.push(`/loans/${formData.loanId}`)
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/app/\(app\)/loans/\[loanId\]/payments/ && git commit -m "feat: payment recording uses TanStack DB collection with instant navigation"
```

---

## Task 11: Convert Customer Pages

**Files:**
- Modify: `src/app/(app)/customers/[id]/page.tsx`
- Modify: `src/app/(app)/customers/page.tsx`

- [ ] **Step 1: Read both customer pages**

Read `src/app/(app)/customers/[id]/page.tsx` (693 lines — already client component) and `src/app/(app)/customers/page.tsx`.

- [ ] **Step 2: Convert customer detail page**

Replace `useCustomer(customerId)` with `useLiveQuery`:

```typescript
import { useLiveQuery, eq } from "@tanstack/react-db"
import { customerCollection } from "@/collections"

// Replace:
// const { data: customer, isLoading } = useCustomer(customerId)

// With:
const { data: customers, isLoading } = useLiveQuery((q) =>
  q.from({ c: customerCollection }).where(({ c }) => eq(c.id, customerId))
)
const customer = customers?.[0] ?? null
```

Also replace the loans query with `useLiveQuery` from `loanCollection`:

```typescript
import { loanCollection } from "@/collections"

// Replace the useQuery for loans.byCustomer with:
const { data: customerLoans } = useLiveQuery((q) =>
  q.from({ loan: loanCollection }).where(({ loan }) => eq(loan.customerId, customerId))
)
```

Replace `updateCustomerAction` calls with `customerCollection.update()`:

```typescript
// Replace direct action call:
// await updateCustomerAction(customerId, formData)

// With:
customerCollection.update(customerId, (draft) => {
  if (formData.fullName) draft.fullName = formData.fullName
  if (formData.nin) draft.nin = formData.nin
  if (formData.contact) draft.contact = formData.contact
  if (formData.address) draft.address = formData.address
})
```

- [ ] **Step 3: Convert customer list page**

Read the customers list page. Replace `useCustomers(params, page)` with `useLiveQuery` with client-side filtering:

```typescript
const { data: allCustomers } = useLiveQuery((q) =>
  q.from({ c: customerCollection }).toArray()
)

// Client-side filtering
const filtered = useMemo(() => {
  let result = allCustomers ?? []
  if (params.name) {
    result = result.filter((c) =>
      c.fullName.toLowerCase().includes(params.name!.toLowerCase())
    )
  }
  if (params.status?.length) {
    result = result.filter((c) => params.status!.includes(c.status))
  }
  // ... other filters
  return result
}, [allCustomers, params])

// Client-side pagination
const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
const total = filtered.length
```

- [ ] **Step 4: Add rollback handling to detail page**

Same pattern as Task 8 Step 4 — redirect if customer disappears from collection.

- [ ] **Step 5: Remove useCreateCustomer usage**

Find where `useCreateCustomer` is used (likely in a customer creation form/dialog). Replace with `customerCollection.insert()` + `generateClientId()` + `router.push(/customers/{id})`.

- [ ] **Step 6: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/app/\(app\)/customers/ && git commit -m "feat: convert customer pages to TanStack DB collections"
```

---

## Task 12: Convert Remaining Entity Pages

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx`
- Modify: `src/app/(app)/creditors/page.tsx`
- Modify: `src/app/(app)/fund-transfers/` (all files)
- Modify: `src/app/(app)/payments/PaymentsClient.tsx`

- [ ] **Step 1: Read each page**

Read every page that uses a mutable entity. For each:
1. Identify the current `useQuery` or direct action call
2. Replace with `useLiveQuery` from the corresponding collection
3. Replace mutation calls with `collection.insert/update/delete`

- [ ] **Step 2: Convert expenses page**

Replace the expenses query with `useLiveQuery` from `expenseCollection`. Replace `recordExpenseAction`/`deleteExpenseAction` calls with collection mutations.

- [ ] **Step 3: Convert creditors page**

Replace with `creditorCollection`. Handle the `addInvestmentAction` — read whether this is an update to the creditor or a separate entity. If separate, it may need its own collection or stay as a direct action call.

- [ ] **Step 4: Convert fund transfers page**

Replace with `fundTransferCollection`.

- [ ] **Step 5: Convert payments list page**

`src/app/(app)/payments/PaymentsClient.tsx` — replace `usePayments` with `useLiveQuery` from `paymentCollection`. Since payments use server-side pagination, this needs care:

```typescript
// Payments can be large — keep server-side pagination for the list view
// but use collection for optimistic inserts
const { data: payments } = useLiveQuery((q) =>
  q.from({ p: paymentCollection }).toArray()
)
```

If the collection only holds recently loaded payments, filtering and pagination work on that subset. Read the current implementation to decide if full server-side pagination is needed or if loading all payments is feasible.

- [ ] **Step 6: Verify build**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add src/app/\(app\)/expenses/ src/app/\(app\)/creditors/ src/app/\(app\)/fund-transfers/ src/app/\(app\)/payments/ && git commit -m "feat: convert expenses, creditors, fund transfers, and payments list to TanStack DB"
```

---

## Task 13: Delete Old Hooks and Clean Up Query Keys

**Files:**
- Delete: `src/hooks/use-loans.ts`
- Delete: `src/hooks/use-customers.ts`
- Delete: `src/hooks/use-customer.ts`
- Delete: `src/hooks/use-payments.ts`
- Delete: `src/hooks/use-create-loan.ts`
- Delete: `src/hooks/use-create-customer.ts`
- Delete: `src/hooks/use-search-active-loans.ts`
- Modify: `src/hooks/query-keys.ts`

- [ ] **Step 1: Verify no remaining imports**

Search for any remaining imports of the hooks being deleted:

```bash
cd /Users/faridmatovu/projects/money-lending && grep -r "use-loans\|use-customers\|use-customer\|use-payments\|use-create-loan\|use-create-customer\|use-search-active-loans" src/ --include="*.ts" --include="*.tsx" -l
```

Fix any remaining imports before deleting.

- [ ] **Step 2: Delete old hooks**

```bash
cd /Users/faridmatovu/projects/money-lending && rm src/hooks/use-loans.ts src/hooks/use-customers.ts src/hooks/use-customer.ts src/hooks/use-payments.ts src/hooks/use-create-loan.ts src/hooks/use-create-customer.ts src/hooks/use-search-active-loans.ts
```

- [ ] **Step 3: Clean up query-keys.ts**

Remove query key entries for entities now managed by collections. Keep keys for:
- `dashboard` (read-only)
- `loans.balance`, `loans.paymentContext` (derived data, still on useQuery)
- `payments.portions` (derived data)
- `reports` (read-only)
- `activities` (read-only)
- `adminUsers` (read-only)
- `notifications` (read-only)
- `dailyCollections` (aggregated)

Remove:
- `customers.all`, `customers.detail`, `customers.search`, `customers.recent`
- `loans.all`, `loans.detail`, `loans.byCustomer`, `loans.searchActive`
- `payments.all`, `payments.list`, `payments.detail`, `payments.byLoan`
- `expenses.all`, `expenses.list`
- `income.all`, `income.list`
- `creditors.all`, `creditors.detail`, `creditors.capital`, `creditors.monthlyDue`, `creditors.monthlySummary`
- `rateChangeRequests.all`, `rateChangeRequests.pending`, `rateChangeRequests.byLoan`, `rateChangeRequests.pendingCount`
- `fundTransfers.all`
- `recentLoans`
- `loansDueToday`

- [ ] **Step 4: Verify build and no broken imports**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add -A && git commit -m "refactor: delete old query hooks replaced by TanStack DB collections, trim query-keys.ts"
```

---

## Task 14: Cypress E2E Tests — Optimistic Loan Creation

**Files:**
- Create: `cypress/e2e/optimistic-loan-create.cy.ts`

- [ ] **Step 1: Read existing Cypress test patterns**

```bash
cd /Users/faridmatovu/projects/money-lending && ls cypress/e2e/
```

Read one existing test file to understand the project's Cypress conventions (login flow, selectors, custom commands).

- [ ] **Step 2: Write the test**

```typescript
// cypress/e2e/optimistic-loan-create.cy.ts
describe("Optimistic Loan Creation", () => {
  beforeEach(() => {
    // Use existing login pattern from other test files
    cy.login() // or whatever the convention is
  })

  it("navigates to loan detail page instantly after creation", () => {
    cy.visit("/loans/new")
    // Fill form — read the actual form to get correct selectors
    // cy.get('[name="customerId"]').select(...)
    // cy.get('[name="principalAmount"]').type("500000")
    // ... fill all required fields
    
    cy.get('[type="submit"]').click()
    
    // Should navigate to detail page without waiting for server
    cy.url().should("match", /\/loans\/[a-f0-9-]+/)
    
    // Optimistic data should be visible
    cy.contains("500,000").should("be.visible")
  })

  it("shows loan data from collection cache on detail page", () => {
    // Create loan and navigate
    // Assert all expected fields render from optimistic data
  })

  it("rolls back and redirects on server failure", () => {
    // Intercept the create action to simulate failure
    cy.intercept("POST", "**/loan*", { statusCode: 500 }).as("createLoan")
    
    cy.visit("/loans/new")
    // Fill and submit form
    
    // Should eventually redirect back (after rollback)
    cy.url().should("include", "/loans")
    cy.contains("could not be saved").should("be.visible")
  })
})
```

**Important:** Read existing Cypress tests first to match the project's patterns for:
- Authentication/login setup
- Form selectors (data-testid vs name vs label)
- Server action interception method
- Toast assertion patterns

- [ ] **Step 3: Run the test**

```bash
cd /Users/faridmatovu/projects/money-lending && npx cypress run --spec cypress/e2e/optimistic-loan-create.cy.ts
```

Fix any failures.

- [ ] **Step 4: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add cypress/e2e/optimistic-loan-create.cy.ts && git commit -m "test: add Cypress E2E tests for optimistic loan creation"
```

---

## Task 15: Cypress E2E Tests — Optimistic Payment and Customer Creation

**Files:**
- Create: `cypress/e2e/optimistic-payment-create.cy.ts`
- Create: `cypress/e2e/optimistic-customer-create.cy.ts`

- [ ] **Step 1: Write payment creation test**

Same pattern as Task 14 but for payments:
- Navigate to payment form for an existing loan
- Submit → instant navigation back to loan detail
- Payment appears in the payments table from collection cache
- Server failure → payment disappears from table

- [ ] **Step 2: Write customer creation test**

Same pattern for customers:
- Navigate to customer creation form
- Submit → instant navigation to `/customers/{id}`
- Customer data visible from collection cache
- Server failure → redirect to customer list

- [ ] **Step 3: Run both tests**

```bash
cd /Users/faridmatovu/projects/money-lending && npx cypress run --spec cypress/e2e/optimistic-payment-create.cy.ts,cypress/e2e/optimistic-customer-create.cy.ts
```

Fix any failures.

- [ ] **Step 4: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add cypress/e2e/optimistic-payment-create.cy.ts cypress/e2e/optimistic-customer-create.cy.ts && git commit -m "test: add Cypress E2E tests for optimistic payment and customer creation"
```

---

## Task 16: Cypress E2E Tests — Page Regression

**Files:**
- Create: `cypress/e2e/collection-pages-regression.cy.ts`

- [ ] **Step 1: Write regression tests for converted pages**

Test that each converted page still works correctly:

```typescript
describe("Collection Pages Regression", () => {
  beforeEach(() => {
    cy.login()
  })

  it("loans list page loads and displays data", () => {
    cy.visit("/loans")
    // Verify table renders with data
  })

  it("customer list page loads with filtering", () => {
    cy.visit("/customers")
    // Verify table renders
    // Test name search filter
  })

  it("payments list page loads", () => {
    cy.visit("/payments")
    // Verify table renders
  })

  it("expenses page loads", () => {
    cy.visit("/expenses")
  })

  it("creditors page loads", () => {
    cy.visit("/creditors")
  })

  it("fund transfers page loads", () => {
    cy.visit("/fund-transfers")
  })

  it("loan detail page loads from collection", () => {
    // Navigate to a known loan
    cy.visit("/loans")
    cy.get('[data-testid="data-row"]').first().click()
    cy.url().should("match", /\/loans\//)
    // Verify key data renders
  })

  it("customer detail page loads from collection", () => {
    cy.visit("/customers")
    cy.get('[data-testid="data-row"]').first().click()
    cy.url().should("match", /\/customers\//)
  })
})
```

- [ ] **Step 2: Run regression tests**

```bash
cd /Users/faridmatovu/projects/money-lending && npx cypress run --spec cypress/e2e/collection-pages-regression.cy.ts
```

- [ ] **Step 3: Commit**

```bash
cd /Users/faridmatovu/projects/money-lending && git add cypress/e2e/collection-pages-regression.cy.ts && git commit -m "test: add Cypress regression tests for all collection-converted pages"
```

---

## Task 17: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all Vitest tests**

```bash
cd /Users/faridmatovu/projects/money-lending && npx vitest run 2>&1 | tail -40
```

Fix any failures.

- [ ] **Step 2: Run all Cypress tests**

```bash
cd /Users/faridmatovu/projects/money-lending && npx cypress run 2>&1 | tail -40
```

Fix any failures.

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/faridmatovu/projects/money-lending && npx tsc --noEmit
```

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
cd /Users/faridmatovu/projects/money-lending && git add -A && git commit -m "fix: resolve test failures after TanStack DB migration"
```
