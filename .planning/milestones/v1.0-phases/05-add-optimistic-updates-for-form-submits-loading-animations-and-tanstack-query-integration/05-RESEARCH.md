# Phase 5: Optimistic Updates, Loading Animations, and TanStack Query Integration - Research

**Researched:** 2026-03-22
**Domain:** React 19 optimistic UI patterns, TanStack Query v5, Next.js 16 Server Actions
**Confidence:** HIGH

## Summary

Phase 5 upgrades the UX of every form in the signed-in app from a "block everything and wait" model to either optimistic updates (instant perceived response) or polished loading states. The app already runs React 19.2.4 and Next.js 16.2.0, which means the full React 19 optimism API (`useOptimistic`, `useTransition`, `useActionState`) is available natively without any polyfill.

TanStack Query v5 (5.94.5 as of now) supports React 19 and pairs neatly with Next.js Server Actions: you wrap a Server Action call inside `useMutation`, gain `onMutate`/`onError`/`onSettled` lifecycle hooks, and manage the query cache manually for list pages. The key architectural choice is **where data lives**: pages that have stable server-fetched lists (expenses, income, creditors) are the best candidates for TanStack Query optimistic mutations; simple navigation forms (new customer, new loan, record payment) navigate away on success, so they only need `useTransition` for button state — not cache management.

The existing codebase already uses `useTransition` + `isPending` in `ExpenseListClient.tsx` and `IncomeListClient.tsx`, giving a working pattern to follow. Most other forms use `useState(false) → setSubmitting(true)`, which is the same intent without the React scheduler benefits of `useTransition`. Upgrading those to `useTransition` is the minimum viable improvement; TanStack Query is only needed for pages that manage a local list that should update without a full server re-fetch.

**Primary recommendation:** Use `useTransition` for all Server Action calls (immediate upgrade); add `useOptimistic` for in-place list mutations (delete, status change); add TanStack Query only for the list pages where local cache management adds clear value over `router.refresh()`.

---

## Form Inventory — Signed-In App

A complete audit of all form submits in the current codebase:

| Form Location | File | Current Pattern | Optimism Viable? | Recommended Approach |
|---|---|---|---|---|
| Register Customer | `customers/new/page.tsx` | `useState(submitting)` | No — navigates away | `useTransition` for button state |
| Edit Customer | `customers/[id]/page.tsx` | `useState(submitting)` | Yes — inline edit | `useOptimistic` on customer name/contact fields |
| Change Customer Status | `customers/[id]/page.tsx` | `useState(submitting)` | Yes — in-place badge | `useOptimistic` on status badge |
| Issue Loan (3-step wizard) | `loans/new/page.tsx` | `useState(submitting)` | No — navigates away | `useTransition` for final submit button |
| Record Payment | `loans/[loanId]/payments/new/record-payment-form.tsx` | `useState(submitting)` + `Loader2` | No — navigates away | Already has spinner; add `useTransition` |
| Edit Payment (dialog) | `loans/[loanId]/loan-detail-client.tsx` | `useState(editSubmitting)` | Yes — closes dialog, refreshes list | `useTransition` + `router.refresh()` |
| Delete Payment (dialog) | `loans/[loanId]/loan-detail-client.tsx` | `useState(deleteSubmitting)` | Yes — removes row | `useOptimistic` to remove row immediately |
| Record Expense | `expenses/ExpenseListClient.tsx` | `useTransition` (already) | Yes — appends to list | TanStack Query `useMutation` + optimistic append |
| Delete Expense | `expenses/ExpenseListClient.tsx` | `useTransition` (already) | Yes — removes row | TanStack Query `useMutation` + optimistic remove |
| Add Expense Category | `expenses/ExpenseListClient.tsx` | `useTransition` (already) | Yes — appends to list | `useOptimistic` |
| Record Income | `income/IncomeListClient.tsx` | `useTransition` (already) | Yes — appends to list | TanStack Query `useMutation` + optimistic append |
| Delete Income | `income/IncomeListClient.tsx` | `useTransition` (already) | Yes — removes row | TanStack Query `useMutation` + optimistic remove |
| Register Creditor | `creditors/new/page.tsx` | `useState(submitting)` | No — navigates away | `useTransition` for button state |
| Add Creditor Investment | `creditors/[id]/AddInvestmentDialog.tsx` | `useState(submitting)` | Yes — closes dialog, refreshes | `useTransition` + `router.refresh()` |
| Record Creditor Repayment | `creditors/[id]/RecordRepaymentDialog.tsx` | `useState(submitting)` | Yes — closes dialog, refreshes | `useTransition` + `router.refresh()` |
| Assign User Role (admin) | `admin/page.tsx` | `useState(roleUpdating)` | Yes — updates badge in-place | Already has in-place update; add `useTransition` |
| Sign In | `(auth)/login/page.tsx` | `useState(loading)` | **No** — auth must confirm server-side | Loading state only — add spinner + disable |
| Register | `(auth)/register/page.tsx` | `useState(loading)` | **No** — auth must confirm server-side | Loading state only |
| Forgot Password | `(auth)/forgot-password/page.tsx` | `useState(loading)` | **No** | Loading state only |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` (built-in) | 19.2.4 | `useOptimistic`, `useTransition`, `useActionState` | Already installed; native React 19 API |
| `react-dom` (built-in) | 19.2.4 | `useFormStatus` | Already installed |
| `@tanstack/react-query` | 5.94.5 | Client-side query cache + optimistic mutations | Gold standard for server-state in React |
| `@tanstack/react-query-devtools` | 5.x | Dev-time cache inspection | Companion devtools, dev-only bundle |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sonner` (already installed) | ^2.0.7 | Toast on optimistic rollback failure | Already wired in every form |
| `lucide-react` (already installed) | ^0.577.0 | `Loader2` spinner | Already used in `record-payment-form.tsx` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TanStack Query | `useOptimistic` only | TQ gives devtools, automatic retry, cache invalidation; `useOptimistic` is simpler but no retry |
| TanStack Query | SWR | TQ v5 has better TypeScript, mutation lifecycle hooks; SWR is viable but has less community traction |
| `useTransition` | `useState(submitting)` | `useTransition` is strictly better — marks update as non-urgent, keeps UI interactive during Server Action |

**Installation (new packages only):**
```bash
pnpm add @tanstack/react-query
pnpm add -D @tanstack/react-query-devtools
```

**Verified versions (2026-03-22):**
- `@tanstack/react-query`: 5.94.5 (latest stable)
- `@tanstack/react-query-devtools`: matches 5.x minor

---

## Architecture Patterns

### TanStack Query Integration with Next.js Server Actions

The standard pattern (HIGH confidence — official TanStack docs): TanStack Query does NOT replace Server Actions. Server Actions remain the mutation function. `useMutation` wraps the Server Action call and adds lifecycle hooks.

```typescript
// Source: TanStack Query v5 docs — useMutation with onMutate
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { recordExpenseAction } from "./actions"
import type { Transaction } from "@/types"

export function ExpenseListClient({ initialTransactions }: { initialTransactions: Transaction[] }) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (input: CreateExpenseInput) => recordExpenseAction(input),

    // Optimistic update: called before mutationFn executes
    onMutate: async (newExpense) => {
      // Cancel any in-flight refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: ["expenses"] })

      // Snapshot the current value for rollback
      const previous = queryClient.getQueryData<Transaction[]>(["expenses"])

      // Optimistically append the new item
      queryClient.setQueryData<Transaction[]>(["expenses"], (old = []) => [
        ...old,
        { id: "temp-" + Date.now(), ...newExpense } as Transaction,
      ])

      return { previous }
    },

    // On failure: rollback to snapshot
    onError: (_err, _newExpense, context) => {
      queryClient.setQueryData(["expenses"], context?.previous)
      toast.error("Failed to record expense")
    },

    // Always refetch after error or success to sync with server
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] })
    },
  })
}
```

### QueryClientProvider Setup (App-wide)

TanStack Query requires a `QueryClientProvider` at the root. In Next.js App Router this means a `"use client"` wrapper around the layout body — the provider itself is client-only.

```typescript
// Source: TanStack Query v5 — Next.js App Router setup
// src/components/providers.tsx
"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useState } from "react"

export function Providers({ children }: { children: React.ReactNode }) {
  // useState ensures each browser session gets a new QueryClient (not shared across requests)
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // With Server Components as the data-fetching layer, staleTime > 0 prevents
        // immediate refetches on client navigation
        staleTime: 60 * 1000, // 1 minute
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

Wire into `src/app/(app)/layout.tsx` (the signed-in shell), not the root layout, since only the app shell needs the query cache.

### useOptimistic Pattern — In-Place List Mutations

For forms that don't navigate away and mutate a local list (e.g., delete payment row, change customer status):

```typescript
// Source: Next.js forms.md (node_modules/next/dist/docs/01-app/02-guides/forms.md)
"use client"

import { useOptimistic, useTransition } from "react"
import { deletePaymentAction } from "@/actions/payment.actions"
import type { Payment } from "@/types"

export function PaymentsTable({ payments }: { payments: Payment[] }) {
  const [optimisticPayments, removeOptimisticPayment] = useOptimistic(
    payments,
    (state: Payment[], idToRemove: string) =>
      state.filter((p) => p.id !== idToRemove)
  )

  const [isPending, startTransition] = useTransition()

  async function handleDelete(paymentId: string) {
    startTransition(async () => {
      removeOptimisticPayment(paymentId)       // immediate UI update
      await deletePaymentAction(paymentId)     // Server Action
      // router.refresh() will reconcile with actual server state
    })
  }
  // ...
}
```

**Critical constraint:** `useOptimistic` state automatically reverts if the enclosing transition throws/rejects. You do NOT need to manually rollback — React handles it. But you still need to show an error toast on failure.

### useTransition — Minimal Upgrade for Navigate-Away Forms

For forms that redirect after success, `useTransition` is the correct lightweight approach:

```typescript
// Source: React 19 docs
"use client"

import { useTransition } from "react"
import { createCustomerAction } from "@/actions/customer.actions"

export default function NewCustomerPage() {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createCustomerAction({ ... })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      router.push(`/customers/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Registering..." : "Register Customer"}
      </Button>
    </form>
  )
}
```

This replaces the `useState(submitting)` + `setSubmitting(true/false)` boilerplate in ~8 components.

### Recommended Project Structure Changes

No major restructuring needed. Add one new file:

```
src/
├── components/
│   ├── providers.tsx        # NEW — QueryClientProvider wrapper
│   └── ui/
│       └── spinner.tsx      # Optional — shared Loader2 wrapper
├── app/
│   ├── (app)/
│   │   └── layout.tsx       # MODIFY — wrap with <Providers>
│   └── (auth)/
│       └── (no change — auth forms don't need query cache)
```

### Query Key Conventions

Use string array keys scoped to the resource:

| Resource | Query Key | Scope |
|---|---|---|
| Expenses list | `["expenses"]` | App-global |
| Income list | `["income"]` | App-global |
| Payments for a loan | `["payments", loanId]` | Per-loan |
| Customers list | `["customers"]` | App-global |

---

## Anti-Patterns to Avoid

- **Using TanStack Query for everything:** Pages that navigate away on success (new loan, new customer) do NOT need a query cache. `useTransition` + `router.push()` is simpler and correct.
- **useOptimistic outside a transition:** `useOptimistic` updates are synchronous — they MUST be called inside `startTransition`. Calling outside a transition does nothing.
- **Calling `router.refresh()` AND `invalidateQueries` for the same resource:** Pick one. If using TanStack Query for a list, use `invalidateQueries`. If using Server Components, use `router.refresh()`.
- **Creating a new `QueryClient` on every render:** Must use `useState(() => new QueryClient())` so the client is stable across renders.
- **Wrapping the root layout in `QueryClientProvider`:** Adds query overhead to the auth pages unnecessarily. Scope the provider to `(app)/layout.tsx`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loading spinner component | Custom spinner | `Loader2` from `lucide-react` (already installed) | Already used in `record-payment-form.tsx`; consistent icon weight |
| Retry on mutation failure | Manual retry logic | TanStack Query `retry` option | Handles exponential backoff, max retries, error classification |
| Query cache invalidation | `router.refresh()` chain | `queryClient.invalidateQueries()` | Precise invalidation; `router.refresh()` refetches the entire server component tree |
| Skeleton screens | Custom skeleton divs | Tailwind pulse + `animate-pulse` class | CSS-only, zero JS, already in Tailwind bundle |

---

## Common Pitfalls

### Pitfall 1: useOptimistic Revert Confusion

**What goes wrong:** Developer expects `useOptimistic` to auto-rollback on error, but the rollback only happens if the transition itself throws. If the Server Action returns `{ error: "..." }` (the existing pattern in this codebase) instead of throwing, `useOptimistic` does NOT rollback — you must call `router.refresh()` manually.

**Why it happens:** The existing Server Action pattern returns error objects, not throws. `useOptimistic` reverts on transition rejection (throw), not on return value.

**How to avoid:** After calling a Server Action inside a transition, if the result is `{ error: "..." }`, call `router.refresh()` explicitly to resync state. Alternatively, throw inside the transition on error (changes the pattern).

**Recommended approach for this codebase:** Keep the return-object pattern (no Zod, no throws per project decisions); add explicit `router.refresh()` after error handling in transitions.

### Pitfall 2: QueryClientProvider SSR Hydration Mismatch

**What goes wrong:** If you pass server-fetched data to `useQuery` as `initialData`, the timestamp-based stale check immediately marks it stale and triggers a background refetch on mount, causing a hydration flash.

**Why it happens:** `initialData` sets `updatedAt` to Epoch 0 unless you also set `initialDataUpdatedAt`.

**How to avoid:** For this app's pattern (Server Component fetches, passes props to Client Component), use TanStack Query only for mutations and subsequent client-side refreshes. Do NOT convert existing Server Component data fetching to `useQuery`. The pattern is: Server Component provides `initialTransactions` as a prop; the Client Component initializes TanStack query cache with that data using `queryClient.setQueryData` in a `useEffect`, or just manages the list via `useState(initialTransactions)` and `useMutation` callbacks.

### Pitfall 3: Stale Closure in onMutate Snapshot

**What goes wrong:** The `context.previous` snapshot is stale if multiple mutations fire in rapid succession before the first settles.

**Why it happens:** Each `onMutate` captures the query data at call time; rapid mutations capture increasingly stale snapshots.

**How to avoid:** `cancelQueries` in `onMutate` is essential — it prevents in-flight queries from overwriting the optimistic update and keeps the snapshot accurate. This is already shown in the `useMutation` pattern above.

### Pitfall 4: Auth Forms Cannot Be Optimistic

**What goes wrong:** Optimistically logging in the user before the server confirms auth creates a security gap.

**Why it happens:** Optimism assumes the server will agree with the client's expected state. Auth is inherently adversarial — you cannot predict the outcome.

**How to avoid:** Sign-in, register, forgot-password — all must block and wait. They get loading spinners only, not optimistic updates.

### Pitfall 5: Financial Records Should Not Be Optimistic Without Careful Thought

**What goes wrong:** Optimistically appending an expense with a fake `id` ("temp-xxx") can break downstream code that reads `id` for receipt links, delete buttons, etc.

**Why it happens:** The temp ID is not a real DB UUID. If any code deriving from the list item needs a real ID before `onSettled` completes, it will use the temp ID and break.

**How to avoid:** Two options:
1. Mark optimistic items with an `isOptimistic: true` flag and disable ID-dependent actions (delete, link) until `onSettled` fires.
2. Use `useTransition` + `isPending` spinner instead of `useOptimistic` for records where the ID matters immediately (e.g., payment record, since the receipt page needs the real payment ID).

For this codebase: expenses and income are good optimistic candidates because users don't need to navigate to a per-expense page. Payments and loans are poor candidates for the same reason.

---

## Loading Animation Patterns

### Forms That Navigate Away (no optimism possible)

Use `useTransition` + `isPending` + disabled button + `Loader2` spinner:

```typescript
<Button type="submit" disabled={isPending}>
  {isPending ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />Registering...</> : "Register Customer"}
</Button>
```

**Loader2 is already installed** via `lucide-react`. `record-payment-form.tsx` already uses this exact pattern. Standardize it everywhere.

### Sign-In / Register / Forgot Password

Same `isPending` + `Loader2` pattern. These are auth calls (`Better Auth` client methods), not Server Actions, so `useTransition` wraps the async call just like any other:

```typescript
const [isPending, startTransition] = useTransition()

function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  startTransition(async () => {
    const result = await signIn.email({ email, password })
    // ...
  })
}
```

### Page-Level Loading (Skeleton Screens)

The `(app)` route group can use Next.js `loading.tsx` files for page-level suspense:

```typescript
// src/app/(app)/loading.tsx  — applies to all (app) pages
export default function Loading() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
      <div className="h-4 w-full rounded bg-muted animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
    </div>
  )
}
```

This is Tailwind `animate-pulse` — zero JS, already in the bundle.

---

## Code Examples

### Full useMutation Pattern for Expense List (verified from TanStack docs)

```typescript
// src/app/(app)/expenses/ExpenseListClient.tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { recordExpenseAction, deleteExpenseAction } from "./actions"

const QUERY_KEY = ["expenses"] as const

export function ExpenseListClient({
  initialTransactions,
  categories,
}: {
  initialTransactions: Transaction[]
  categories: Category[]
}) {
  const queryClient = useQueryClient()
  const [localTransactions, setLocalTransactions] = useState(initialTransactions)

  const addMutation = useMutation({
    mutationFn: recordExpenseAction,
    onMutate: async (input) => {
      const optimistic: Transaction = {
        id: `optimistic-${Date.now()}`,
        ...buildTransactionFromInput(input),
        isOptimistic: true,
      }
      setLocalTransactions((prev) => [optimistic, ...prev])
      return { optimistic }
    },
    onError: (_err, _input, context) => {
      // Remove the optimistic entry
      setLocalTransactions((prev) =>
        prev.filter((t) => t.id !== context?.optimistic.id)
      )
      toast.error("Failed to record expense")
    },
    onSuccess: (result, _input, context) => {
      if ("error" in result) {
        setLocalTransactions((prev) =>
          prev.filter((t) => t.id !== context?.optimistic.id)
        )
        toast.error(result.error)
        return
      }
      // Replace optimistic with real record
      setLocalTransactions((prev) =>
        prev.map((t) =>
          t.id === context?.optimistic.id ? result.data : t
        )
      )
      toast.success("Expense recorded")
    },
  })
  // ...
}
```

**Note:** Because the app's Server Actions return `{ error } | { data }` instead of throwing, the pattern above is simpler than the TanStack Query cache-based approach. It manages `localTransactions` in React state rather than the query cache, which sidesteps the `initialData` stale problem (Pitfall 2).

### useTransition Upgrade Pattern (drop-in for useState(submitting))

```typescript
// Before (current pattern)
const [submitting, setSubmitting] = useState(false)
async function handleSubmit(e) {
  setSubmitting(true)
  const result = await createCustomerAction(...)
  setSubmitting(false)
  // ...
}

// After (useTransition)
const [isPending, startTransition] = useTransition()
function handleSubmit(e) {
  e.preventDefault()
  startTransition(async () => {
    const result = await createCustomerAction(...)
    // ...
  })
}

// Template literal in button: identical to before
<Button disabled={isPending}>
  {isPending ? "Registering..." : "Register Customer"}
</Button>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `useFormState` (React 18) | `useActionState` (React 19) | React 19 stable (2024) | Rename + added `pending` as 3rd return value |
| `useFormStatus` from `react-dom` | Still valid in React 19 | No change | Good for SubmitButton component pattern |
| `useState(loading)` for Server Actions | `useTransition` | React 18+ | Scheduler-aware, keeps UI responsive |
| TanStack Query v4 `cacheTime` | v5 `gcTime` | TQ v5 (2024) | Breaking rename — `cacheTime` no longer exists |

**Deprecated/outdated:**
- `useFormState`: Renamed to `useActionState` in React 19. `useFormState` still exists as an alias but shows a deprecation warning.
- TanStack Query v4: `cacheTime` renamed to `gcTime`; `useQuery` `status: "loading"` renamed to `status: "pending"`. Do not use v4 docs.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x + Cypress 15.x |
| Config file | `vitest.config.ts` (unit), `cypress.config.ts` (e2e) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements → Test Map

Phase 5 has no new business-logic requirements (TBD per ROADMAP.md). Tests validate UX behavior:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| Button shows spinner while Server Action pending | Cypress e2e | `cypress run --spec cypress/e2e/customer-crud.cy.ts` | Needs update |
| Optimistic row appears before server returns | Cypress e2e | `cypress run --spec cypress/e2e/expenses.cy.ts` | Needs update |
| Rollback on Server Action error | Cypress e2e | New spec | No — Wave 0 gap |
| `useTransition` does not throw on error return | Vitest unit | `pnpm test` | No — Wave 0 gap |
| QueryClientProvider renders without SSR error | Cypress e2e | Existing suite smoke | Existing |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test && pnpm test:e2e`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/optimistic-rollback.cy.ts` — covers rollback on error for expense/income mutations
- [ ] Existing Cypress specs need button state assertions (disabled while pending) — update rather than create new

---

## Open Questions

1. **TanStack Query vs localTransactions useState**
   - What we know: The Server Actions return `{ error } | { data }` not throws. Both `useMutation` with query cache and `useState(localTransactions)` with mutation callbacks work.
   - What's unclear: Whether the planner should scope TanStack Query to expenses/income only, or also to the payments list on the loan detail page.
   - Recommendation: Scope TanStack Query to `ExpenseListClient` and `IncomeListClient` where list-level state management already exists. Loan detail payments use `router.refresh()` (Server Component re-fetch) — that page has complex recalculation data (BigNumber interests) that cannot be optimistically computed client-side.

2. **Animation scope for loading.tsx**
   - What we know: Next.js 16 App Router supports `loading.tsx` for Suspense-based page loading skeletons.
   - What's unclear: Whether the client wants page-level skeletons or just form-submit loading states.
   - Recommendation: Add a single `(app)/loading.tsx` with a simple pulse skeleton as a safe default; individual page skeletons can be added incrementally.

3. **Providers placement: root layout vs (app) layout**
   - What we know: Auth pages do not need TanStack Query cache.
   - Recommendation: Place `<Providers>` in `src/app/(app)/layout.tsx` only, not the root layout. This is the minimal blast radius.

---

## Sources

### Primary (HIGH confidence)
- `/node_modules/next/dist/docs/01-app/02-guides/forms.md` — `useOptimistic` + Server Actions patterns, `useActionState`, `useFormStatus`
- React 19 official docs (react.dev) — `useOptimistic`, `useTransition`, `useActionState`
- TanStack Query v5 peerDependencies (`react: '^18 || ^19'`) — confirmed React 19 support

### Secondary (MEDIUM confidence)
- `npm view @tanstack/react-query version` — confirmed 5.94.5 as latest stable (2026-03-22)
- TanStack Query v5 migration guide — `cacheTime` → `gcTime`, `status: "loading"` → `status: "pending"` renames

### Tertiary (LOW confidence)
- General community pattern for "TanStack Query + Server Actions with return-object error pattern" — verified by examining existing `ExpenseListClient.tsx` which already uses `useTransition`

---

## Metadata

**Confidence breakdown:**
- React hooks API (`useOptimistic`, `useTransition`): HIGH — verified from installed Next.js node_modules docs
- TanStack Query v5 API: HIGH — current npm version confirmed, peer deps confirmed React 19 support
- Form inventory: HIGH — read every affected file directly from codebase
- Loading patterns: HIGH — Tailwind animate-pulse + Loader2 already in project
- Pitfalls: HIGH — derived directly from code reading (return-object error pattern, existing `useTransition` in expenses)

**Research date:** 2026-03-22
**Valid until:** 2026-09-22 (stable APIs — 6 months)
