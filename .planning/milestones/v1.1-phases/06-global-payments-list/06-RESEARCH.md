# Phase 6: Global Payments List - Research

**Researched:** 2026-03-23
**Domain:** Paginated payments list with server-side filtering, JOIN query, CSV export, edit/delete with role guard
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- CSV export is client-side — convert already-fetched data to CSV in the browser, trigger download. No extra server call needed since page size is 25 rows and data is already in memory.
- Filename format: `payments-YYYY-MM-DD.csv` (date-stamped)
- Columns match the table view: date, customer name, loan reference, amount, interest portion, principal portion, balance after
- Export respects current filters — exports only what the user currently sees (filtered rows)

### Claude's Discretion
- Table columns and column ordering (guided by PAY-02: customer name, loan reference, amount, date, allocation breakdown)
- Filter bar layout and arrangement (date range, amount range, customer search)
- Edit/delete UX pattern — likely dropdown menu per row following existing patterns in ExpenseListClient/IncomeListClient (Sheet for edit, Dialog for delete with reason prompt)
- Pagination controls style
- Empty state when no payments match filters
- Loading skeleton design

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PAY-01 | User can view a paginated list of all payments across all loans | `listPayments` service with `LIMIT`/`OFFSET`, `page`/`pageSize` URL params (TransactionLogClient pattern) |
| PAY-02 | User can see customer name, loan reference, amount, date, and allocation breakdown for each payment | JOIN: `payments` + `loans` + `customers`; new `PaymentWithCustomer` type |
| PAY-03 | User can filter payments by date range | `gte`/`lte` on `payment_date`; URL search params + 300ms debounce (TransactionLogClient pattern) |
| PAY-04 | User can filter payments by amount range | `gte`/`lte` on `amount`; same debounce/URL pattern as date range |
| PAY-05 | User can search payments by customer name | `ilike` on `customers.full_name`; same URL pattern |
| PAY-06 | User can edit a payment directly from the global list (admin+ only) | Reuse `editPaymentAction` + Sheet form; role guard via `ROLE_LEVELS` check (identical to existing editPaymentAction guard) |
| PAY-07 | User can delete a payment directly from the global list (admin+ only) | Reuse `deletePaymentAction` + Dialog with reason prompt; same role guard |
| PAY-08 | User can export the filtered payment list to CSV | Client-side: array-to-CSV string, `Blob`, `URL.createObjectURL`, anchor click — no library needed |
</phase_requirements>

---

## Summary

Phase 6 builds a `/payments` page that is a read-only cross-loan view of all payment records, with inline admin actions. The data layer is the only net-new backend work: a `listPayments` service function with a three-table JOIN (`payments` → `loans` → `customers`) plus filter/pagination parameters. All other backend logic (edit, delete, cascade recalculation) already exists in `payment.service.ts` and `payment.actions.ts` and is reused without modification.

The UI follows the established pattern from `TransactionLogClient.tsx` (URL-based filters + pagination, router.push on filter change, 300ms debounce) combined with the action column pattern from `LoansPage` (DropdownMenu with Edit/Delete items, Sheet for edit form, Dialog with reason textarea for delete). CSV export is a pure client-side operation: the already-fetched current page rows are serialised to a CSV string and downloaded via a temporary anchor element.

The sole Drizzle migration needed is a partial index on `payments(payment_date)` where `deleted_at IS NULL` to keep paginated date-ordered queries fast as the table grows.

**Primary recommendation:** Model `listPayments` after `TransactionLogClient`'s URL-param + server-read pattern; reuse `editPaymentAction` / `deletePaymentAction` unchanged; keep CSV export entirely in the browser with no new dependency.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | (existing) | `listPayments` JOIN query, partial index migration | Already in use; `and()`, `gte()`, `lte()`, `ilike()`, `isNull()` cover all filter needs |
| Effect.js | (existing) | Wrap `listPayments` service function | All services follow `Effect.tryPromise` pattern |
| TanStack Query | (existing) | Client-side data fetching via `useQuery` + `queryKey` invalidation | Loans page and creditor pages use `useQuery`; mutations use `useMutation` |
| Next.js Server Actions | (existing) | `listPaymentsAction`, reuse `editPaymentAction`, `deletePaymentAction` | Project-wide pattern per MEMORY feedback |
| shadcn/ui (base-ui) | (existing) | Table, Sheet, Dialog, DropdownMenu, Input, Button, Badge | All components confirmed present in codebase |
| date-fns | (existing) | Format `YYYY-MM-DD` for CSV filename, display formatting | `formatDate` helper already in `lib/utils.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| BigNumber.js | (existing) | Display monetary strings | All monetary values stored as NUMERIC strings; use for display formatting only |
| useSearchParams / useRouter | (Next.js built-in) | URL-based filter state | Keeps filters bookmarkable and shareable; used by TransactionLogClient today |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| URL-based filter state | React local state only | Local state loses filter on navigation/refresh; URL state is better for a list page |
| Client-side CSV | papaparse or csv-stringify | No new dependency needed for 25-row export; hand-rolling is trivial and justified |
| DropdownMenu per row | Button per action | Dropdown keeps row narrow; consistent with LoansPage admin actions |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   └── payment.service.ts        # Add listPayments() here
├── actions/
│   └── payment.actions.ts        # Add listPaymentsAction() here
├── types/
│   └── index.ts                  # Add PaymentWithCustomer, ListPaymentsInput types
└── app/(app)/payments/
    ├── page.tsx                  # Server component: read URL search params, call service
    └── PaymentsClient.tsx        # "use client" — filter bar, table, pagination, CSV, modals
```

### Pattern 1: listPayments Service Function
**What:** Effect.tryPromise wrapping a Drizzle JOIN query with conditional filter building.
**When to use:** Whenever cross-table data with optional server-side filters is needed.

```typescript
// Mirrors TransactionLogClient's server-read approach
// Source: existing payment.service.ts + TransactionLogClient.tsx patterns
import { and, gte, lte, ilike, isNull, desc, count } from "drizzle-orm"

export interface ListPaymentsInput {
  page?: number          // 1-based, default 1
  pageSize?: number      // default 25
  dateFrom?: string      // ISO date string
  dateTo?: string        // ISO date string
  amountMin?: string     // NUMERIC string
  amountMax?: string     // NUMERIC string
  customerName?: string  // partial match
}

export interface PaymentWithCustomer {
  id: string
  loanId: string
  loanRef: string          // loan.id.slice(-8).toUpperCase()
  customerId: string
  customerName: string
  paymentDate: Date
  amount: string
  interestPortion: string
  principalPortion: string
  principalBalanceAfter: string
  recordedBy: string
  createdAt: Date
}

export const listPayments = (
  input: ListPaymentsInput
): Effect.Effect<{ rows: PaymentWithCustomer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 25
      const offset = (page - 1) * pageSize

      const conditions = [isNull(payments.deletedAt)]   // ALWAYS exclude soft-deleted
      if (input.dateFrom) conditions.push(gte(payments.paymentDate, new Date(input.dateFrom)))
      if (input.dateTo)   conditions.push(lte(payments.paymentDate, new Date(input.dateTo + "T23:59:59.999Z")))
      if (input.amountMin) conditions.push(gte(payments.amount, input.amountMin))
      if (input.amountMax) conditions.push(lte(payments.amount, input.amountMax))
      if (input.customerName) conditions.push(ilike(customers.fullName, `%${input.customerName}%`))

      const where = and(...conditions)

      const [rows, [{ value: total }]] = await Promise.all([
        db
          .select({
            id: payments.id,
            loanId: payments.loanId,
            customerId: loans.customerId,
            customerName: customers.fullName,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
            interestPortion: payments.interestPortion,
            principalPortion: payments.principalPortion,
            principalBalanceAfter: payments.principalBalanceAfter,
            recordedBy: payments.recordedBy,
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

      return { rows, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

**Critical note from STATE.md:** `listPayments` MUST apply `isNull(payments.deletedAt)`. The existing `getPaymentsForLoan` intentionally includes soft-deleted rows — this is a different contract.

### Pattern 2: URL-Based Filter State (from TransactionLogClient)
**What:** Local React state mirrors URL search params. On change, call `router.push()` with updated params after 300ms debounce. Server component re-renders with new `searchParams`.
**When to use:** Any list page with filters that must survive navigation.

```typescript
// Source: src/app/(app)/transactions/TransactionLogClient.tsx
const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

const scheduleApply = useCallback((...newValues) => {
  if (debounceTimer.current) clearTimeout(debounceTimer.current)
  debounceTimer.current = setTimeout(() => applyFilters(...newValues), 300)
}, [applyFilters])

// Reset to page 1 on any filter change:
params.delete("page")
router.push(`/payments?${params.toString()}`)
```

### Pattern 3: Admin-Only Edit/Delete with DropdownMenu
**What:** Each row renders a DropdownMenu (MoreHorizontal trigger) with Edit and Delete items. Edit opens a Sheet; Delete opens a Dialog with required reason textarea.
**When to use:** When row has multiple admin actions and table columns must stay compact.

```typescript
// Source: src/app/(app)/loans/page.tsx — DropdownMenu pattern
// Source: src/app/(app)/customers/[id]/page.tsx — Sheet edit pattern
// Role guard pattern (mirrors editPaymentAction):
const isAdmin = ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin
// Only render DropdownMenu column when isAdmin === true
```

### Pattern 4: Client-Side CSV Export
**What:** Serialize `PaymentWithCustomer[]` rows to a CSV string, create a Blob, fire a temporary anchor click.
**When to use:** Small datasets (25 rows max per page) already in client memory.

```typescript
// No library needed — hand-rolled is 15 lines
function exportToCsv(rows: PaymentWithCustomer[], dateStr: string) {
  const headers = ["Date", "Customer", "Loan Ref", "Amount", "Interest", "Principal", "Balance After"]
  const csvLines = [
    headers.join(","),
    ...rows.map((r) => [
      formatDate(r.paymentDate),
      `"${r.customerName}"`,
      r.loanRef,
      r.amount,
      r.interestPortion,
      r.principalPortion,
      r.principalBalanceAfter,
    ].join(","))
  ]
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `payments-${dateStr}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

### Pattern 5: Server Component + Client Shell
**What:** `page.tsx` is a Server Component that reads `searchParams`, calls `listPaymentsAction`, passes `rows`, `total`, `page`, `pageSize`, and `filters` as props to `<PaymentsClient>`.
**When to use:** Consistent with TransactionLogClient and customers page patterns.

```typescript
// src/app/(app)/payments/page.tsx
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const page = Number(params.page ?? 1)
  const filters: ListPaymentsInput = {
    page,
    pageSize: 25,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    amountMin: params.amountMin,
    amountMax: params.amountMax,
    customerName: params.customerName,
  }
  const result = await listPaymentsAction(filters)
  // ... pass to PaymentsClient
}
```

**AGENTS.md warning:** `searchParams` in the current version of Next.js is a Promise — it must be `await`ed. Do not use it synchronously.

### Anti-Patterns to Avoid
- **`getPaymentsForLoan` for the global list:** That function intentionally includes soft-deleted rows (strikethrough in UI). `listPayments` must always apply `isNull(deletedAt)`.
- **Bare `DATE(payment_date)` in queries:** Must use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` for any date-grouping (STATE.md decision). Applies to dateFrom/dateTo filter comparisons — use timestamptz comparison directly (not cast), which is naturally timezone-safe.
- **Hardcoding loan reference as a DB column:** `loanRef` is derived client-side: `loan.id.slice(-8).toUpperCase()`. No schema change needed.
- **New npm packages for CSV:** Do not install papaparse or csv-stringify. Hand-rolled is sufficient for 25 rows.
- **Revalidating only `/loans/[id]` after edit/delete:** The existing `editPaymentAction` and `deletePaymentAction` revalidate `/loans/${loanId}`. The new `listPaymentsAction` should also `revalidatePath('/payments')` — add to existing actions OR handle invalidation via TanStack Query `invalidateQueries`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payment edit with cascade recalculation | Custom cascade logic | `editPaymentAction` (already exists) | Cascade recalculates all subsequent payments; getting it wrong corrupts balances |
| Payment soft-delete with cascade | Custom delete logic | `deletePaymentAction` (already exists) | Same cascade risk; also handles loan status transition |
| Role-based action visibility | Custom RBAC | `ROLE_LEVELS` comparison from `@/types` | Project-wide established pattern |
| Debounced filter application | Custom debounce util | `useRef` + `setTimeout` (TransactionLogClient pattern) | Already battle-tested in transactions page |

**Key insight:** The hard backend work (cascade recalculation, audit logging, loan status transitions) is fully encapsulated in existing service functions. Phase 6 should not touch any of that logic.

---

## Common Pitfalls

### Pitfall 1: Count Query Mismatch
**What goes wrong:** The `count()` query uses different JOINs or a different WHERE clause than the rows query, causing the pagination total to be wrong.
**Why it happens:** Copy-paste divergence between the two parallel queries.
**How to avoid:** Extract the `where` condition to a variable and use it in both queries. Run both queries in a single `Promise.all()`.
**Warning signs:** Total shows N but actual rows are fewer; page 2 shows empty even though total > pageSize.

### Pitfall 2: Soft-Deleted Rows in listPayments
**What goes wrong:** Deleted payments appear in the global list with a confusing strikethrough.
**Why it happens:** Developer reuses `getPaymentsForLoan` logic which intentionally includes deleted rows, or forgets `isNull(deletedAt)`.
**How to avoid:** The first condition in the `conditions` array must always be `isNull(payments.deletedAt)`. This is a STATE.md locked decision.
**Warning signs:** Rows appear with `deletedAt !== null` in the fetched data.

### Pitfall 3: dateTo Off-by-One
**What goes wrong:** Filtering by dateTo="2026-03-23" excludes payments on that date because `lte(paymentDate, new Date("2026-03-23"))` resolves to midnight, excluding same-day records with a later time component.
**Why it happens:** Payment dates are stored as `timestamptz`, not bare dates.
**How to avoid:** Use `dateTo + "T23:59:59.999Z"` when constructing the Date object for the upper bound.
**Warning signs:** Payments from the last selected day are missing from the filter result.

### Pitfall 4: revalidatePath Missing for /payments
**What goes wrong:** Edit or delete from the payments page succeeds but the list does not update — stale data persists until manual refresh.
**Why it happens:** `editPaymentAction` and `deletePaymentAction` only call `revalidatePath('/loans/${loanId}')`. They do not know about `/payments`.
**How to avoid:** After calling `editPaymentAction` / `deletePaymentAction` in the PaymentsClient, call `queryClient.invalidateQueries({ queryKey: ['payments'] })` via TanStack Query, OR add `revalidatePath('/payments')` to the existing Server Actions.
**Warning signs:** Toast shows "Payment updated" but the row in the list still shows the old amount.

### Pitfall 5: CSV Customer Name with Commas
**What goes wrong:** Customer names like "Mukasa, James" break CSV column alignment.
**Why it happens:** CSV fields with commas must be quoted.
**How to avoid:** Always wrap `customerName` in double quotes in the CSV output. See Pattern 4 example above.
**Warning signs:** CSV opens in Excel with customer name split across two columns.

### Pitfall 6: searchParams Must Be Awaited
**What goes wrong:** TypeScript error or runtime failure when accessing `searchParams.page` directly in the page Server Component.
**Why it happens:** In the current Next.js version (AGENTS.md warning), `searchParams` is a Promise in Server Components.
**How to avoid:** `const params = await searchParams` before reading any property.
**Warning signs:** Build-time TypeScript error "Property 'page' does not exist on type Promise".

---

## Code Examples

### listPaymentsAction Server Action
```typescript
// src/actions/payment.actions.ts — add alongside existing actions
"use server"
export async function listPaymentsAction(input: ListPaymentsInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listPayments(input))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

### PaymentsClient useQuery Signature
```typescript
// Mirrors loans page TanStack Query pattern
const { data, isLoading, isError } = useQuery({
  queryKey: ["payments", page, dateFrom, dateTo, amountMin, amountMax, customerName],
  queryFn: async () => {
    const result = await listPaymentsAction({ page, pageSize: 25, dateFrom, dateTo, amountMin, amountMax, customerName })
    if ("error" in result) throw new Error(result.error)
    return result.data
  },
})
```

**Note:** The payments page uses a hybrid: initial data from the server component (no loading flash), then TanStack Query for mutation invalidation. Alternatively, the TransactionLogClient approach (pure server-component re-render via router.push) avoids TanStack Query for reads entirely. Either works — the planner should choose one and be consistent.

### Drizzle Partial Index Migration
```sql
-- drizzle/XXXX_payments-active-date-idx.sql
CREATE INDEX IF NOT EXISTS idx_payments_active_date
  ON payments (payment_date DESC)
  WHERE deleted_at IS NULL;
```

Drizzle migration file generated via `pnpm db:generate` after adding the index definition to the schema.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| getPaymentsForLoan for all payment views | listPayments (new) with isNull filter for global list | Phase 6 | getPaymentsForLoan contract preserved; new function has different contract |
| Full-page reload on filter | URL search params + router.push + debounce | Phase 5 (TransactionLogClient) | Filters are bookmarkable; no full page re-render for debounced input |
| All list routes server-rendered only | Server component shell + "use client" child | Established pattern | Mutations (edit/delete) need client state; initial load stays fast |

---

## Open Questions

1. **TanStack Query vs pure server re-render for PaymentsClient**
   - What we know: TransactionLogClient uses pure server re-render (router.push → searchParams change → page re-render). LoansPage uses TanStack Query. Both patterns work.
   - What's unclear: Which is preferred for a page that has both filtering (many reads) and mutations (edit/delete)?
   - Recommendation: Use TanStack Query for reads + mutation invalidation (consistent with LoansPage which also has admin delete). The queryKey includes all filter params so cache is properly segmented.

2. **loanRef display format**
   - What we know: Loans page shows `loan.id.slice(-5)` with mono font. Context says "loan reference" — no canonical format defined.
   - What's unclear: Should it be last 5 chars, last 8, or a `LOAN-XXXXX` prefix?
   - Recommendation: Use `LOAN-${loan.id.slice(0, 8).toUpperCase()}` — consistent with how `sendAdminNotification` formats loanRef in `payment.actions.ts`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + Vitest integration (PGlite) + Cypress (E2E) |
| Config file | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm test:integration` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | listPayments returns paginated rows, total count | integration | `pnpm test:integration -- --reporter=verbose -t "listPayments"` | ❌ Wave 0 |
| PAY-02 | Each row includes customerName, loanId, amount, interestPortion, principalPortion, principalBalanceAfter | integration | same suite | ❌ Wave 0 |
| PAY-03 | dateFrom/dateTo filters correctly include/exclude boundary dates | integration | same suite | ❌ Wave 0 |
| PAY-04 | amountMin/amountMax filters correct | integration | same suite | ❌ Wave 0 |
| PAY-05 | customerName ilike search returns matching rows only | integration | same suite | ❌ Wave 0 |
| PAY-06 | Edit payment from global list — admin allowed, loan officer blocked | unit (mock) | `pnpm test -- --reporter=verbose -t "editPayment"` | ✅ existing |
| PAY-07 | Delete payment from global list — admin allowed, loan officer blocked | unit (mock) | `pnpm test -- --reporter=verbose -t "deletePayment"` | ✅ existing |
| PAY-08 | CSV export — filename includes current date, columns match spec | manual | n/a — browser-only DOM API | manual-only |

**PAY-08 manual-only justification:** CSV export calls `URL.createObjectURL` and `document.createElement("a").click()` — these DOM APIs are not available in Vitest node environment. A Cypress E2E test could verify the download, but it requires intercepting the file download which adds significant setup complexity for a 15-line utility. Manual verification is appropriate.

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test && pnpm test:integration`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__integration__/payment.service.test.ts` — extend existing file with `listPayments` suite covering PAY-01 through PAY-05
- [ ] `src/services/__tests__/payment.service.test.ts` — add mock-based unit test for listPayments filter logic (unit-level sanity check)

*(Existing test infrastructure covers PAY-06 and PAY-07 via existing editPayment/deletePayment tests)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/services/payment.service.ts` — existing editPayment, deletePayment, getPaymentsForLoan implementations
- Direct code inspection: `src/app/(app)/transactions/TransactionLogClient.tsx` — URL filter + debounce + pagination pattern
- Direct code inspection: `src/app/(app)/loans/page.tsx` — DropdownMenu + TanStack Query + delete dialog pattern
- Direct code inspection: `src/components/layout/sidebar.tsx` — confirmed Payments nav item with `disabled: true`
- Direct code inspection: `src/lib/db/schema/payments.ts` + `loans.ts` + `customers.ts` — schema confirmed
- Direct code inspection: `src/actions/payment.actions.ts` — confirmed editPaymentAction and deletePaymentAction exist and revalidate `/loans/${loanId}`
- Direct code inspection: `.planning/STATE.md` — listPayments must use isNull(deletedAt); AT TIME ZONE constraint; sidebar disabled: true removal is Phase 8

### Secondary (MEDIUM confidence)
- Drizzle ORM docs pattern: `count()`, `and()`, `gte()`, `lte()`, `ilike()`, `isNull()` — all operators confirmed present in existing codebase imports
- AGENTS.md: searchParams is a Promise in current Next.js version — must await

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire stack confirmed in codebase, no new dependencies
- Architecture: HIGH — patterns copied from verified existing files
- Pitfalls: HIGH — derived from code inspection of existing contracts (especially soft-delete/listPayments contract)
- Test map: HIGH — test framework confirmed, existing test files verified

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable stack, 30-day horizon)
