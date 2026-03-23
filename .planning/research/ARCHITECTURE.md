# Architecture Patterns

**Domain:** Payment management — global list, daily collections, quick-record (v1.1 milestone)
**Researched:** 2026-03-23
**Confidence:** HIGH — based on direct reading of v1.0 codebase

---

## Context: What Already Exists

The following payment infrastructure is fully operational in v1.0 and must not be replaced — only extended.

| Existing Piece | Location | Role |
|----------------|----------|------|
| `payment.service.ts` | `src/services/` | Effect.js service: recordPayment, editPayment, deletePayment, getPaymentsForLoan |
| `payment.actions.ts` | `src/actions/` | Server Actions: recordPaymentAction, editPaymentAction, deletePaymentAction, getPaymentsByLoanAction |
| `RecordPaymentForm` | `src/app/(app)/loans/[loanId]/payments/new/` | Loan-scoped payment recording form |
| `LoanDetailClient` | `src/app/(app)/loans/[loanId]/` | Payment list per loan with edit/delete dialogs |
| `payments` schema | `src/lib/db/schema/payments.ts` | loanId, amount, interestPortion, principalPortion, balanceBefore/After, recordedBy, soft-delete fields |
| Sidebar nav | `src/components/layout/sidebar.tsx` | "Payments" nav item at `/payments` — currently `disabled: true` |

The sidebar already has a "Payments" slot at `href: "/payments"` marked `disabled: true`. Removing that flag is the final integration step — the nav link is already wired.

---

## Recommended Architecture for v1.1 Payments

### New Route: `/payments`

A single page route at `src/app/(app)/payments/page.tsx` following the same pattern as `/loans/page.tsx` and `/customers/page.tsx`:

- Server Component shell (`page.tsx`) — renders the client component, performs no data fetching
- Client Component (`PaymentsClient.tsx`) — owns all TanStack Query state, filters, tab switching

### Two-Tab Layout Within `/payments`

The page hosts two views under a tab switcher (shadcn `Tabs` component):

```
/payments
  Tab 1: "All Payments"      — paginated global list with search/filter
  Tab 2: "Daily Collections" — date-picker driven daily summary
```

No sub-routes needed. Tab state lives in URL search params (`?tab=daily&date=2026-03-23`) so deep links and refreshes work correctly. This matches Next.js 16 App Router conventions.

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/app/(app)/payments/page.tsx` | Server shell, no data fetch | Renders PaymentsClient |
| `src/app/(app)/payments/PaymentsClient.tsx` | Tab state, URL param sync, query client | PaymentListTab, DailyCollectionsTab, QuickRecordDialog |
| `src/app/(app)/payments/PaymentListTab.tsx` | Global paginated payment table, filter bar, "Record Payment" trigger | usePayments hook, QuickRecordDialog open state |
| `src/app/(app)/payments/DailyCollectionsTab.tsx` | Date picker, daily summary stats, day's payment list | useDailyCollections hook |
| `src/app/(app)/payments/QuickRecordDialog.tsx` | Modal: loan search → record payment inline without navigation | useLoans (existing), recordPaymentAction (existing) |
| `src/hooks/use-payments.ts` | TanStack Query wrapper for listPaymentsAction | payment.actions |
| `src/hooks/use-daily-collections.ts` | TanStack Query wrapper for getDailyCollectionsAction | payment.actions |

### Reuse Decisions

- **QuickRecordDialog reuses `recordPaymentAction` unchanged.** The action already accepts any `loanId`. It has no dependency on the current route. No modifications to the action needed.
- **The `loans` TanStack Query cache** (`queryKey: ["loans"]`) is already populated from `/loans` visits. QuickRecordDialog can call `listLoansAction()` with the same key to get a filtered list for the loan selector combobox.
- **`getPaymentsByLoanAction`** (already in `payment.actions.ts`) can be used inside QuickRecordDialog to display a selected loan's current balance before recording.
- **Edit and delete dialogs** from `LoanDetailClient` are not needed in the global list for v1.1 — the global list is read-only with links to loan detail pages. This keeps the scope bounded.

---

## Data Flow: Global Payments List

```
PaymentListTab
  → usePayments(filters, page)
    → useQuery(["payments", filters, page])
      → listPaymentsAction(filters)                [NEW Server Action]
        → payment.service.listPayments(filters)    [NEW service function]
          → db SELECT payments
               JOIN loans ON payments.loan_id = loans.id
               JOIN customers ON loans.customer_id = customers.id
             WHERE payments.deleted_at IS NULL
               AND [filters applied]
             ORDER BY payments.payment_date DESC
             LIMIT 25 OFFSET (page * 25)
```

### Filter Shape

```typescript
// Add to src/types/index.ts
export interface PaymentListFilters {
  search?: string      // matches customer full_name (ILIKE)
  dateFrom?: string    // ISO date — inclusive lower bound on payment_date
  dateTo?: string      // ISO date — inclusive upper bound on payment_date
  loanId?: string      // filter to a specific loan
  page?: number        // zero-indexed
  pageSize?: number    // default 25
}
```

### New Service Function Signature

```typescript
// Add to src/services/payment.service.ts
export const listPayments = (
  filters: PaymentListFilters
): Effect.Effect<{ rows: PaymentWithContext[]; total: number }, DatabaseError>
```

### New Composite Type

```typescript
// Add to src/types/index.ts
export interface PaymentWithContext {
  id: string
  loanId: string
  paymentDate: Date
  amount: string
  interestPortion: string
  principalPortion: string
  principalBalanceBefore: string
  principalBalanceAfter: string
  recordedBy: string
  deletedAt: Date | null
  createdAt: Date
  // Joined context
  customerName: string
  loanSlug: string      // loan.id.slice(-5) — matches existing loans list display pattern
}
```

---

## Data Flow: Daily Collections

```
DailyCollectionsTab
  → useDailyCollections(date)
    → useQuery(["dailyCollections", date])
      → getDailyCollectionsAction(date)                  [NEW Server Action]
        → payment.service.getDailyCollections(date)      [NEW service function]
          → db SELECT payments JOIN loans JOIN customers
            WHERE payments.payment_date::date = $date
              AND payments.deleted_at IS NULL
            ORDER BY payments.payment_date ASC
```

### Daily Summary Shape

```typescript
// Add to src/types/index.ts
export interface DailyCollectionsSummary {
  date: string
  totalCollected: string         // sum of amount (BigNumber)
  totalInterestPortion: string   // sum of interestPortion
  totalPrincipalPortion: string  // sum of principalPortion
  paymentCount: number
  payments: PaymentWithContext[]
}
```

Summary stats are computed from the fetched rows in the service — no second aggregation query. Daily payment volumes are bounded (typically 10-50 per day), so loading all rows for a single date is safe and fast.

---

## Data Flow: Quick-Record Payment

```
QuickRecordDialog
  Internal step state: "select-loan" | "enter-amount"

  Step 1 — Loan selector:
    → useQuery(["loans"]) [EXISTING query key from /loans page]
      → listLoansAction() [EXISTING action]
    → Combobox filtered by customer name or loan slug
    → On select: optionally call getPaymentsByLoanAction(loanId) to show current balance

  Step 2 — Record form:
    Fields: paymentDate (default today), amount
    → recordPaymentAction({ loanId, paymentDate, amount })
      → EXISTING action, ZERO changes needed
    On success:
      → queryClient.invalidateQueries({ queryKey: ["payments"] })
      → queryClient.invalidateQueries({ queryKey: ["dailyCollections"] })
      → queryClient.invalidateQueries({ queryKey: ["loans"] })  // status may change to fully_paid
      → toast.success("Payment recorded")
      → dialog closes
```

### Key UX Rule

The QuickRecordDialog does not navigate away. It stays on `/payments`. This is the core improvement over `/loans/[loanId]/payments/new` — the existing loan-scoped route is kept as-is for users who reach it from the loan detail page.

---

## Patterns to Follow

### Pattern 1: Thin Action, Effect Service

All existing actions follow this exact shape. Match it for the two new actions:

```typescript
// In src/actions/payment.actions.ts — add to bottom
export async function listPaymentsAction(filters: PaymentListFilters) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listPayments(filters))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getDailyCollectionsAction(date: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getDailyCollections(date))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

No Zod. TypeScript types for input validation. Runtime guards for auth only.

### Pattern 2: TanStack Query Hook

Mirrors `src/hooks/use-customers.ts` exactly:

```typescript
// src/hooks/use-payments.ts
export function usePayments(filters: PaymentListFilters, page: number) {
  return useQuery<{ rows: PaymentWithContext[]; total: number }>({
    queryKey: ["payments", filters, page],
    queryFn: async () => {
      const result = await listPaymentsAction({ ...filters, page, pageSize: 25 })
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })
}
```

### Pattern 3: URL Search Param State Sync

```typescript
// In PaymentsClient.tsx
const searchParams = useSearchParams()
const router = useRouter()

const activeTab = searchParams.get("tab") ?? "all"
const selectedDate = searchParams.get("date") ?? todayISODate()

function setTab(tab: string) {
  const params = new URLSearchParams(searchParams.toString())
  params.set("tab", tab)
  router.replace(`/payments?${params.toString()}`)
}
```

Enables deep-linking to `/payments?tab=daily&date=2026-03-23` and correct browser back/forward behavior.

### Pattern 4: Effect Service Function

New service functions follow the existing pattern:

```typescript
// In src/services/payment.service.ts — append to bottom
export const listPayments = (
  filters: PaymentListFilters
): Effect.Effect<{ rows: PaymentWithContext[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Drizzle query with JOIN, WHERE, LIMIT/OFFSET
      // ...
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

No new imports needed — `db`, `Effect`, `DatabaseError` are already imported.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Route Handler for Payments Data

**What:** Creating `/api/payments` route handler
**Why bad:** The project explicitly uses Server Actions (not Route Handlers) for all data access. Route Handlers add fetch ceremony and break architectural consistency.
**Instead:** Add `listPaymentsAction` and `getDailyCollectionsAction` to `src/actions/payment.actions.ts`.

### Anti-Pattern 2: Separate Sub-Route for Daily View

**What:** Creating `/payments/daily` as a separate page
**Why bad:** Unnecessary navigation complexity. Daily view is a filter on the same data model. Users lose filter context when switching views.
**Instead:** Tab switcher within `/payments`, state in URL search params.

### Anti-Pattern 3: Duplicating `recordPayment` Logic

**What:** Writing a new "quick record" service function
**Why bad:** `recordPaymentAction` already accepts any `loanId`. The existing loan-scoped form passes `loanId` from the URL, but the action has no route dependency.
**Instead:** Call `recordPaymentAction` from QuickRecordDialog directly. Zero service changes.

### Anti-Pattern 4: Loading All Payments Without Pagination

**What:** Fetching all payments globally on page load
**Why bad:** A live lending operation accumulates thousands of payments quickly. Unpaginated SELECT causes slow queries and slow render.
**Instead:** Server-side pagination with `LIMIT/OFFSET`. Default page size 25. Daily collections view is bounded by date and loads all rows for a single day (safe).

### Anti-Pattern 5: Bypassing Effect Error Wrapping

**What:** Writing `listPayments` as a plain `async` Drizzle query outside Effect
**Why bad:** All service functions use `Effect.tryPromise` for typed error propagation. Mixing patterns makes error handling inconsistent and breaks the test harness.
**Instead:** Wrap in `Effect.tryPromise` with `catch: (e) => new DatabaseError({ cause: e })`.

---

## Integration Points: New vs Modified

### New Files

| File | Type | Purpose |
|------|------|---------|
| `src/app/(app)/payments/page.tsx` | Server Component | Route shell |
| `src/app/(app)/payments/PaymentsClient.tsx` | Client Component | Tab/URL state, top-level layout |
| `src/app/(app)/payments/PaymentListTab.tsx` | Client Component | Global list with filters and pagination |
| `src/app/(app)/payments/DailyCollectionsTab.tsx` | Client Component | Date picker and daily summary |
| `src/app/(app)/payments/QuickRecordDialog.tsx` | Client Component | Inline payment recording modal |
| `src/hooks/use-payments.ts` | Hook | TanStack Query for global list |
| `src/hooks/use-daily-collections.ts` | Hook | TanStack Query for daily view |

### Modified Files

| File | Change | Risk |
|------|--------|------|
| `src/actions/payment.actions.ts` | Add `listPaymentsAction`, `getDailyCollectionsAction` | Low — additive only, existing actions untouched |
| `src/services/payment.service.ts` | Add `listPayments`, `getDailyCollections` functions | Low — additive only, existing functions untouched |
| `src/types/index.ts` | Add `PaymentWithContext`, `PaymentListFilters`, `DailyCollectionsSummary` types | Low — additive |
| `src/components/layout/sidebar.tsx` | Remove `disabled: true` from Payments nav item | Trivial — one-line change, do last |

### No Changes Needed

- `recordPaymentAction` — works as-is for QuickRecordDialog
- `payments` schema — no new columns required
- `loans` schema — no changes
- `src/app/(app)/loans/[loanId]/payments/new/` — kept as-is, still used from loan detail page

---

## Recommended Build Order

Dependencies dictate this order. Items at the same level can be built in parallel.

```
Level 1 — Foundation (sequential)
  1a. Types: PaymentWithContext, PaymentListFilters, DailyCollectionsSummary
      (src/types/index.ts — everything downstream imports these)

  1b. Service functions: listPayments, getDailyCollections
      (src/services/payment.service.ts — depends on types)

  1c. Server Actions: listPaymentsAction, getDailyCollectionsAction
      (src/actions/payment.actions.ts — depends on service functions)

Level 2 — Hooks (after actions, parallel with each other)
  2a. src/hooks/use-payments.ts
  2b. src/hooks/use-daily-collections.ts

Level 3 — Components (parallel, each depends on one hook)
  3a. PaymentListTab (depends on use-payments)
  3b. DailyCollectionsTab (depends on use-daily-collections)
  3c. QuickRecordDialog (depends only on existing recordPaymentAction + listLoansAction)

Level 4 — Route assembly (depends on all components)
  4a. PaymentsClient (composes tabs + dialog)
  4b. page.tsx (wraps PaymentsClient)

Level 5 — Nav unlock (do last, after page is functional)
  5a. Remove disabled: true from Payments in sidebar.tsx
```

---

## Database Index Recommendation

The `payments` table currently has no explicit index beyond the primary key. The global list query orders by `payment_date DESC`. Add this migration before shipping:

```sql
-- drizzle/0005_payments-list-index.sql
CREATE INDEX IF NOT EXISTS idx_payments_date_desc
  ON payments (payment_date DESC)
  WHERE deleted_at IS NULL;
```

This is a partial index (excludes soft-deleted rows) and directly matches the query shape in `listPayments`. Without it, the global list query will do a full table scan as the payments table grows.

---

## Scalability Considerations

| Concern | Current scale | If scale grows |
|---------|--------------|----------------|
| Global list query | ~thousands of payments | Server-side pagination covers this; index on payment_date DESC covers ordering cost |
| Daily collections query | ~10-50 payments/day | Full day fetch is fine; date-bounded query is fast |
| Loan selector in QuickRecordDialog | ~100s of active loans | In-memory filter over existing loans cache; acceptable. If >500 loans, add server-side search to loan selector |
| Cache invalidation on record | Affects "payments" and "dailyCollections" keys | `queryClient.invalidateQueries` with specific keys — no broadcast invalidation needed |

---

## Sources

- Direct reading: `src/services/payment.service.ts` (493 lines, v1.0)
- Direct reading: `src/actions/payment.actions.ts` (203 lines, v1.0)
- Direct reading: `src/lib/db/schema/payments.ts`
- Direct reading: `src/lib/db/schema/loans.ts`
- Direct reading: `src/lib/db/schema/customers.ts`
- Direct reading: `src/components/layout/sidebar.tsx` (Payments nav slot confirmed at line 54)
- Direct reading: `src/hooks/use-customers.ts` (hook pattern reference)
- Direct reading: `src/app/(app)/customers/page.tsx` (page pattern reference)
- Direct reading: `src/app/(app)/loans/page.tsx` (TanStack Query page pattern reference)
- Direct reading: `src/types/index.ts` (existing type patterns)
- Direct reading: `.planning/PROJECT.md` (v1.1 feature requirements)
- Confidence: HIGH for all integration points — all based on current codebase, not training data assumptions
