# TanStack Query Full Migration — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Full migration of all data fetching and mutations to TanStack Query with optimistic updates

## Context

The app has `@tanstack/react-query@^5` installed with `QueryClientProvider` configured (`src/components/providers.tsx`), but it's barely used. Most pages use `useEffect` + server actions with manual `useState` for loading/error. Mutations use `useTransition` + `router.refresh()`, causing full page re-renders instead of targeted cache updates.

### Current State by Page
- **Dashboard, Customers, Loans, Watchlist:** `useEffect` + server actions + manual state
- **Loan detail:** Pure server component (Effect services)
- **Creditors list + detail:** Pure server components (Effect services, no action layer)
- **Income/Expenses:** Server-rendered initial data passed as props; mutations already use `useMutation` with optimistic updates, but initial data fetch is NOT via `useQuery`
- **Customer registration:** Already uses `useMutation` with optimistic updates
- **Customer detail:** Already uses `useQuery` + `useMutation`

### Current Problems
- No client-side caching — every page visit re-fetches all data
- `router.refresh()` after mutations causes full page re-renders
- Manual `useState` boilerplate for loading/error on every page
- No optimistic updates (except customer registration and income/expense mutations)
- No cross-entity invalidation (e.g., recording a payment doesn't update dashboard KPIs)

## Architecture

### Hook-per-entity with Centralized Query Keys

```
src/hooks/
  query-keys.ts          — single source of truth for all query keys
  use-customers.ts       — useCustomers(), useCustomer(id), useCreateCustomer(), useUpdateCustomer(), useChangeCustomerStatus()
  use-loans.ts           — useLoans(), useLoan(id), useCreateLoan()
  use-payments.ts        — usePayments(loanId), useRecordPayment(), useEditPayment(), useDeletePayment()
  use-dashboard.ts       — useDashboard()
  use-watchlist.ts       — useWatchlist()
  use-creditors.ts       — useCreditors(), useCreditor(id), useCreditorDashboard(id), useCreateCreditor(), useUpdateCreditor(), useAddInvestment(), useRecordCreditorRepayment()
  use-transactions.ts    — useIncome(), useExpenses(), useCategories(type), useRecordIncome(), useRecordExpense(), useDeleteTransaction(), useCreateCategory(), useDeleteCategory()
```

### Query Keys Factory

```ts
// src/hooks/query-keys.ts
export const queryKeys = {
  customers: {
    all: ['customers'] as const,
    list: (params: SearchParams) => ['customers', 'list', params] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
  },
  loans: {
    all: ['loans'] as const,
    list: () => ['loans', 'list'] as const,
    detail: (id: string) => ['loans', 'detail', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    byLoan: (loanId: string) => ['payments', 'loan', loanId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
  },
  watchlist: {
    all: ['watchlist'] as const,
  },
  creditors: {
    all: ['creditors'] as const,
    detail: (id: string) => ['creditors', 'detail', id] as const,
    dashboard: (id: string) => ['creditors', 'dashboard', id] as const,
  },
  transactions: {
    income: () => ['transactions', 'income'] as const,
    expenses: () => ['transactions', 'expenses'] as const,
    categories: (type: string) => ['transactions', 'categories', type] as const,
  },
}
```

Hierarchical keys allow both targeted invalidation (`queryKeys.customers.detail(id)`) and broad invalidation (`queryKeys.customers.all` wipes list + all details). TanStack Query v5 uses prefix matching by default in `invalidateQueries`, so `['customers']` matches `['customers', 'list', ...]` and `['customers', 'detail', ...]`.

## Server Action Error Handling

All server actions in this codebase return `{ error: string }` on failure rather than throwing. TanStack Query requires `queryFn`/`mutationFn` to throw on error. Every hook must use a wrapper:

```ts
// src/hooks/query-utils.ts
export function unwrapAction<T>(result: { data: T } | { error: string }): T {
  if ('error' in result) throw new Error(result.error)
  return result.data
}
```

Usage in hooks:
```ts
queryFn: () => listLoansAction().then(unwrapAction),
mutationFn: (input) => recordPaymentAction(input).then(unwrapAction),
```

This ensures `useQuery` correctly sets `error` state and `useMutation` triggers `onError` for rollback.

## revalidatePath Removal

Server actions currently call `revalidatePath()` to bust Next.js router cache. Once pages migrate to client-side cache management via TanStack Query, these `revalidatePath` calls become redundant and cause double-refresh (TanStack cache update + Next.js router cache bust).

**Action:** Remove `revalidatePath()` calls from all server actions that are consumed by React Query hooks:
- `src/actions/payment.actions.ts` — remove `revalidatePath('/loans/${input.loanId}')`
- `src/app/(app)/creditors/actions.ts` — remove all `revalidatePath` calls
- `src/app/(app)/income/actions.ts` — remove `revalidatePath` calls
- `src/app/(app)/expenses/actions.ts` — remove `revalidatePath` calls

## New Server Actions Required

Several pages currently fetch data via Effect services in server components. To migrate to client-side `useQuery`, new server actions are needed:

| New Action | File | Purpose |
|---|---|---|
| `listCreditorsAction()` | `src/actions/creditor.actions.ts` | List all creditors for `/creditors` |
| `getCreditorAction(id)` | `src/actions/creditor.actions.ts` | Single creditor detail |
| `getCreditorDashboardAction(id)` | `src/actions/creditor.actions.ts` | Creditor KPIs |
| `listCreditorInvestmentsAction(id)` | `src/actions/creditor.actions.ts` | Investments for a creditor |
| `listCreditorRepaymentsAction(id)` | `src/actions/creditor.actions.ts` | Repayments for a creditor |
| `getSystemCapitalAction()` | `src/actions/creditor.actions.ts` | System capital for creditors page |
| `listTransactionsAction(type)` | `src/actions/transaction.actions.ts` | List income or expense transactions |
| `listCategoriesAction(type)` | `src/actions/transaction.actions.ts` | List categories by type |

These follow the same pattern as existing actions: call Effect services, catch errors, return `{ data }` or `{ error }`.

## Mutation Pattern

Every mutation hook follows the same structure:

```ts
export function useRecordPayment(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordPaymentInput) =>
      recordPaymentAction(input).then(unwrapAction),
    onMutate: async (newPayment) => {
      // 1. Cancel in-flight queries to avoid race conditions
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
      // 2. Snapshot previous state for rollback
      const previous = queryClient.getQueryData(queryKeys.payments.byLoan(loanId))
      // 3. Optimistically update cache
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), (old) =>
        old ? [{ ...newPayment, id: 'temp-' + Date.now() }, ...old] : old
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      // 4. Rollback on failure
      queryClient.setQueryData(queryKeys.payments.byLoan(loanId), context?.previous)
      toast.error('Failed to record payment')
    },
    onSuccess: () => {
      toast.success('Payment recorded')
    },
    onSettled: () => {
      // 5. Always refetch to sync with server
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loanId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist.all })
    },
  })
}
```

### Optimistic Update Behavior
- **On mutate:** Immediately update the UI with the expected result
- **On error:** Roll back cache to previous snapshot, show error toast via Sonner
- **On settled:** Always invalidate related queries to sync with server truth

### Optimistic Update Limitations for Payments
Payment records include server-computed fields (`interestPortion`, `principalPortion`, `principalBalanceAfter`, `recordedBy`, `createdAt`). The optimistic row will only show `amount` and `paymentDate`; computed columns display a placeholder (e.g., "—" or a skeleton) until the server response replaces the temp row via `onSettled` invalidation. This is acceptable — the user sees immediate feedback that their payment was recorded, and full details appear within 1-2 seconds.

### Multi-argument Server Actions
Server actions with multiple arguments (e.g., `updateCreditorAction(id, input)`) must be wrapped for TanStack Query's single-argument `mutationFn`:
```ts
mutationFn: (vars: { id: string; input: UpdateCreditorInput }) =>
  updateCreditorAction(vars.id, vars.input).then(unwrapAction),
```

## Cache Invalidation Map

| Mutation | Invalidates |
|---|---|
| Create customer | `customers.all` |
| Update customer | `customers.detail(id)`, `customers.all` |
| Change customer status | `customers.detail(id)`, `customers.all`, `watchlist.all` |
| Create loan | `loans.all`, `customers.detail(customerId)`, `dashboard.all` |
| Record payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all`, `watchlist.all` |
| Edit payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all`, `watchlist.all` |
| Delete payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all`, `watchlist.all` |
| Create creditor | `creditors.all` |
| Update creditor | `creditors.detail(id)`, `creditors.all` |
| Add investment | `creditors.detail(id)`, `creditors.dashboard(id)`, `creditors.all`, `dashboard.all` |
| Record creditor repayment | `creditors.detail(id)`, `creditors.dashboard(id)`, `creditors.all` |
| Record income | `transactions.income`, `dashboard.all` |
| Delete income | `transactions.income`, `dashboard.all` |
| Record expense | `transactions.expenses`, `dashboard.all` |
| Delete expense | `transactions.expenses`, `dashboard.all` |
| Create/delete category | `transactions.categories(type)` |

Dashboard is invalidated by most mutations since KPIs aggregate across entities. Invalidation only triggers a refetch if the query is actively observed (user is viewing the dashboard).

Note: Edit payment and delete payment now also invalidate `watchlist.all` since balance recalculations can change overdue status.

## Page Migration Details

### Customer List (`/customers`)
- **Before:** `useEffect` + `searchCustomersAction()` + manual pagination state
- **After:** `useCustomers({ search, page })` with `placeholderData: keepPreviousData`
- `isPlaceholderData` flag used to dim stale results during refetch (no loading flash)

### Loans List (`/loans`)
- **Before:** `useEffect` + `listLoansAction()` + manual loading state
- **After:** `useLoans()` single hook call

### Dashboard (`/dashboard`)
- **Before:** `useEffect` + `getDashboardAction()` + manual loading state
- **After:** `useDashboard()` with appropriate staleTime

### Watchlist (`/watchlist`)
- **Before:** `useEffect` + `getWatchlistAction()` + no refresh capability
- **After:** `useWatchlist()` — auto-invalidated when payments are recorded

### Loan Detail (`/loans/[loanId]`)
- **Before:** Server component fetches loan + payments via Effect services
- **After:** Server component fetches loan + customer (fast first paint). Client component uses `usePayments(loanId)` for payment list, enabling optimistic record/edit/delete
- `router.refresh()` calls removed, replaced by cache invalidation

### Creditors List (`/creditors`)
- **Before:** Pure `async` server component calling `listCreditors()` + `getSystemCapital()` Effect services directly
- **After:** Convert to client component using `useCreditors()` + `useSystemCapital()`. Requires new `listCreditorsAction()` and `getSystemCapitalAction()` server actions.

### Creditor Detail (`/creditors/[id]`)
- **Before:** Pure `async` server component fetching creditor, dashboard, investments, and repayments via Effect services, passing all four as props to `CreditorProfileClient`
- **After:** Server component fetches only the creditor ID from params. Client component uses `useCreditor(id)`, `useCreditorDashboard(id)`, and related hooks. Requires new server actions for all four data shapes.

### Income & Expenses (`/income`, `/expenses`)
- **Before:** Server components fetch initial transactions + categories via Effect services, pass as props. Client components (`IncomeListClient`, `ExpenseListClient`) already use `useMutation` with optimistic updates for create/delete operations.
- **After:** Replace prop-passing with `useIncome()`/`useExpenses()` and `useCategories(type)` hooks for initial data fetch. Keep existing `useMutation` patterns but consolidate into `use-transactions.ts` hooks for consistency. Requires new `listTransactionsAction(type)` and `listCategoriesAction(type)` server actions.

### General Page Pattern

**Before:**
```tsx
const [data, setData] = useState([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)
useEffect(() => {
  fetchAction().then(setData).catch(setError).finally(() => setLoading(false))
}, [])
```

**After:**
```tsx
const { data, isLoading, error } = useEntityHook()
```

**Mutation before:**
```tsx
const [isPending, startTransition] = useTransition()
startTransition(async () => { await action(input); router.refresh() })
```

**Mutation after:**
```tsx
const { mutate, isPending } = useMutationHook()
mutate(input) // optimistic update + cache invalidation automatic
```

## Files to Create

| File | Contents |
|---|---|
| `src/hooks/query-keys.ts` | Query key factory |
| `src/hooks/query-utils.ts` | `unwrapAction` helper for error handling |
| `src/hooks/use-customers.ts` | Customer queries + mutations |
| `src/hooks/use-loans.ts` | Loan queries + mutations |
| `src/hooks/use-payments.ts` | Payment queries + mutations |
| `src/hooks/use-dashboard.ts` | Dashboard query |
| `src/hooks/use-watchlist.ts` | Watchlist query |
| `src/hooks/use-creditors.ts` | Creditor queries + mutations |
| `src/hooks/use-transactions.ts` | Income/expense queries + mutations + category hooks |
| `src/actions/creditor.actions.ts` | New server actions for creditor data fetching |
| `src/actions/transaction.actions.ts` | New server actions for transaction/category listing |

## Files to Modify

| File | Changes |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | Replace useEffect with `useDashboard()` |
| `src/app/(app)/customers/page.tsx` | Replace useEffect with `useCustomers()` + keepPreviousData |
| `src/app/(app)/customers/new/page.tsx` | Use `useCreateCustomer()` hook (already partial) |
| `src/app/(app)/customers/[id]/page.tsx` | Use hooks from `use-customers.ts` |
| `src/app/(app)/loans/page.tsx` | Replace useEffect with `useLoans()` |
| `src/app/(app)/loans/new/page.tsx` | Use `useCreateLoan()` hook |
| `src/app/(app)/loans/[loanId]/page.tsx` | Keep server loan fetch, add client payment hooks |
| `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | Replace useTransition with `useEditPayment()`, `useDeletePayment()` |
| `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` | Replace useTransition with `useRecordPayment()` |
| `src/app/(app)/watchlist/page.tsx` | Replace useEffect with `useWatchlist()` |
| `src/app/(app)/creditors/page.tsx` | Convert from server to client component, use `useCreditors()` |
| `src/app/(app)/creditors/[id]/page.tsx` | Convert from server to client component, use creditor hooks |
| `src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx` | Use `useAddInvestment()` hook |
| `src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx` | Use `useRecordCreditorRepayment()` hook |
| `src/app/(app)/income/page.tsx` | Stop server-rendering data, let client fetch via hooks |
| `src/app/(app)/income/IncomeListClient.tsx` | Replace prop-based init + inline mutations with `use-transactions.ts` hooks |
| `src/app/(app)/expenses/page.tsx` | Stop server-rendering data, let client fetch via hooks |
| `src/app/(app)/expenses/ExpenseListClient.tsx` | Replace prop-based init + inline mutations with `use-transactions.ts` hooks |
| `src/actions/payment.actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/creditors/actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/income/actions.ts` | Remove `revalidatePath()` calls |
| `src/app/(app)/expenses/actions.ts` | Remove `revalidatePath()` calls |

## Testing

### Vitest (Unit Tests for Hooks)
- Test each hook file with `@tanstack/react-query` test utilities
- Mock server actions
- Verify: correct query keys, optimistic cache updates, rollback on error, cross-entity invalidation
- Test `unwrapAction` wrapper correctly throws on `{ error }` responses
- Test rollback restores previous cache state on mutation error

### Cypress (Integration Tests)
- Record payment → appears instantly in list (optimistic)
- Delete payment → disappears immediately
- Create customer → list updates
- Customer search → no loading flash (keepPreviousData)
- Create loan → loans list and dashboard update
- Edit payment → watchlist updates if applicable

### Not Tested Separately
- Server actions (covered by existing flows)
- Query key structure (implementation detail, covered by hook tests)

## Decisions Made
1. **Full migration** — all 6 list pages + all mutation forms
2. **Toast + rollback** on failure (Sonner)
3. **Custom hooks in `src/hooks/`** — one file per entity
4. **`keepPreviousData`** for customer search/pagination
5. **Hook-per-entity** architecture with centralized query keys
6. **`unwrapAction` wrapper** to convert `{ error }` returns into thrown errors for React Query
7. **Remove `revalidatePath`** from actions consumed by React Query hooks
8. **Payment optimistic updates** show partial data (amount + date) with placeholders for server-computed fields
