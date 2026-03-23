# Project Research Summary

**Project:** Money Lending Management System — v1.1 Payments Milestone
**Domain:** Payments page extension — global list, daily collections, quick-record workflow
**Researched:** 2026-03-23
**Confidence:** HIGH

## Executive Summary

The v1.1 Payments milestone adds a first-class Payments section to an already-shipped perpetual lending system. The core task is extending existing infrastructure — not building new primitives. Research confirms that zero new npm packages are required: Drizzle ORM, TanStack Query, date-fns, shadcn/ui base-ui components, Effect.js, BigNumber.js, and the Server Action pattern already in the codebase cover every feature need. The recommended approach is to build three additive layers — a global paginated payments list, a daily collections view as a second tab within the same route, and an inline quick-record dialog — following the exact patterns established in v1.0 for customers, loans, and transactions.

The recommended architecture groups all three features under a single `/payments` route with tab-based sub-views (URL search params for deep-linking), server-side paginated service functions using JOIN queries, and a reuse-first stance on existing service functions (particularly `recordPaymentAction`, which needs zero changes to support quick-record). The sidebar already has a Payments nav slot at `href: "/payments"` marked `disabled: true` — removing that flag is the final integration step, not the first.

The critical risks are operational in nature: soft-deleted payments being silently included in financial totals (two intentionally different soft-delete patterns coexist in `payment.service.ts`), date-grouping bugs caused by UTC midnight storage vs. Uganda-local calendar day, and a too-narrow `revalidatePath` scope after quick-record that leaves the payments list stale. All three are preventable through patterns already in the codebase. The highest-complexity new piece is the "due today" query for daily collections — identifying active loans whose last payment was 30+ days ago requires a MAX(paymentDate) aggregation per loan that has no existing analogue in v1.0.

---

## Key Findings

### Recommended Stack

No new dependencies required. The entire feature set is served by the current installed stack. Three decisions from STACK.md are worth preserving explicitly: (1) no `cmdk` — the existing `<Popover>` + `<Input>` builds the loan search combobox without introducing Radix peer-dependency conflicts; (2) no `nuqs` or URL state libraries — `useSearchParams` + `router.replace` is sufficient for tab and date state; (3) no `@tanstack/react-table` — the existing `<Table>` + offset pagination pattern is adequate at current data volumes.

**Core technologies (existing, confirmed for this feature):**
- **Drizzle ORM** (`gte`, `lte`, `ilike`, `count`, `sql`, multi-table JOIN) — all operators already imported in `transaction.service.ts` and `customer.service.ts`; no new operators needed
- **TanStack Query** (`useQuery`, `queryClient.invalidateQueries`, shared key factory) — hook pattern mirrors `use-customers.ts` verbatim
- **Effect.js** (`Effect.tryPromise`, `DatabaseError`) — all new service functions wrap in this pattern; mixing plain async outside Effect breaks error propagation
- **BigNumber.js** — mandatory for daily collections totals; native float summation on monetary fields is explicitly prohibited by project convention
- **date-fns v4** (`startOfDay`, `endOfDay`, `format`, `addDays`) — already installed; no second date library permitted
- **shadcn/ui base-ui** (`<Popover>`, `<Input>`, `<Table>`, `<Dialog>`, `<Tabs>`, `<Card>`) — all components installed; loan combobox built from these primitives, not `cmdk`
- **Server Actions** — all data mutations and queries go through Server Actions in `payment.actions.ts`; no Route Handlers

### Expected Features

**Must have (table stakes):**
- Global paginated payments list with customer name search, date range filter, loan status filter — payments are currently only visible inside individual loan pages; a global view is required for audits, disputes, and end-of-day reconciliation
- Columns: date, customer name, loan ID, "Total Received" (not "Amount"), interest portion, principal portion, balance after — label matters: staff read "amount" as principal repaid
- Navigate-to-loan link from every payment row
- Soft-deleted payment visibility toggle (admin only) — soft-deletes exist in the schema; admins need an audit path without affecting financial totals
- Daily collections summary: total collected today (UGX), count of payments recorded, list of payments for the selected date
- "Due today" list: active loans with no payment in last 30 days — the perpetual 30-day cycle model means 30+ days without a payment is the overdue signal
- Quick-record workflow: search for a loan by customer name inline, record payment in a modal, stay on `/payments` after success (not bounced to loan detail)
- Receipt link in quick-record success state — the existing per-loan flow exposes the receipt via loan-detail redirect; quick-record bypasses this and must provide an explicit link

**Should have (differentiators):**
- Collections progress bar: today's collected / expected (low complexity once "due today" count is reliable)
- "Days since last payment" column in due-today list — makes urgency legible at a glance without mental arithmetic
- Default date filter to today — the page primarily answers "what happened today?" so defaulting to today removes the most common filter interaction
- Shared TanStack Query key factory (`paymentsKeys`) — prevents cache invalidation fragmentation as more payment queries are added

**Defer from v1.1:**
- Daily collections PDF export — `pdf.service.ts` pattern exists for when the need is validated with the client; not blocking launch
- Live balance preview in quick-record — the repayment simulator already covers this; not needed inline
- Bulk payment recording — explicitly excluded: interest-first allocation is sequential; bulk entry creates ordering ambiguity and audit complexity

### Architecture Approach

The entire payments section lives at `src/app/(app)/payments/` as a single route with a Server Component shell (`page.tsx`) wrapping a Client Component (`PaymentsClient.tsx`). Within that, two tab components (`PaymentListTab`, `DailyCollectionsTab`) and one dialog (`QuickRecordDialog`) compose the full experience. Tab state and selected date live in URL search params for deep-linking and browser history. All data access follows the thin-action / Effect-service pattern established in v1.0: Server Actions in `payment.actions.ts` call service functions in `payment.service.ts` wrapped in `Effect.tryPromise`. A new Drizzle migration adds a partial index on `payment_date DESC WHERE deleted_at IS NULL` before shipping the global list — without it, the query will do a full table scan as the portfolio grows.

**Major components:**
1. `PaymentsClient.tsx` — tab state, URL param sync (`?tab=all|daily&date=YYYY-MM-DD`), composes all sub-components; no data fetching
2. `PaymentListTab.tsx` — global paginated payment table, filter bar (date range, customer name, loan status), quick-record trigger; consumes `use-payments` hook
3. `DailyCollectionsTab.tsx` — date picker, daily summary stats (total collected, count due today, progress bar), due-today list; consumes `use-daily-collections` hook
4. `QuickRecordDialog.tsx` — inline modal: debounced loan search (active loans only, min 2 chars, limit 10) → payment form → success state with receipt link; reuses `recordPaymentAction` with zero changes
5. `use-payments.ts` / `use-daily-collections.ts` — TanStack Query wrappers using a shared `paymentsKeys` factory; defined before any payment query is written
6. New service functions in `payment.service.ts` (additive): `listPayments(filters)`, `getDailyCollections(date)` — zero changes to existing functions

**Build order (dependency-driven):**
- Level 1: Types (`PaymentWithContext`, `PaymentListFilters`, `DailyCollectionsSummary`) → service functions → Server Actions
- Level 2: TanStack Query hooks (parallel)
- Level 3: UI components (parallel)
- Level 4: Route assembly
- Level 5: Sidebar `disabled: true` removal (last — do not unlock before the page is functional)

### Critical Pitfalls

1. **Soft-delete blindness in global query** — `getPaymentsForLoan` intentionally includes soft-deleted rows (per-loan history view needs them with strikethrough). Copying this function for the global list silently inflates financial totals. New `listPayments` and `getDailyCollections` must always apply `isNull(payments.deletedAt)`. Mark `getPaymentsForLoan` with a comment noting it intentionally includes deleted rows so the contrast is explicit.

2. **UTC vs. Uganda calendar day in date grouping** — `paymentDate` is stored at UTC midnight (`"T00:00:00.000Z"` in `record-payment-form.tsx` line 53). A payment recorded as "2026-03-23" in Kampala (UTC+3) is stored as `2026-03-22T21:00:00+00`. Bare `DATE(payment_date)` returns the wrong day. All date-grouping and daily-filter queries must use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')`.

3. **revalidatePath too narrow after quick-record** — The existing `recordPaymentAction` only revalidates `/loans/${loanId}`. After quick-record fires from `/payments`, the global list does not refresh. Extend `recordPaymentAction` to also revalidate `/payments`. Additionally, invalidate `paymentsKeys.all()` in TanStack Query's `onSuccess` callback for the client-side cache.

4. **No loan-active guard in quick-record** — Quick-record must filter the loan search to `status = 'active'` only (UX layer) AND add a server-side guard in `recordPaymentAction` rejecting payments against `fully_paid` loans (enforcement layer). The current service checks only `LoanNotFound`; a status check is needed. Without this, a payment recorded on a closed loan leaves the loan in an inconsistent state.

5. **N+1 queries for customer/loan name enrichment** — The global list needs customer name and loan context per payment. The naïve approach fetches bare payments then queries per-row. With 200 payments this is 401+ queries. The `listPayments` service function must use a single JOIN from the start: `payments INNER JOIN loans INNER JOIN customers`. The dashboard service already demonstrates the N+1 anti-pattern — do not repeat it.

---

## Implications for Roadmap

Research strongly suggests a 3-phase build ordered by dependency chain. Each phase is independently testable and delivers a usable increment.

### Phase 1: Global Payments List (Foundation)

**Rationale:** Everything else depends on the list query and pagination infrastructure. The daily collections view is a filtered projection of the same data. Quick-record needs the payments list to immediately reflect new records. Build the data layer first and the list UI on top of it before adding more views.

**Delivers:** Fully functional `/payments` page — paginated (25/page), searchable (customer name ILIKE), filterable (date range, loan status), read-only payment history across all loans with navigate-to-loan links. Replaces the placeholder that will appear when the nav is unlocked.

**Addresses (FEATURES.md):**
- Global paginated payments list with all filters
- Columns: "Total Received," interest/principal split, balance after, navigate-to-loan link
- Admin-only soft-deleted payment toggle
- Default date filter to today (URL search param `?date=today`)
- Empty state with call to action

**Avoids (PITFALLS.md):**
- Pitfall 1 (soft-delete blindness): `isNull(deletedAt)` in every new query from day one
- Pitfall 6 (N+1 enrichment): single JOIN query written as the first service function
- Pitfall 11 (date range off-by-one): end-of-day upper bound (`23:59:59.999Z`) in date filter
- Pitfall 12 (ambiguous "Amount" label): column labeled "Total Received" with interest/principal split
- Pitfall 13 (no pagination): server-side LIMIT/OFFSET baked into initial Server Action signature

**New artifacts:** `PaymentWithContext` type, `PaymentListFilters` type, `listPayments` service, `listPaymentsAction`, `use-payments` hook, `PaymentListTab`, `PaymentsClient`, `page.tsx`, Drizzle migration `0005_payments-list-index.sql` (partial index on `payment_date DESC WHERE deleted_at IS NULL`).

### Phase 2: Daily Collections View

**Rationale:** Builds on Phase 1 infrastructure (same route, same `PaymentsClient` shell, same TanStack Query cache). The "due today" query is the highest-complexity new piece and should be built after the list is stable so date-grouping behavior can be verified in a working context before being used for financial summary figures.

**Delivers:** Date-navigable daily collections view — total UGX collected for the selected day, count of payments, "due today" list of active loans 30+ days past their last payment, optional progress bar. Answers the loan officer's morning question: "who do I need to collect from today?"

**Addresses (FEATURES.md):**
- Collections summary header (total collected UGX, payment count)
- "Due today" list with days-since-last-payment column
- Collections progress bar (total collected vs. due-today count)
- Date picker navigation defaulting to today

**Avoids (PITFALLS.md):**
- Pitfall 2 (UTC vs. local calendar day): `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` in all grouping queries — never bare `DATE(payment_date)`
- Pitfall 7 (query key fragmentation): shared `paymentsKeys` factory defined in Phase 1 before any Phase 2 hooks are written
- Pitfall 9 (native float summation): daily totals use BigNumber.js or SQL `SUM(amount)` — no `parseFloat` on monetary fields

**New artifacts:** `DailyCollectionsSummary` type, `getDailyCollections` service, `getDailyCollectionsAction`, `use-daily-collections` hook, `DailyCollectionsTab`.

### Phase 3: Quick-Record Workflow

**Rationale:** Highest operational value for loan officers but depends on the payments list (Phase 1) being in place so post-record cache invalidation has something meaningful to refresh. Built last because it is the most UX-complex piece and benefits from established patterns and tested components from Phases 1-2.

**Delivers:** Inline payment recording from the Payments section — find a loan by typing a customer name (debounced, active loans only, limit 10), fill amount + date in a modal, see a success toast with a receipt link. No page navigation required. The loan officer can record 10 payments without leaving `/payments`.

**Addresses (FEATURES.md):**
- Loan selector combobox (debounced server-side search, `status = 'active'` only, min 2 chars)
- Inline payment form reusing `recordPaymentAction` unchanged
- Post-record redirect stays on `/payments` (not loan detail)
- Explicit receipt link in success state (`/receipts/repayment/${data.id}`)

**Avoids (PITFALLS.md):**
- Pitfall 3 (revalidatePath too narrow): extend `recordPaymentAction` to also revalidate `/payments`; invalidate `paymentsKeys.all()` in TanStack Query `onSuccess`
- Pitfall 4 (no loan-active guard): active-only filter in combobox + server-side `fully_paid` rejection in the action
- Pitfall 5 (double submission): `disabled={isPending}` on submit button + all form inputs; `useTransition` as pending mechanism — copied verbatim from `RecordPaymentForm`
- Pitfall 8 (loan search loads all on mount): debounced, min 2 characters, limit 10, empty state shows a "Type to search" prompt — never load all loans on open
- Pitfall 10 (receipt wrong ID): receipt link uses `data.id` (payment UUID), not `data.loanId`

**New artifacts:** `QuickRecordDialog`, `LoanSearchCombobox` primitive, `searchActiveLoansAction` (debounced loan search), sidebar `disabled: true` removal (one-line change, do last).

### Phase Ordering Rationale

- **Types before everything** — `PaymentWithContext`, `PaymentListFilters`, `DailyCollectionsSummary` must be defined before service functions, which must exist before actions, hooks, and UI. This chain is strict within each phase.
- **Phase 1 before Phase 2** — The daily collections tab lives inside `PaymentsClient.tsx` which is created in Phase 1. Phase 2 adds `DailyCollectionsTab` as a second tab into an existing shell.
- **Phase 1 before Phase 3** — Quick-record invalidates `paymentsKeys.all()` after success. The payments list must be functional before that invalidation matters.
- **Sidebar unlock last** — Remove `disabled: true` from the Payments nav item only after all three phases pass testing. Unlocking early exposes an incomplete page to staff.
- **Database index in Phase 1** — The partial index on `payment_date DESC` must exist before the global list goes live; adding it after data accumulates requires an `CONCURRENTLY` migration.

### Research Flags

Phases with well-documented patterns (skip additional research):
- **Phase 1 (Global Payments List):** All patterns directly implemented in the existing codebase. `searchCustomers`, `listTransactions`, `use-customers`, and `customers/page.tsx` are verbatim templates. No research needed.
- **Phase 3 (Quick-Record):** `recordPaymentAction` already works end-to-end. `LoanSearchCombobox` built from installed `<Popover>` + `<Input>` — the absence of `cmdk`/Radix is confirmed in `package.json`. No research needed.

Phases that may benefit from verification during planning:
- **Phase 2 — "Due today" aggregation query:** The active-loans / last-payment-30-days-ago query requires a MAX(paymentDate) per loan via subquery or lateral join. The query intent is clear from research; the exact Drizzle ORM syntax should be prototyped against PGlite before being committed to the service layer. Low risk of blocking; moderate risk of a subtly wrong query that silently under- or over-counts due-today entries.
- **Phase 2 — Timezone cast in test environment:** Integration tests run on PGlite configured with UTC. The `AT TIME ZONE 'Africa/Kampala'` cast must be verified to produce the expected result in that environment, or test assertions must pin the date cast to UTC. Flag this when writing Phase 2 integration tests.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All patterns directly inspected in the installed codebase; zero new dependencies confirmed by `package.json` audit; no training-data assumptions |
| Features | HIGH | Table stakes derived from existing codebase + v1.1 requirements doc (PROJECT.md); differentiators from microfinance UX domain patterns with MEDIUM confidence |
| Architecture | HIGH | All component shapes, data flows, and integration points traced to existing v1.0 files; build order derived from direct dependency analysis of the codebase |
| Pitfalls | HIGH | All critical pitfalls grounded in specific lines of v1.0 code: UTC midnight in `record-payment-form.tsx` line 53, two soft-delete patterns in `payment.service.ts`, existing `revalidatePath` scope in `payment.actions.ts` |

**Overall confidence:** HIGH

### Gaps to Address

- **"Due today" query syntax:** Research identified what the query must do (active loans, MAX(paymentDate) per loan, 30+ days since last payment OR no payments at all). The exact Drizzle ORM syntax — correlated subquery vs. lateral join vs. subquery in FROM — should be prototyped in isolation during Phase 2 planning. All three approaches are valid SQL; one may be cleaner in Drizzle's builder API.
- **Timezone cast in PGlite test environment:** The integration test suite uses PGlite configured with UTC. The `AT TIME ZONE 'Africa/Kampala'` cast behavior in that environment must be verified during Phase 2 implementation. If it behaves unexpectedly, tests may need to use UTC-equivalent assertions or the app config may need to read timezone from an env variable.
- **Collections progress bar denominator reliability:** The progress bar (collected today / expected today) depends on the "due today" count being accurate. If the due-today aggregation proves complex, defer the progress bar to a follow-on task within Phase 2 rather than blocking the daily collections summary.

---

## Sources

### Primary (HIGH confidence)
- `src/services/payment.service.ts` — two intentional soft-delete patterns, existing service function signatures
- `src/services/customer.service.ts` — ilike + pagination reference implementation
- `src/services/transaction.service.ts` — gte/lte/count/sql aggregation reference implementation
- `src/services/dashboard.service.ts` — N+1 anti-pattern example to avoid
- `src/actions/payment.actions.ts` — existing action pattern, `revalidatePath` scope (current)
- `src/hooks/use-customers.ts` — TanStack Query hook template
- `src/app/(app)/customers/page.tsx` — pagination + search page pattern
- `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` — UTC midnight date construction (`"T00:00:00.000Z"` at line 53), `disabled={isPending}` pattern
- `src/components/layout/sidebar.tsx` — Payments nav slot confirmed `disabled: true` at line 54
- `src/lib/db/schema/payments.ts` — NUMERIC(15,2) monetary columns, `deletedAt` soft-delete field
- `src/lib/db/schema/loans.ts` — `loanStatusEnum("active" | "fully_paid")`
- `package.json` — installed versions, absence of `cmdk` and Radix confirmed
- `.planning/PROJECT.md` — v1.1 feature requirements

### Secondary (MEDIUM confidence)
- Microfinance domain patterns (Odoo Microfinance LMS, LoanBook field app descriptions) — daily collections workflow, due-today targeting, loan officer daily triage patterns
- TanStack Query v5 invalidations from mutations docs — prefix-matching invalidation behavior confirmed
- Drizzle ORM joins documentation — multi-table join patterns
- Next.js GitHub Discussion #37877 — timezone handling in date grouping

### Tertiary (LOW confidence)
- Collections PDF export as a differentiator — inferred from existing `pdf.service.ts` patterns; not validated with client

---
*Research completed: 2026-03-23*
*Ready for roadmap: yes*
