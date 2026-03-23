# Technology Stack

**Project:** Money Lending Management System — v1.1 Payments Milestone
**Researched:** 2026-03-23
**Scope:** NEW capabilities only. Existing validated stack (Next.js 16, React 19, Better Auth, Drizzle ORM, PostgreSQL, Effect.js, BigNumber.js, TanStack Query, Tailwind CSS, shadcn/ui base-ui, Server Actions, date-fns, sonner, lucide-react, react-day-picker, ExcelJS, jspdf) is NOT re-examined.

---

## Executive Decision

**No new dependencies are required for the v1.1 Payments milestone.**

Everything needed to build a global payments list with search/filter/pagination, a daily collections view, and a quick-record workflow already exists in the installed stack. The research below documents exactly which existing tools handle each feature and what new patterns are needed.

---

## Feature-to-Stack Mapping

### Feature 1: Global Payments List with Search, Filter, Pagination

**Data layer:** Drizzle ORM (`gte`, `lte`, `ilike`, `and`, `count` — already used in `transaction.service.ts`) handles paginated, filterable queries against the `payments` table joined to `loans` and `customers`.

**New service method needed:** `listPayments(filters, page)` in `payment.service.ts` — follows the exact pattern of `searchCustomers()` and `listTransactions()` already in the codebase.

**Filter dimensions required:**
- Date range: `gte(payments.paymentDate, from)` + `lte(payments.paymentDate, to)` — Drizzle operators already imported in `transaction.service.ts`
- Customer name: `ilike(customers.fullName, ...)` — already used in `customer.service.ts`
- Amount range: `gte(payments.amount, min)` + `lte(payments.amount, max)` — same operators
- Loan ID: `eq(payments.loanId, id)` — trivial

**Pagination:** Offset/limit pattern already established in `searchCustomers()` — copy the same structure.

**Client data fetching:** TanStack Query with a `usePayments(filters, page)` hook — mirrors the existing `use-customers.ts` hook exactly.

**UI — search bar:** Debounced text input + Select dropdowns + date range inputs — mirrors `CustomerSearchBar`. No new component library needed. The existing `<Input>`, `<Select>`, `<Calendar>`, and `<Popover>` components cover all filter controls.

**UI — results table:** `<Table>` from shadcn/ui — already used on loans and customers pages.

**UI — pagination:** Prev/Next button pattern from `customers/page.tsx` — copy directly.

**Confidence:** HIGH — all patterns are implemented verbatim in the codebase.

---

### Feature 2: Daily Collections View

**Data layer:** A `getDailyCollections(date)` service function aggregates payments for a given calendar day. Uses `gte` + `lte` on `payment_date` to bracket the day (00:00:00 to 23:59:59), plus `sum()` via `sql\`sum(...)\`` — Drizzle's `sql` template is already imported in `transaction.service.ts`.

**Date navigation:** `date-fns` v4 (`addDays`, `subDays`, `startOfDay`, `endOfDay`, `format`) — already installed and used in `utils.ts`. No new package needed.

**UI — date picker for navigation:** The existing `<Calendar>` + `<Popover>` combination from `src/components/ui/` handles date selection. This is already the shadcn date-picker pattern.

**UI — summary card:** `<Card>` already installed.

**Confidence:** HIGH — date-fns and the sql aggregation operators are already in the project.

---

### Feature 3: Quick-Record Payment (Select Loan Inline)

This is the only feature requiring a new UI pattern. The existing record-payment form lives at `/loans/[loanId]/payments/new` and requires the user to already know the loan ID. A "quick-record" workflow needs an inline loan search/selection before recording the payment.

**The problem:** The codebase has no combobox or command palette component. The Select component from `@base-ui/react` does not handle async search within the dropdown.

**Solution: Build a loan search input using existing primitives.**

The `<Popover>` (base-ui, already installed) + `<Input>` + a TanStack Query loan search action is the correct approach. The pattern:

1. User types customer name or loan reference into a text input
2. Input triggers a debounced Server Action call (`searchLoansAction`) that returns matching active loans
3. Results render in a `<PopoverContent>` as a list of clickable items
4. Selecting a loan populates the hidden `loanId` field and shows the selected loan's display name

This is a lightweight implementation of the combobox pattern using tools already installed — no `cmdk` or headless-ui Command component is needed.

**Why not add `cmdk`:** The `cmdk` package (used by shadcn's Command component) is a Radix-era dependency. This project uses base-ui primitives. Adding cmdk would introduce a Radix peer-dependency conflict given the project's explicit base-ui choice. The manual Popover + Input pattern is 30-40 lines of code with no new dependencies.

**Server Action for loan search:** A new `searchActiveLoansAction(query: string)` action — thin wrapper over a Drizzle query joining `loans` to `customers`, filtering by `ilike` on customer name and `eq(loans.status, 'active')`. Returns `{ id, customerName, principalAmount }` — lightweight.

**Quick-record dialog:** The existing `<Dialog>` component contains the form. The form itself is the current `RecordPaymentForm` minus the navigation, with loan selection prepended. Uses `useTransition` + Server Action — the established mutation pattern.

**Confidence:** HIGH for the pattern; HIGH that no new packages are needed.

---

## What NOT to Add

| Package | Reason to skip |
|---------|----------------|
| `cmdk` | Radix dependency conflicts with base-ui; manual popover is sufficient |
| `@tanstack/react-table` | Existing `<Table>` + client-side sort is enough at current data volumes; introduce only if performance issues emerge |
| `react-hook-form` | Project deliberately avoids it per existing pattern (useTransition + manual validation) |
| `zod` in Server Actions | Explicitly excluded per project memory: "No Zod in Server Actions" |
| `nuqs` / URL state libraries | Payments list filter state in React `useState` is adequate; URL sync adds complexity without clear benefit for internal staff tool |
| Any date library other than date-fns | Already installed at v4; do not add luxon, dayjs, or moment |

---

## New Service Methods Required (no new libraries)

| Method | File | Pattern Mirrors |
|--------|------|----------------|
| `listPayments(filters, page)` | `payment.service.ts` | `searchCustomers()` in `customer.service.ts` |
| `getDailyCollections(date)` | `payment.service.ts` | `listTransactions()` in `transaction.service.ts` |
| `searchActiveLoans(query)` | `loan.service.ts` | `searchCustomers()` — ilike on customer name, filter active |

---

## New Actions Required (no new libraries)

| Action | File | Notes |
|--------|------|-------|
| `listPaymentsAction(filters, page)` | `payment.actions.ts` | Extend existing file |
| `getDailyCollectionsAction(date)` | `payment.actions.ts` | Extend existing file |
| `searchActiveLoansAction(query)` | `loan.actions.ts` | Used by quick-record loan picker |

---

## New UI Components Required (built from existing primitives)

| Component | Built From | Purpose |
|-----------|-----------|---------|
| `PaymentSearchBar` | `<Input>`, `<Select>`, `<Calendar>`, `<Popover>`, `<Button>` | Filter bar for payments list |
| `LoanSearchCombobox` | `<Popover>`, `<Input>`, TanStack Query | Inline loan picker for quick-record |
| `QuickRecordPaymentDialog` | `<Dialog>`, `LoanSearchCombobox`, existing form fields | Quick-record without navigation |

---

## Drizzle Operators Needed

All are already imported in the codebase. Needed additions to `payment.service.ts`:

```typescript
import { eq, and, gte, lte, ilike, isNull, asc, desc, count, sql } from "drizzle-orm"
// gte, lte, ilike, count, sql — already used in transaction.service.ts
// eq, and, isNull, asc — already used in payment.service.ts
```

A join from `payments` to `loans` to `customers`:

```typescript
db.select({
  payment: payments,
  loanId: loans.id,
  customerName: customers.fullName,
})
.from(payments)
.innerJoin(loans, eq(payments.loanId, loans.id))
.innerJoin(customers, eq(loans.customerId, customers.id))
.where(and(...conditions))
.orderBy(desc(payments.paymentDate))
.limit(pageSize)
.offset(page * pageSize)
```

Drizzle supports multi-table joins — this is standard usage, no new operators.

---

## Type Additions Required

New TypeScript types in `src/types/index.ts`:

```typescript
// Payment with joined customer + loan context
export type PaymentWithContext = Payment & {
  customerName: string
  loanId: string
}

// Filter params for payment list
export interface PaymentListFilters {
  customerName?: string
  dateFrom?: string   // ISO date string
  dateTo?: string     // ISO date string
  loanId?: string
  page?: number
  pageSize?: number
}

// Daily collections aggregate
export interface DailyCollectionsSummary {
  date: string
  totalCollected: string       // NUMERIC string
  paymentCount: number
  payments: PaymentWithContext[]
}
```

---

## revalidatePath Coverage

The existing `recordPaymentAction` revalidates `/loans/[loanId]`. The new quick-record action must additionally revalidate:

- `/payments` — the new global list page
- `/payments/daily` — the new daily view

This requires no new library, just additional `revalidatePath()` calls in the Server Action.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| No new libraries needed | HIGH | Direct code inspection of installed packages confirms all primitives exist |
| Drizzle join + filter pattern | HIGH | `transaction.service.ts` already uses gte/lte/count/sql; `customer.service.ts` uses ilike + pagination |
| TanStack Query hook pattern | HIGH | `use-customers.ts` is a verbatim template |
| LoanSearchCombobox from Popover | HIGH | `<Popover>` and `<Input>` are installed; manual implementation avoids cmdk/Radix conflict |
| Daily collections aggregation | HIGH | `sql\`sum(...)\`` pattern confirmed present in codebase |
| base-ui combobox (no cmdk) | HIGH | Confirmed: no cmdk in package.json, no Radix imports in project |

---

## Sources

- `/Users/faridmatovu/projects/money-lending/package.json` — installed versions (direct inspection)
- `/Users/faridmatovu/projects/money-lending/src/services/transaction.service.ts` — gte/lte/sql aggregation pattern
- `/Users/faridmatovu/projects/money-lending/src/services/customer.service.ts` — ilike + pagination pattern
- `/Users/faridmatovu/projects/money-lending/src/services/payment.service.ts` — existing payment service patterns
- `/Users/faridmatovu/projects/money-lending/src/hooks/use-customers.ts` — TanStack Query hook pattern
- `/Users/faridmatovu/projects/money-lending/src/components/ui/popover.tsx` — base-ui Popover confirmed installed
- `/Users/faridmatovu/projects/money-lending/src/components/ui/calendar.tsx` — react-day-picker Calendar confirmed installed
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/customers/page.tsx` — pagination + search pattern
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` — existing payment form pattern
- `/Users/faridmatovu/projects/money-lending/src/actions/payment.actions.ts` — existing action + revalidatePath pattern
- Project memory: "No Zod in Server Actions", "Use Server Actions instead of Route Handlers", base-ui not Radix
