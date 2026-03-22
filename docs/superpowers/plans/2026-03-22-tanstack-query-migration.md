# TanStack Query Full Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all data fetching and mutations from useEffect/useTransition to TanStack Query with optimistic updates, centralized query keys, and hook-per-entity architecture.

**Architecture:** Centralized query keys factory + one hook file per entity in `src/hooks/`. Each hook wraps server actions with `unwrapAction` for error handling, uses `useMutation` with optimistic updates (cancel → snapshot → update → rollback on error), and invalidates related caches in `onSettled`. Pages become thin consumers of hooks.

**Tech Stack:** `@tanstack/react-query@^5` (already installed), Sonner toasts (already installed), Next.js Server Actions, Effect.js services

**Spec:** `docs/superpowers/specs/2026-03-22-tanstack-query-migration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/hooks/query-keys.ts` | Hierarchical query key factory for all entities |
| `src/hooks/query-utils.ts` | `unwrapAction` helper to convert `{ error }` returns into thrown errors |
| `src/hooks/use-dashboard.ts` | `useDashboard()` query hook |
| `src/hooks/use-customers.ts` | `useCustomers()`, `useCustomer()`, `useCreateCustomer()`, `useUpdateCustomer()`, `useChangeCustomerStatus()` |
| `src/hooks/use-loans.ts` | `useLoans()`, `useLoan()`, `useCreateLoan()` |
| `src/hooks/use-payments.ts` | `usePayments()`, `useRecordPayment()`, `useEditPayment()`, `useDeletePayment()` |
| `src/hooks/use-watchlist.ts` | `useWatchlist()` query hook |
| `src/hooks/use-creditors.ts` | `useCreditors()`, `useSystemCapital()`, `useCreditorDashboard()`, `useCreateCreditor()`, `useUpdateCreditor()`, `useAddInvestment()`, `useRecordCreditorRepayment()` |
| `src/hooks/use-transactions.ts` | `useIncome()`, `useExpenses()`, `useCategories()`, `useRecordIncome()`, `useRecordExpense()`, `useDeleteIncome()`, `useDeleteExpense()`, `useCreateIncomeCategory()`, `useCreateExpenseCategory()`, `useDeleteIncomeCategory()`, `useDeleteExpenseCategory()` |
| `src/actions/creditor.actions.ts` | Server actions wrapping creditor read services |
| `src/actions/transaction.actions.ts` | Server actions wrapping transaction/category listing services |
| `src/hooks/__tests__/query-utils.test.ts` | Tests for `unwrapAction` |
| `src/hooks/__tests__/use-dashboard.test.ts` | Tests for dashboard hook |
| `src/hooks/__tests__/use-customers.test.ts` | Tests for customer hooks |
| `src/hooks/__tests__/use-loans.test.ts` | Tests for loan hooks |
| `src/hooks/__tests__/use-payments.test.ts` | Tests for payment hooks |
| `src/hooks/__tests__/use-watchlist.test.ts` | Tests for watchlist hook |
| `src/hooks/__tests__/use-creditors.test.ts` | Tests for creditor hooks |
| `src/hooks/__tests__/use-transactions.test.ts` | Tests for transaction hooks |

### Files to Modify
| File | Changes |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | Replace useEffect/useState with `useDashboard()` |
| `src/app/(app)/customers/page.tsx` | Replace useEffect with `useCustomers()` + `keepPreviousData` |
| `src/app/(app)/customers/new/page.tsx` | Use `useCreateCustomer()` from shared hooks |
| `src/app/(app)/customers/[id]/page.tsx` | Use hooks from `use-customers.ts` |
| `src/app/(app)/loans/page.tsx` | Replace useEffect with `useLoans()` |
| `src/app/(app)/loans/new/page.tsx` | Use `useCreateLoan()` hook |
| `src/app/(app)/loans/[loanId]/page.tsx` | Remove payment fetching from server, pass loanId to client |
| `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | Replace useTransition with `usePayments()`, `useEditPayment()`, `useDeletePayment()` |
| `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` | Replace useTransition with `useRecordPayment()` |
| `src/app/(app)/watchlist/page.tsx` | Replace useEffect with `useWatchlist()` |
| `src/app/(app)/creditors/page.tsx` | Convert server component to client, use `useCreditors()` + `useSystemCapital()` |
| `src/app/(app)/creditors/[id]/page.tsx` | Convert server component to client, use creditor hooks |
| `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx` | Use `useUpdateCreditor()` hook |
| `src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx` | Use `useAddInvestment()` hook |
| `src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx` | Use `useRecordCreditorRepayment()` hook |
| `src/app/(app)/income/page.tsx` | Remove server data fetching, render client component without props |
| `src/app/(app)/income/IncomeListClient.tsx` | Replace prop-based init + inline mutations with `use-transactions.ts` hooks |
| `src/app/(app)/expenses/page.tsx` | Remove server data fetching, render client component without props |
| `src/app/(app)/expenses/ExpenseListClient.tsx` | Replace prop-based init + inline mutations with `use-transactions.ts` hooks |
| `src/actions/payment.actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/creditors/actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/income/actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/expenses/actions.ts` | Remove `revalidatePath()` calls |

---

## Task 1: Foundation — Query Keys + Utils

**Files:**
- Create: `src/hooks/query-keys.ts`
- Create: `src/hooks/query-utils.ts`
- Create: `src/hooks/__tests__/query-utils.test.ts`

- [ ] **Step 0: Add jsdom environment for hook tests**

The vitest config uses `environment: "node"` by default, but `renderHook` from `@testing-library/react` requires a DOM. Add a `// @vitest-environment jsdom` docblock to each hook test file (preferred over changing the global config, which would break existing service tests that expect Node).

Alternatively, create `src/hooks/__tests__/vitest-env.d.ts` — but the docblock approach is simplest. Every test file in `src/hooks/__tests__/` must start with:

```ts
// @vitest-environment jsdom
```

Also ensure `@testing-library/react` is installed:

Run: `npm ls @testing-library/react`

If not installed: `npm install -D @testing-library/react @testing-library/jest-dom`

- [ ] **Step 1: Write the failing test for `unwrapAction`**

```ts
// src/hooks/__tests__/query-utils.test.ts
import { describe, it, expect } from "vitest"
import { unwrapAction } from "../query-utils"

describe("unwrapAction", () => {
  it("returns data from successful response", () => {
    const result = unwrapAction({ data: { id: "1", name: "Test" } })
    expect(result).toEqual({ id: "1", name: "Test" })
  })

  it("throws Error on error response", () => {
    expect(() => unwrapAction({ error: "Unauthorized" })).toThrow("Unauthorized")
  })

  it("throws Error with correct message", () => {
    expect(() => unwrapAction({ error: "Not found" })).toThrow("Not found")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/query-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `query-utils.ts`**

```ts
// src/hooks/query-utils.ts

/**
 * Unwraps server action responses for TanStack Query.
 * Server actions return `{ data: T } | { error: string }`.
 * TanStack Query needs queryFn/mutationFn to throw on error.
 */
export function unwrapAction<T>(result: { data: T } | { error: string; details?: unknown }): T {
  if ("error" in result) throw new Error(result.error)
  return result.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/query-utils.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Create `query-keys.ts`**

```ts
// src/hooks/query-keys.ts
import type { CustomerSearchParams } from "@/types"

export const queryKeys = {
  customers: {
    all: ["customers"] as const,
    list: (params: CustomerSearchParams) => ["customers", "list", params] as const,
    detail: (id: string) => ["customers", "detail", id] as const,
  },
  loans: {
    all: ["loans"] as const,
    list: () => ["loans", "list"] as const,
    detail: (id: string) => ["loans", "detail", id] as const,
  },
  payments: {
    all: ["payments"] as const,
    byLoan: (loanId: string) => ["payments", "loan", loanId] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
  },
  watchlist: {
    all: ["watchlist"] as const,
  },
  creditors: {
    all: ["creditors"] as const,
    detail: (id: string) => ["creditors", "detail", id] as const,
    dashboard: (id: string) => ["creditors", "dashboard", id] as const,
    systemCapital: () => ["creditors", "systemCapital"] as const,
  },
  transactions: {
    income: () => ["transactions", "income"] as const,
    expenses: () => ["transactions", "expenses"] as const,
    categories: (type: string) => ["transactions", "categories", type] as const,
  },
}
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/query-keys.ts src/hooks/query-utils.ts src/hooks/__tests__/query-utils.test.ts
git commit -m "feat: add query keys factory and unwrapAction utility"
```

---

## Task 2: New Server Actions for Creditors + Transactions

**Files:**
- Create: `src/actions/creditor.actions.ts`
- Create: `src/actions/transaction.actions.ts`
**Note:** `revalidatePath` removal is deferred to each page's own migration task (Tasks 7–9) to avoid breaking pages between migrations. Do NOT remove `revalidatePath` here.

- [ ] **Step 1: Create `src/actions/creditor.actions.ts`**

```ts
// src/actions/creditor.actions.ts
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  listCreditors,
  getCreditor,
  getCreditorDashboard,
  getSystemCapital,
} from "@/services/creditor.service"
import type { ApiResponse, Creditor, CreditorDashboard } from "@/types"

export async function listCreditorsAction(): Promise<ApiResponse<Creditor[]>> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listCreditors())
    return { data }
  } catch {
    return { error: "Failed to load creditors" }
  }
}

export async function getCreditorAction(id: string): Promise<ApiResponse<Creditor>> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getCreditor(id))
    return { data }
  } catch {
    return { error: "Creditor not found" }
  }
}

export async function getCreditorDashboardAction(
  creditorId: string,
): Promise<ApiResponse<CreditorDashboard>> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getCreditorDashboard(creditorId))
    return { data }
  } catch {
    return { error: "Failed to load creditor dashboard" }
  }
}

export async function getSystemCapitalAction(): Promise<
  ApiResponse<{
    totalInvested: string
    totalInterestAccrued: string
    totalRepaymentsMade: string
    totalOutstanding: string
  }>
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getSystemCapital())
    return { data }
  } catch {
    return { error: "Failed to load system capital" }
  }
}
```

- [ ] **Step 2: Create `src/actions/transaction.actions.ts`**

```ts
// src/actions/transaction.actions.ts
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import type { ApiResponse, TransactionCategory } from "@/types"

export async function listTransactionsAction(
  type: "credit" | "debit",
): Promise<
  ApiResponse<{
    data: (typeof import("@/lib/db/schema/transactions").transactions.$inferSelect & {
      categoryName: string
    })[]
    total: number
  }>
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const result = await Effect.runPromise(
      listTransactions({ type }, 1, 1000),
    )
    return { data: result }
  } catch {
    return { error: "Failed to load transactions" }
  }
}

export async function listCategoriesAction(
  type: "expense" | "income",
): Promise<ApiResponse<TransactionCategory[]>> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listCategories(type))
    return { data }
  } catch {
    return { error: "Failed to load categories" }
  }
}
```

- [ ] **Step 3: Refactor `src/app/(app)/creditors/actions.ts` to use `{ data } | { error }` pattern**

The existing creditor mutation actions (`createCreditorAction`, `updateCreditorAction`, `addInvestmentAction`, `recordCreditorRepaymentAction`) return bare objects and throw on auth failure. This is inconsistent with the `{ data } | { error }` pattern used by all other actions. Refactor them to match:

```ts
// Example for createCreditorAction — apply same pattern to all four:
export async function createCreditorAction(input: CreateCreditorInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const creditor = await Effect.runPromise(
      createCreditor(input, session.user.id)
    )
    revalidatePath("/creditors")  // keep until Task 8 migrates creditor pages
    return { data: creditor }
  } catch {
    return { error: "Failed to create creditor" }
  }
}
```

Apply the same `try/catch` + `{ data } | { error }` wrapping to `updateCreditorAction`, `addInvestmentAction`, and `recordCreditorRepaymentAction`. Remove the `getSessionOrThrow` helper — use inline session check with `return { error }` instead of throwing.

- [ ] **Step 4: Refactor `src/app/(app)/income/actions.ts` and `src/app/(app)/expenses/actions.ts` to use `{ data } | { error }` pattern**

Same refactoring — these actions currently return `void` and throw on auth failure. Wrap in `try/catch`, return `{ data }` or `{ error }` consistently. This ensures `unwrapAction` works uniformly across all hooks.

- [ ] **Step 5: Verify build**

Run: `npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds (no missing imports)

- [ ] **Step 6: Commit**

```bash
git add src/actions/creditor.actions.ts src/actions/transaction.actions.ts src/app/\(app\)/creditors/actions.ts src/app/\(app\)/income/actions.ts src/app/\(app\)/expenses/actions.ts
git commit -m "feat: add read actions, standardize all actions to { data } | { error } pattern"
```

---

## Task 3: Dashboard Hook + Page Migration

**Files:**
- Create: `src/hooks/use-dashboard.ts`
- Create: `src/hooks/__tests__/use-dashboard.test.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Write failing test for `useDashboard`**

```ts
// src/hooks/__tests__/use-dashboard.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useDashboard } from "../use-dashboard"

vi.mock("@/actions/dashboard.actions", () => ({
  getDashboardAction: vi.fn(),
}))

import { getDashboardAction } from "@/actions/dashboard.actions"

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns dashboard data on success", async () => {
    const mockData = {
      kpis: {
        loansOutstanding: "1000000",
        repaymentsCollected: "500000",
        interestEarned: "100000",
        activeBorrowers: 5,
        overdueCount: 2,
        capitalInSystem: "2000000",
      },
      activity: [],
    }
    vi.mocked(getDashboardAction).mockResolvedValue({ data: mockData })

    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockData)
  })

  it("sets error state on error response", async () => {
    vi.mocked(getDashboardAction).mockResolvedValue({ error: "Unauthorized" })

    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe("Unauthorized")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-dashboard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/hooks/use-dashboard.ts`**

```ts
// src/hooks/use-dashboard.ts
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { getDashboardAction } from "@/actions/dashboard.actions"

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard.all,
    queryFn: () => getDashboardAction().then(unwrapAction),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-dashboard.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Migrate `dashboard/page.tsx`**

Replace the `useEffect`/`useState` pattern (lines 63-79) with `useDashboard()`. Remove `useState` for `kpis`, `activity`, `loading`, `error`. Keep `expandedId` state and all helper functions unchanged.

The page should:
1. Add `import { useDashboard } from "@/hooks/use-dashboard"`
2. Replace the four `useState` calls + `useEffect` with:
   ```ts
   const { data, isLoading: loading, error: queryError } = useDashboard()
   const kpis = data?.kpis ?? null
   const activity = data?.activity ?? []
   const error = queryError?.message ?? null
   const [expandedId, setExpandedId] = useState<string | null>(null)
   ```
3. Remove the `getDashboardAction` import
4. Remove `useEffect` import if no longer used

- [ ] **Step 6: Verify dashboard loads**

Run: `npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-dashboard.ts src/hooks/__tests__/use-dashboard.test.ts src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: migrate dashboard to useDashboard() hook"
```

---

## Task 4: Watchlist Hook + Page Migration

**Files:**
- Create: `src/hooks/use-watchlist.ts`
- Create: `src/hooks/__tests__/use-watchlist.test.ts`
- Modify: `src/app/(app)/watchlist/page.tsx`

- [ ] **Step 1: Write failing test for `useWatchlist`**

```ts
// src/hooks/__tests__/use-watchlist.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useWatchlist } from "../use-watchlist"

vi.mock("@/actions/watchlist.actions", () => ({
  getWatchlistAction: vi.fn(),
}))

import { getWatchlistAction } from "@/actions/watchlist.actions"

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useWatchlist", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns watchlist data on success", async () => {
    const mockData = [
      {
        customerId: "c1",
        customerName: "John",
        loanId: "l1",
        loanAmount: "500000",
        outstandingBalance: "400000",
        daysOverdue: "15",
        dailyRate: "1667",
        lastPaymentDate: null,
      },
    ]
    vi.mocked(getWatchlistAction).mockResolvedValue({ data: mockData })

    const { result } = renderHook(() => useWatchlist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockData)
  })

  it("sets error state on error response", async () => {
    vi.mocked(getWatchlistAction).mockResolvedValue({ error: "Unauthorized" })

    const { result } = renderHook(() => useWatchlist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-watchlist.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-watchlist.ts`**

```ts
// src/hooks/use-watchlist.ts
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { getWatchlistAction } from "@/actions/watchlist.actions"

export function useWatchlist() {
  return useQuery({
    queryKey: queryKeys.watchlist.all,
    queryFn: () => getWatchlistAction().then(unwrapAction),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-watchlist.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate `watchlist/page.tsx`**

Replace `useEffect`/`useState` pattern with `useWatchlist()`. Remove manual loading/error state. Keep all rendering logic.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-watchlist.ts src/hooks/__tests__/use-watchlist.test.ts src/app/\(app\)/watchlist/page.tsx
git commit -m "feat: migrate watchlist to useWatchlist() hook"
```

---

## Task 5: Loans Hook + Page Migration

**Files:**
- Create: `src/hooks/use-loans.ts`
- Create: `src/hooks/__tests__/use-loans.test.ts`
- Modify: `src/app/(app)/loans/page.tsx`
- Modify: `src/app/(app)/loans/new/page.tsx`

- [ ] **Step 1: Write failing test for `useLoans` and `useCreateLoan`**

```ts
// src/hooks/__tests__/use-loans.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useLoans, useCreateLoan } from "../use-loans"

vi.mock("@/actions/loan.actions", () => ({
  listLoansAction: vi.fn(),
  createLoanAction: vi.fn(),
}))

import { listLoansAction, createLoanAction } from "@/actions/loan.actions"

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useLoans", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns loans list on success", async () => {
    const mockLoans = [{ id: "l1", principalAmount: "500000" }]
    vi.mocked(listLoansAction).mockResolvedValue({ data: mockLoans })

    const { result } = renderHook(() => useLoans(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockLoans)
  })
})

describe("useCreateLoan", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls createLoanAction and invalidates loans cache on success", async () => {
    const mockLoan = { id: "l1", principalAmount: "500000" }
    vi.mocked(createLoanAction).mockResolvedValue({ data: mockLoan })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useCreateLoan(), { wrapper })

    result.current.mutate({
      customerId: "c1",
      principalAmount: "500000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: "2026-01-01",
      collateral: { nature: "Land title" },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-loans.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-loans.ts`**

```ts
// src/hooks/use-loans.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { listLoansAction, createLoanAction, getLoanAction } from "@/actions/loan.actions"
import { toast } from "sonner"
import type { CreateLoanInput } from "@/types"

// Note: if `getLoanAction` does not exist in loan.actions.ts, create it following
// the same pattern as other read actions:
// export async function getLoanAction(loanId: string): Promise<ApiResponse<Loan>> {
//   const session = await auth.api.getSession({ headers: await headers() })
//   if (!session?.user) return { error: "Unauthorized" }
//   try {
//     const data = await Effect.runPromise(getLoan(loanId))
//     return { data }
//   } catch { return { error: "Loan not found" } }
// }

export function useLoans() {
  return useQuery({
    queryKey: queryKeys.loans.list(),
    queryFn: () => listLoansAction().then(unwrapAction),
  })
}

export function useLoan(loanId: string) {
  return useQuery({
    queryKey: queryKeys.loans.detail(loanId),
    queryFn: () => getLoanAction(loanId).then(unwrapAction),
    enabled: !!loanId,
  })
}

export function useCreateLoan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLoanInput) =>
      createLoanAction(input).then(unwrapAction),
    onError: (error) => {
      toast.error(error.message || "Failed to create loan")
    },
    onSuccess: () => {
      toast.success("Loan created successfully")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-loans.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate `loans/page.tsx`**

Replace `useEffect`/`useState` pattern with `useLoans()`. Remove manual loading/error state.

- [ ] **Step 6: Migrate `loans/new/page.tsx`**

Replace the inline `useTransition` + `createLoanAction` call with `useCreateLoan()`. Use `mutation.mutate(input)` instead of `startTransition`. Use `mutation.isPending` for loading state. Remove `useTransition` import. Keep existing `queryClient.getQueryData` cache lookup for customer prefill.

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/hooks/__tests__/use-loans.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-loans.ts src/hooks/__tests__/use-loans.test.ts src/app/\(app\)/loans/page.tsx src/app/\(app\)/loans/new/page.tsx
git commit -m "feat: migrate loans pages to useLoans/useCreateLoan hooks"
```

---

## Task 6: Customers Hook + Pages Migration

**Files:**
- Create: `src/hooks/use-customers.ts`
- Create: `src/hooks/__tests__/use-customers.test.ts`
- Modify: `src/app/(app)/customers/page.tsx`
- Modify: `src/app/(app)/customers/new/page.tsx`
- Modify: `src/app/(app)/customers/[id]/page.tsx`

- [ ] **Step 1: Write failing test for customer hooks**

```ts
// src/hooks/__tests__/use-customers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useCustomers, useCreateCustomer, useUpdateCustomer, useChangeCustomerStatus } from "../use-customers"

vi.mock("@/actions/customer.actions", () => ({
  searchCustomersAction: vi.fn(),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
  changeCustomerStatusAction: vi.fn(),
  getCustomerAction: vi.fn(),
}))

import { searchCustomersAction, createCustomerAction, updateCustomerAction, changeCustomerStatusAction } from "@/actions/customer.actions"

function createWrapper(qc?: QueryClient) {
  const queryClient = qc ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useCustomers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches customers with search params and uses keepPreviousData", async () => {
    const mockResult = {
      customers: [{ id: "c1", fullName: "Alice" }],
      total: 1,
    }
    vi.mocked(searchCustomersAction).mockResolvedValue({ data: mockResult })

    const { result } = renderHook(
      () => useCustomers({ name: "Alice", page: 0 }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockResult)
    expect(searchCustomersAction).toHaveBeenCalledWith({ name: "Alice", page: 0 })
  })
})

describe("useCreateCustomer", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates customer and invalidates cache", async () => {
    const mockCustomer = { id: "c1", fullName: "Alice", contact: "0700", address: "Kampala" }
    vi.mocked(createCustomerAction).mockResolvedValue({ data: mockCustomer })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate({ fullName: "Alice", contact: "0700", address: "Kampala" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})

describe("useUpdateCustomer", () => {
  beforeEach(() => vi.clearAllMocks())

  it("updates customer and invalidates detail + list caches", async () => {
    const mockCustomer = { id: "c1", fullName: "Alice Updated" }
    vi.mocked(updateCustomerAction).mockResolvedValue({ data: mockCustomer })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useUpdateCustomer("c1"), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate({ fullName: "Alice Updated" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})

describe("useChangeCustomerStatus", () => {
  beforeEach(() => vi.clearAllMocks())

  it("changes status and invalidates customer + watchlist caches", async () => {
    vi.mocked(changeCustomerStatusAction).mockResolvedValue({ data: { id: "c1", status: "blacklisted" } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useChangeCustomerStatus(), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate({ customerId: "c1", newStatus: "blacklisted", reason: "Defaulted" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-customers.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-customers.ts`**

```ts
// src/hooks/use-customers.ts
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import {
  searchCustomersAction,
  createCustomerAction,
  getCustomerAction,
  updateCustomerAction,
  changeCustomerStatusAction,
} from "@/actions/customer.actions"
import { toast } from "sonner"
import type { CreateCustomerInput, UpdateCustomerInput, ChangeStatusInput, CustomerSearchParams } from "@/types"

export function useCustomers(params: CustomerSearchParams) {
  return useQuery({
    queryKey: queryKeys.customers.list(params),
    queryFn: () => searchCustomersAction(params).then(unwrapAction),
    placeholderData: keepPreviousData,
  })
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => getCustomerAction(id).then(unwrapAction),
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      createCustomerAction(input).then(unwrapAction),
    onError: (error) => {
      toast.error(error.message || "Failed to create customer")
    },
    onSuccess: () => {
      toast.success("Customer registered")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })
}

export function useUpdateCustomer(customerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCustomerInput) =>
      updateCustomerAction(customerId, input).then(unwrapAction),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.customers.detail(customerId) })
      const previous = queryClient.getQueryData(queryKeys.customers.detail(customerId))
      queryClient.setQueryData(queryKeys.customers.detail(customerId), (old: any) =>
        old ? { ...old, ...input } : old,
      )
      return { previous }
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(queryKeys.customers.detail(customerId), context?.previous)
      toast.error(error.message || "Failed to update customer")
    },
    onSuccess: () => {
      toast.success("Customer updated")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })
}

export function useChangeCustomerStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChangeStatusInput) =>
      changeCustomerStatusAction(input).then(unwrapAction),
    onError: (error) => {
      toast.error(error.message || "Failed to change status")
    },
    onSuccess: () => {
      toast.success("Customer status updated")
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(input.customerId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist.all })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-customers.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate `customers/page.tsx`**

Replace `useEffect`/`useState` data fetching with `useCustomers({ name: search, page, status: statusFilter, ... })`. Use `isPlaceholderData` to dim stale results. Remove manual loading/error state. Keep search input, pagination controls, and status filter rendering.

- [ ] **Step 6: Migrate `customers/new/page.tsx`**

Replace inline `useMutation` + `queryClient` logic with `useCreateCustomer()` from shared hooks. The existing optimistic temp-ID pattern can be simplified — `useCreateCustomer` handles cache invalidation. Keep the form validation and redirect on success.

- [ ] **Step 7: Migrate `customers/[id]/page.tsx`**

Replace inline `useQuery` calls (with hardcoded query keys like `["customer", id]`) with `useCustomer(id)` from shared hooks. Replace inline mutation logic with `useUpdateCustomer(id)` and `useChangeCustomerStatus()`. Keep UI rendering, modals, and loan expansion logic.

- [ ] **Step 8: Run all customer tests**

Run: `npx vitest run src/hooks/__tests__/use-customers.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/hooks/use-customers.ts src/hooks/__tests__/use-customers.test.ts src/app/\(app\)/customers/
git commit -m "feat: migrate customer pages to shared React Query hooks"
```

---

## Task 7: Payments Hook + Pages Migration

**Files:**
- Create: `src/hooks/use-payments.ts`
- Create: `src/hooks/__tests__/use-payments.test.ts`
- Modify: `src/app/(app)/loans/[loanId]/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- Modify: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`

- [ ] **Step 1: Write failing test for payment hooks**

```ts
// src/hooks/__tests__/use-payments.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { usePayments, useRecordPayment, useEditPayment, useDeletePayment } from "../use-payments"

vi.mock("@/actions/payment.actions", () => ({
  getPaymentsByLoanAction: vi.fn(),
  recordPaymentAction: vi.fn(),
  editPaymentAction: vi.fn(),
  deletePaymentAction: vi.fn(),
}))

import {
  getPaymentsByLoanAction,
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
} from "@/actions/payment.actions"

function createWrapper(qc?: QueryClient) {
  const queryClient = qc ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("usePayments", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches payments for a loan", async () => {
    const mockPayments = [{ id: "p1", amount: "50000" }]
    vi.mocked(getPaymentsByLoanAction).mockResolvedValue({ data: mockPayments })

    const { result } = renderHook(() => usePayments("loan-1"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockPayments)
  })
})

describe("useRecordPayment", () => {
  beforeEach(() => vi.clearAllMocks())

  it("records payment and invalidates related caches", async () => {
    vi.mocked(recordPaymentAction).mockResolvedValue({ data: { id: "p1", amount: "50000" } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useRecordPayment("loan-1"), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        loanId: "loan-1",
        paymentDate: "2026-01-15",
        amount: "50000",
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it("rolls back optimistic update on error", async () => {
    vi.mocked(recordPaymentAction).mockResolvedValue({ error: "Insufficient balance" })
    vi.mocked(getPaymentsByLoanAction).mockResolvedValue({ data: [] })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData")

    const { result } = renderHook(() => useRecordPayment("loan-1"), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        loanId: "loan-1",
        paymentDate: "2026-01-15",
        amount: "50000",
      })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // setQueryData should have been called for rollback
    expect(setQueryDataSpy).toHaveBeenCalled()
  })
})

describe("useEditPayment", () => {
  beforeEach(() => vi.clearAllMocks())

  it("edits payment and invalidates caches including watchlist", async () => {
    vi.mocked(editPaymentAction).mockResolvedValue({ data: { id: "p1" } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useEditPayment("loan-1"), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ paymentId: "p1", amount: "60000", reason: "Correction" })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})

describe("useDeletePayment", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes payment and invalidates caches", async () => {
    vi.mocked(deletePaymentAction).mockResolvedValue({ data: { id: "p1" } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useDeletePayment("loan-1"), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ paymentId: "p1", reason: "Duplicate entry" })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-payments.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-payments.ts`**

```ts
// src/hooks/use-payments.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import {
  getPaymentsByLoanAction,
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
} from "@/actions/payment.actions"
import { toast } from "sonner"
import type { RecordPaymentInput, EditPaymentInput, DeletePaymentInput } from "@/types"

export function usePayments(loanId: string) {
  return useQuery({
    queryKey: queryKeys.payments.byLoan(loanId),
    queryFn: () => getPaymentsByLoanAction(loanId).then(unwrapAction),
    enabled: !!loanId,
  })
}

function invalidatePaymentRelated(
  queryClient: ReturnType<typeof useQueryClient>,
  loanId: string,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loanId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
  queryClient.invalidateQueries({ queryKey: queryKeys.watchlist.all })
}

export function useRecordPayment(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordPaymentInput) =>
      recordPaymentAction(input).then(unwrapAction),
    onMutate: async (newPayment) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
      const previous = queryClient.getQueryData(queryKeys.payments.byLoan(loanId))
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), (old: any) =>
        old
          ? [
              {
                ...newPayment,
                id: `temp-${Date.now()}`,
                interestPortion: null,
                principalPortion: null,
                principalBalanceAfter: null,
                createdAt: new Date(),
              },
              ...old,
            ]
          : old,
      )
      return { previous }
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), context?.previous)
      toast.error(error.message || "Failed to record payment")
    },
    onSuccess: () => {
      toast.success("Payment recorded")
    },
    onSettled: () => {
      invalidatePaymentRelated(queryClient, loanId)
    },
  })
}

export function useEditPayment(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EditPaymentInput) =>
      editPaymentAction(input).then(unwrapAction),
    onError: (error) => {
      toast.error(error.message || "Failed to edit payment")
    },
    onSuccess: () => {
      toast.success("Payment updated")
    },
    onSettled: () => {
      invalidatePaymentRelated(queryClient, loanId)
    },
  })
}

export function useDeletePayment(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DeletePaymentInput) =>
      deletePaymentAction(input).then(unwrapAction),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
      const previous = queryClient.getQueryData(queryKeys.payments.byLoan(loanId))
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), (old: any) =>
        old ? old.filter((p: any) => p.id !== input.paymentId) : old,
      )
      return { previous }
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), context?.previous)
      toast.error(error.message || "Failed to delete payment")
    },
    onSuccess: () => {
      toast.success("Payment deleted")
    },
    onSettled: () => {
      invalidatePaymentRelated(queryClient, loanId)
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-payments.test.ts`
Expected: PASS

- [ ] **Step 5: Remove `revalidatePath` from `src/actions/payment.actions.ts`**

Remove the `import { revalidatePath } from "next/cache"` line and all `revalidatePath(...)` calls. React Query now manages cache invalidation.

- [ ] **Step 6: Modify `loans/[loanId]/page.tsx` — remove payment fetching from server**

Keep the server component fetching loan + customer data. Remove `getPaymentsForLoan` import and call. Pass only `loan`, `customerName`, and `loanId` to `LoanDetailClient` (not `payments`).

- [ ] **Step 7: Migrate `loan-detail-client.tsx`**

1. Add `import { usePayments, useEditPayment, useDeletePayment } from "@/hooks/use-payments"`
2. Remove `payments` from props — fetch via `usePayments(loan.id)` instead
3. Replace `useTransition` for edit with `useEditPayment(loan.id)`
4. Replace `useTransition` for delete with `useDeletePayment(loan.id)`
5. Remove `router.refresh()` calls
6. Remove `useRouter` import if no longer needed
7. Use `editMutation.isPending` and `deleteMutation.isPending` for loading states

- [ ] **Step 8: Migrate `record-payment-form.tsx`**

1. Add `import { useRecordPayment } from "@/hooks/use-payments"`
2. Replace `useTransition` + `recordPaymentAction` with `useRecordPayment(loanId)`
3. Use `mutation.mutate(input)` and `mutation.isPending` for loading
4. Keep form validation logic unchanged

- [ ] **Step 9: Run tests**

Run: `npx vitest run src/hooks/__tests__/use-payments.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/hooks/use-payments.ts src/hooks/__tests__/use-payments.test.ts src/actions/payment.actions.ts src/app/\(app\)/loans/\[loanId\]/
git commit -m "feat: migrate payment pages to React Query hooks with optimistic updates"
```

---

## Task 8: Creditors Hook + Pages Migration

**Files:**
- Create: `src/hooks/use-creditors.ts`
- Create: `src/hooks/__tests__/use-creditors.test.ts`
- Modify: `src/app/(app)/creditors/page.tsx`
- Modify: `src/app/(app)/creditors/[id]/page.tsx`
- Modify: `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx`
- Modify: `src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx`
- Modify: `src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx`

- [ ] **Step 1: Write failing test for creditor hooks**

```ts
// src/hooks/__tests__/use-creditors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useCreditors, useSystemCapital, useCreditorDashboard, useCreateCreditor, useAddInvestment } from "../use-creditors"

vi.mock("@/actions/creditor.actions", () => ({
  listCreditorsAction: vi.fn(),
  getSystemCapitalAction: vi.fn(),
  getCreditorDashboardAction: vi.fn(),
  getCreditorAction: vi.fn(),
}))

vi.mock("@/app/(app)/creditors/actions", () => ({
  createCreditorAction: vi.fn(),
  updateCreditorAction: vi.fn(),
  addInvestmentAction: vi.fn(),
  recordCreditorRepaymentAction: vi.fn(),
}))

import { listCreditorsAction, getSystemCapitalAction, getCreditorDashboardAction } from "@/actions/creditor.actions"
import { createCreditorAction, addInvestmentAction } from "@/app/(app)/creditors/actions"

function createWrapper(qc?: QueryClient) {
  const queryClient = qc ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useCreditors", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches creditor list", async () => {
    const mockCreditors = [{ id: "cr1", name: "Bank A" }]
    vi.mocked(listCreditorsAction).mockResolvedValue({ data: mockCreditors })

    const { result } = renderHook(() => useCreditors(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockCreditors)
  })
})

describe("useSystemCapital", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches system capital data", async () => {
    const mockCapital = {
      totalInvested: "10000000",
      totalInterestAccrued: "500000",
      totalRepaymentsMade: "3000000",
      totalOutstanding: "7500000",
    }
    vi.mocked(getSystemCapitalAction).mockResolvedValue({ data: mockCapital })

    const { result } = renderHook(() => useSystemCapital(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockCapital)
  })
})

describe("useCreditorDashboard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches creditor dashboard", async () => {
    const mockDashboard = {
      totalInvested: "5000000",
      interestAccrued: "200000",
      repaymentsMade: "1000000",
      outstandingBalance: "4200000",
      investments: [],
    }
    vi.mocked(getCreditorDashboardAction).mockResolvedValue({ data: mockDashboard })

    const { result } = renderHook(() => useCreditorDashboard("cr1"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockDashboard)
  })
})

describe("useCreateCreditor", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates creditor and invalidates list", async () => {
    vi.mocked(createCreditorAction).mockResolvedValue({ id: "cr1", name: "Bank A" })

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useCreateCreditor(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ name: "Bank A", contact: "0700", address: "Kampala" })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-creditors.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-creditors.ts`**

```ts
// src/hooks/use-creditors.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import {
  listCreditorsAction,
  getCreditorAction,
  getCreditorDashboardAction,
  getSystemCapitalAction,
} from "@/actions/creditor.actions"
import {
  createCreditorAction,
  updateCreditorAction,
  addInvestmentAction,
  recordCreditorRepaymentAction,
} from "@/app/(app)/creditors/actions"
import { toast } from "sonner"
import type {
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types"

export function useCreditors() {
  return useQuery({
    queryKey: queryKeys.creditors.all,
    queryFn: () => listCreditorsAction().then(unwrapAction),
  })
}

export function useCreditor(id: string) {
  return useQuery({
    queryKey: queryKeys.creditors.detail(id),
    queryFn: () => getCreditorAction(id).then(unwrapAction),
    enabled: !!id,
  })
}

// Note: The spec mentions `listCreditorInvestmentsAction` and `listCreditorRepaymentsAction`
// separately, but the `getCreditorDashboard` service already returns investment summaries
// (including amounts, rates, balances, and repayment totals) via the `investments` field.
// Separate investment/repayment list actions are NOT needed — the dashboard hook provides all data.
export function useCreditorDashboard(creditorId: string) {
  return useQuery({
    queryKey: queryKeys.creditors.dashboard(creditorId),
    queryFn: () => getCreditorDashboardAction(creditorId).then(unwrapAction),
    enabled: !!creditorId,
  })
}

export function useSystemCapital() {
  return useQuery({
    queryKey: queryKeys.creditors.systemCapital(),
    queryFn: () => getSystemCapitalAction().then(unwrapAction),
  })
}

export function useCreateCreditor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCreditorInput) =>
      createCreditorAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to create creditor")
    },
    onSuccess: () => {
      toast.success("Creditor registered")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.all })
    },
  })
}

export function useUpdateCreditor(creditorId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCreditorInput) =>
      updateCreditorAction(creditorId, input).then(unwrapAction),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.creditors.detail(creditorId) })
      const previous = queryClient.getQueryData(queryKeys.creditors.detail(creditorId))
      queryClient.setQueryData(queryKeys.creditors.detail(creditorId), (old: any) =>
        old ? { ...old, ...input } : old,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(queryKeys.creditors.detail(creditorId), context?.previous)
      toast.error("Failed to update creditor")
    },
    onSuccess: () => {
      toast.success("Creditor updated")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.detail(creditorId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.all })
    },
  })
}

export function useAddInvestment(creditorId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddInvestmentInput) =>
      addInvestmentAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to add investment")
    },
    onSuccess: () => {
      toast.success("Investment added")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.detail(creditorId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.dashboard(creditorId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.systemCapital() })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}

export function useRecordCreditorRepayment(creditorId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordCreditorRepaymentInput) =>
      recordCreditorRepaymentAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to record repayment")
    },
    onSuccess: () => {
      toast.success("Repayment recorded")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.detail(creditorId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.dashboard(creditorId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditors.systemCapital() })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-creditors.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate `creditors/page.tsx` — server to client**

Convert from `async` server component to `"use client"` component:
1. Add `"use client"` directive
2. Replace Effect imports with `useCreditors()` and `useSystemCapital()` hooks
3. Use `isLoading` for skeleton states
4. Keep all rendering logic (KPI cards, table, empty state)

- [ ] **Step 6: Migrate `creditors/[id]/page.tsx` — server to client**

Convert from `async` server component to `"use client"` component:
1. Add `"use client"` directive
2. Use `useParams()` from `next/navigation` to get `id` (this is the correct Next.js 16 pattern for client components — do NOT use `React.use(params)` which is for server components). Check `node_modules/next/dist/docs/` if unsure.
3. Use `useCreditor(id)` and `useCreditorDashboard(id)` hooks
4. Pass hook data to `CreditorProfileClient` or inline the rendering
5. Remove `revalidatePath` from `src/app/(app)/creditors/actions.ts` — no longer needed since React Query manages cache

- [ ] **Step 7: Migrate creditor dialogs**

Update `AddInvestmentDialog.tsx` to use `useAddInvestment(creditorId)`.
Update `RecordRepaymentDialog.tsx` to use `useRecordCreditorRepayment(creditorId)`.
Remove any `revalidatePath` trigger mechanisms (router.refresh, etc).

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/hooks/__tests__/use-creditors.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/hooks/use-creditors.ts src/hooks/__tests__/use-creditors.test.ts src/app/\(app\)/creditors/
git commit -m "feat: migrate creditor pages to React Query hooks"
```

---

## Task 9: Transactions Hook + Income/Expense Migration

**Files:**
- Create: `src/hooks/use-transactions.ts`
- Create: `src/hooks/__tests__/use-transactions.test.ts`
- Modify: `src/app/(app)/income/page.tsx`
- Modify: `src/app/(app)/income/IncomeListClient.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`
- Modify: `src/app/(app)/expenses/ExpenseListClient.tsx`

- [ ] **Step 1: Write failing test for transaction hooks**

```ts
// src/hooks/__tests__/use-transactions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { useIncome, useExpenses, useCategories, useRecordIncome, useDeleteIncome } from "../use-transactions"

vi.mock("@/actions/transaction.actions", () => ({
  listTransactionsAction: vi.fn(),
  listCategoriesAction: vi.fn(),
}))

vi.mock("@/app/(app)/income/actions", () => ({
  recordIncomeAction: vi.fn(),
  deleteIncomeAction: vi.fn(),
  createIncomeCategoryAction: vi.fn(),
  deleteIncomeCategoryAction: vi.fn(),
}))

vi.mock("@/app/(app)/expenses/actions", () => ({
  recordExpenseAction: vi.fn(),
  deleteExpenseAction: vi.fn(),
  createExpenseCategoryAction: vi.fn(),
  deleteExpenseCategoryAction: vi.fn(),
}))

import { listTransactionsAction, listCategoriesAction } from "@/actions/transaction.actions"
import { recordIncomeAction, deleteIncomeAction } from "@/app/(app)/income/actions"

function createWrapper(qc?: QueryClient) {
  const queryClient = qc ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useIncome", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches income transactions", async () => {
    const mockData = { data: [{ id: "t1", amount: "50000" }], total: 1 }
    vi.mocked(listTransactionsAction).mockResolvedValue({ data: mockData })

    const { result } = renderHook(() => useIncome(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listTransactionsAction).toHaveBeenCalledWith("credit")
  })
})

describe("useCategories", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches categories by type", async () => {
    const mockCategories = [{ id: "cat1", name: "Interest Earned", type: "income" }]
    vi.mocked(listCategoriesAction).mockResolvedValue({ data: mockCategories })

    const { result } = renderHook(() => useCategories("income"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listCategoriesAction).toHaveBeenCalledWith("income")
  })
})

describe("useRecordIncome", () => {
  beforeEach(() => vi.clearAllMocks())

  it("records income and invalidates caches", async () => {
    vi.mocked(recordIncomeAction).mockResolvedValue(undefined)

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useRecordIncome(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        categoryId: "cat1",
        amount: "50000",
        transactionDate: "2026-01-15",
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-transactions.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `src/hooks/use-transactions.ts`**

```ts
// src/hooks/use-transactions.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { listTransactionsAction, listCategoriesAction } from "@/actions/transaction.actions"
import {
  recordIncomeAction,
  deleteIncomeAction,
  createIncomeCategoryAction,
  deleteIncomeCategoryAction,
} from "@/app/(app)/income/actions"
import {
  recordExpenseAction,
  deleteExpenseAction,
  createExpenseCategoryAction,
  deleteExpenseCategoryAction,
} from "@/app/(app)/expenses/actions"
import { toast } from "sonner"
import type { CreateIncomeInput, CreateExpenseInput, CreateCategoryInput } from "@/types"

export function useIncome() {
  return useQuery({
    queryKey: queryKeys.transactions.income(),
    queryFn: () => listTransactionsAction("credit").then(unwrapAction),
  })
}

export function useExpenses() {
  return useQuery({
    queryKey: queryKeys.transactions.expenses(),
    queryFn: () => listTransactionsAction("debit").then(unwrapAction),
  })
}

export function useCategories(type: "income" | "expense") {
  return useQuery({
    queryKey: queryKeys.transactions.categories(type),
    queryFn: () => listCategoriesAction(type).then(unwrapAction),
  })
}

export function useRecordIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateIncomeInput) =>
      recordIncomeAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to record income")
    },
    onSuccess: () => {
      toast.success("Income recorded")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.income() })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}

export function useRecordExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      recordExpenseAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to record expense")
    },
    onSuccess: () => {
      toast.success("Expense recorded")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.expenses() })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}

export function useDeleteIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      deleteIncomeAction(id).then(unwrapAction),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.transactions.income() })
      const previous = queryClient.getQueryData(queryKeys.transactions.income())
      queryClient.setQueryData(queryKeys.transactions.income(), (old: any) =>
        old ? { ...old, data: old.data.filter((t: any) => t.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(queryKeys.transactions.income(), context?.previous)
      toast.error("Failed to delete income")
    },
    onSuccess: () => {
      toast.success("Income deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.income() })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}

export function useDeleteExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      deleteExpenseAction(id).then(unwrapAction),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.transactions.expenses() })
      const previous = queryClient.getQueryData(queryKeys.transactions.expenses())
      queryClient.setQueryData(queryKeys.transactions.expenses(), (old: any) =>
        old ? { ...old, data: old.data.filter((t: any) => t.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(queryKeys.transactions.expenses(), context?.previous)
      toast.error("Failed to delete expense")
    },
    onSuccess: () => {
      toast.success("Expense deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.expenses() })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}

export function useCreateIncomeCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      createIncomeCategoryAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to create category")
    },
    onSuccess: () => {
      toast.success("Category created")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.categories("income") })
    },
  })
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      createExpenseCategoryAction(input).then(unwrapAction),
    onError: () => {
      toast.error("Failed to create category")
    },
    onSuccess: () => {
      toast.success("Category created")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.categories("expense") })
    },
  })
}

export function useDeleteIncomeCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      deleteIncomeCategoryAction(id).then(unwrapAction),
    onError: () => {
      toast.error("Failed to delete category")
    },
    onSuccess: () => {
      toast.success("Category deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.categories("income") })
    },
  })
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      deleteExpenseCategoryAction(id).then(unwrapAction),
    onError: () => {
      toast.error("Failed to delete category")
    },
    onSuccess: () => {
      toast.success("Category deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.categories("expense") })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-transactions.test.ts`
Expected: PASS

- [ ] **Step 5: Remove `revalidatePath` from income and expense actions**

Remove `revalidatePath` calls from `src/app/(app)/income/actions.ts` and `src/app/(app)/expenses/actions.ts`. React Query now manages cache invalidation.

- [ ] **Step 6: Migrate `income/page.tsx`**

Remove server-side data fetching. The page becomes a thin wrapper that renders `IncomeListClient` without passing `initialTransactions` or `categories` as props.

- [ ] **Step 7: Migrate `IncomeListClient.tsx`**

1. Remove `initialTransactions` and `categories` props
2. Replace `useState(initialTransactions)` with `useIncome()` hook
3. Replace `useState(categories)` with `useCategories("income")` hook
4. Replace inline `useMutation` calls with `useRecordIncome()`, `useDeleteIncome()`, `useCreateIncomeCategory()`, `useDeleteIncomeCategory()` hooks
5. Remove local optimistic state management — hooks handle it

- [ ] **Step 8: Migrate `expenses/page.tsx` and `ExpenseListClient.tsx`**

Same pattern as income. Replace server-rendered props with `useExpenses()`, `useCategories("expense")`, `useRecordExpense()`, `useDeleteExpense()`, `useCreateExpenseCategory()`, `useDeleteExpenseCategory()` hooks.

- [ ] **Step 9: Run tests**

Run: `npx vitest run src/hooks/__tests__/use-transactions.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/hooks/use-transactions.ts src/hooks/__tests__/use-transactions.test.ts src/actions/transaction.actions.ts src/app/\(app\)/income/ src/app/\(app\)/expenses/
git commit -m "feat: migrate income/expense pages to React Query hooks"
```

---

## Task 10: Run All Unit Tests

- [ ] **Step 1: Run full hook test suite**

Run: `npx vitest run src/hooks/__tests__/`
Expected: ALL PASS

- [ ] **Step 2: Run full project test suite**

Run: `npx vitest run`
Expected: ALL PASS (existing tests should not be broken)

- [ ] **Step 3: Fix any failures**

If any tests fail, fix them. Common issues:
- Imports changed (action files no longer export revalidatePath-related code)
- Props changed (components no longer accept `initialTransactions` etc.)

- [ ] **Step 4: Build check**

Run: `npx next build --no-lint 2>&1 | tail -30`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test and build issues after React Query migration"
```

---

## Task 11: Cypress Integration Tests

**Files:**
- Modify/verify: `cypress/e2e/dashboard.cy.ts`
- Modify/verify: `cypress/e2e/customer-crud.cy.ts`
- Modify/verify: `cypress/e2e/customer-search.cy.ts`
- Modify/verify: `cypress/e2e/payments.cy.ts`
- Modify/verify: `cypress/e2e/loans-list.cy.ts`
- Modify/verify: `cypress/e2e/creditors.cy.ts`
- Modify/verify: `cypress/e2e/income.cy.ts`
- Modify/verify: `cypress/e2e/expenses.cy.ts`
- Modify/verify: `cypress/e2e/optimistic-rollback.cy.ts`

- [ ] **Step 1: Run existing Cypress tests**

Run: `npx cypress run --spec "cypress/e2e/dashboard.cy.ts,cypress/e2e/customer-crud.cy.ts,cypress/e2e/payments.cy.ts,cypress/e2e/loans-list.cy.ts"`
Expected: Note which tests pass and which fail. Failures are expected if tests relied on `router.refresh()` behavior or specific loading patterns.

- [ ] **Step 2: Fix any failing Cypress tests**

Common fixes needed:
- Tests that checked for specific loading states may need adjustment
- Tests that relied on `revalidatePath` page refreshes may need to wait for React Query cache updates instead
- Add `cy.wait()` or assertion retries where optimistic updates change timing

- [ ] **Step 3: Run creditor and transaction Cypress tests**

Run: `npx cypress run --spec "cypress/e2e/creditors.cy.ts,cypress/e2e/income.cy.ts,cypress/e2e/expenses.cy.ts"`
Expected: Note failures, fix as needed

- [ ] **Step 4: Run optimistic rollback test**

Run: `npx cypress run --spec "cypress/e2e/optimistic-rollback.cy.ts"`
Expected: Verify optimistic update + rollback behavior works end-to-end

- [ ] **Step 5: Run full Cypress suite**

Run: `npx cypress run`
Expected: ALL PASS

- [ ] **Step 6: Commit any test fixes**

```bash
git add cypress/
git commit -m "fix: update Cypress tests for React Query migration"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run all Cypress tests**

Run: `npx cypress run`
Expected: ALL PASS

- [ ] **Step 3: Build verification**

Run: `npx next build --no-lint`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test checklist**

Verify these flows work:
1. Dashboard loads KPIs and activity feed
2. Customer list with search + pagination (no loading flash)
3. Create customer → list updates
4. Loan list loads
5. Create loan → list updates, dashboard KPIs update
6. Record payment → appears in list immediately (optimistic)
7. Edit payment → list updates
8. Delete payment → disappears immediately (optimistic)
9. Watchlist reflects payment changes
10. Creditors list loads with KPI cards
11. Add investment → creditor detail updates
12. Record creditor repayment → dashboard updates
13. Income list loads, create/delete work
14. Expense list loads, create/delete work

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete TanStack Query migration with optimistic updates"
```
