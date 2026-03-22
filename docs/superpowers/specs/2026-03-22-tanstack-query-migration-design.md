# TanStack Query Full Migration — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Full migration of all data fetching and mutations to TanStack Query with optimistic updates

## Context

The app has `@tanstack/react-query@^5` installed with `QueryClientProvider` configured (`src/components/providers.tsx`), but it's barely used. Most pages use `useEffect` + server actions with manual `useState` for loading/error. Mutations use `useTransition` + `router.refresh()`, causing full page re-renders instead of targeted cache updates.

### Current Problems
- No client-side caching — every page visit re-fetches all data
- `router.refresh()` after mutations causes full page re-renders
- Manual `useState` boilerplate for loading/error on every page
- No optimistic updates (except customer registration)
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
  use-creditors.ts       — useCreditors(), useCreditor(id), useCreateCreditor(), useUpdateCreditor(), useAddInvestment(), useRecordCreditorRepayment()
  use-transactions.ts    — useIncome(), useExpenses(), useRecordIncome(), useRecordExpense(), useDeleteTransaction()
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
  },
  transactions: {
    income: () => ['transactions', 'income'] as const,
    expenses: () => ['transactions', 'expenses'] as const,
  },
}
```

Hierarchical keys allow both targeted invalidation (`queryKeys.customers.detail(id)`) and broad invalidation (`queryKeys.customers.all` wipes list + all details).

## Mutation Pattern

Every mutation hook follows the same structure:

```ts
export function useRecordPayment(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input) => recordPaymentAction(input),
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
    },
  })
}
```

### Optimistic Update Behavior
- **On mutate:** Immediately update the UI with the expected result
- **On error:** Roll back cache to previous snapshot, show error toast via Sonner
- **On settled:** Always invalidate related queries to sync with server truth

## Cache Invalidation Map

| Mutation | Invalidates |
|---|---|
| Create customer | `customers.all` |
| Update customer | `customers.detail(id)`, `customers.all` |
| Change customer status | `customers.detail(id)`, `customers.all`, `watchlist.all` |
| Create loan | `loans.all`, `customers.detail(customerId)`, `dashboard.all` |
| Record payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all`, `watchlist.all` |
| Edit payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all` |
| Delete payment | `payments.byLoan(id)`, `loans.detail(id)`, `dashboard.all` |
| Create creditor | `creditors.all` |
| Update creditor | `creditors.detail(id)`, `creditors.all` |
| Add investment | `creditors.detail(id)`, `creditors.all`, `dashboard.all` |
| Record creditor repayment | `creditors.detail(id)`, `creditors.all` |
| Record income | `transactions.income`, `dashboard.all` |
| Delete income | `transactions.income`, `dashboard.all` |
| Record expense | `transactions.expenses`, `dashboard.all` |
| Delete expense | `transactions.expenses`, `dashboard.all` |

Dashboard is invalidated by most mutations since KPIs aggregate across entities. Invalidation only triggers a refetch if the query is actively observed (user is viewing the dashboard).

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

### Creditors, Income, Expenses
- Same pattern: replace `useEffect`/`useTransition` with `useQuery`/`useMutation` hooks

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
| `src/hooks/use-customers.ts` | Customer queries + mutations |
| `src/hooks/use-loans.ts` | Loan queries + mutations |
| `src/hooks/use-payments.ts` | Payment queries + mutations |
| `src/hooks/use-dashboard.ts` | Dashboard query |
| `src/hooks/use-watchlist.ts` | Watchlist query |
| `src/hooks/use-creditors.ts` | Creditor queries + mutations |
| `src/hooks/use-transactions.ts` | Income/expense queries + mutations |

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
| `src/app/(app)/creditors/` (multiple files) | Replace mutations with creditor hooks |
| `src/app/(app)/income/` + `src/app/(app)/expenses/` | Replace with transaction hooks |

## Testing

### Vitest (Unit Tests for Hooks)
- Test each hook file with `@tanstack/react-query` test utilities
- Mock server actions
- Verify: correct query keys, optimistic cache updates, rollback on error, cross-entity invalidation

### Cypress (Integration Tests)
- Record payment → appears instantly in list (optimistic)
- Delete payment → disappears immediately
- Create customer → list updates
- Customer search → no loading flash (keepPreviousData)
- Create loan → loans list and dashboard update

### Not Tested Separately
- Server actions (covered by existing flows)
- Query key structure (implementation detail, covered by hook tests)

## Decisions Made
1. **Full migration** — all 6 list pages + all mutation forms
2. **Toast + rollback** on failure (Sonner)
3. **Custom hooks in `src/hooks/`** — one file per entity
4. **`keepPreviousData`** for customer search/pagination
5. **Hook-per-entity** architecture with centralized query keys
