# Phase 6: Global Payments List - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Paginated, searchable, filterable payments table across all loans at `/payments`. Users can view payment history, filter by date range/amount/customer name, and export to CSV. Admins can edit or delete payments directly from the list. Daily collections and quick-record are separate phases (7 and 8).

</domain>

<decisions>
## Implementation Decisions

### CSV Export
- Export respects current filters — exports only what the user currently sees (filtered rows)
- Columns match the table view: date, customer name, loan reference, amount, interest portion, principal portion, balance after
- Filename format: `payments-YYYY-MM-DD.csv` (date-stamped, simple)
- Generation is client-side — convert already-fetched data to CSV in the browser, trigger download. No extra server call needed since page size is 25 rows and data is already in memory

### Claude's Discretion
- Table columns and column ordering (guided by PAY-02: customer name, loan reference, amount, date, allocation breakdown)
- Filter bar layout and arrangement (date range, amount range, customer search)
- Edit/delete UX pattern — likely dropdown menu per row following existing patterns in ExpenseListClient/IncomeListClient (Sheet for edit, Dialog for delete with reason prompt)
- Pagination controls style
- Empty state when no payments match filters
- Loading skeleton design

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — PAY-01 through PAY-08 define all Phase 6 requirements
- `.planning/ROADMAP.md` §Phase 6 — Success criteria, plan breakdown (06-01 data layer, 06-02 UI)

### Existing patterns
- `src/services/payment.service.ts` — Existing `editPayment`, `deletePayment`, `getPaymentsForLoan` (new `listPayments` JOIN query needed)
- `src/app/(app)/expenses/ExpenseListClient.tsx` — Established list page pattern: Table + Sheet edit + Dialog delete + filter bar
- `src/types/index.ts` — `Payment`, `EditPaymentInput`, `DeletePaymentInput` types already defined

### State decisions
- `.planning/STATE.md` §Accumulated Context — `listPayments` must filter `isNull(deletedAt)`; date grouping must use `AT TIME ZONE 'Africa/Kampala'`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `payment.service.ts`: `editPayment()`, `deletePayment()` with cascade recalculation — reuse directly via Server Actions
- `ExpenseListClient.tsx` / `IncomeListClient.tsx`: Table + Sheet + Dialog + filter pattern — use as template for PaymentsClient
- UI components: Table, Dialog, Sheet, Calendar, Popover, Select, Input, Tabs, Button, Badge
- `formatNumberWithCommas()`, `formatDate()` in `lib/utils.ts`
- `Payment` type inferred from Drizzle schema — extend with customer name via JOIN

### Established Patterns
- TanStack Query for client-side data fetching (expenses/income pages)
- Server Actions wrapping Effect.js service calls
- Soft-delete with `deletedAt` filter (never hard delete)
- BigNumber.js for all monetary values
- `useTransition` for mutation loading states

### Integration Points
- New route: `src/app/(app)/payments/page.tsx` (currently no `/payments` route exists)
- Sidebar navigation: add Payments link (currently disabled per STATE.md — unlock is Phase 8)
- `listPayments` service: new function with JOIN on loans + customers tables
- Server Action: `listPaymentsAction` wrapping the service

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing expense/income list patterns for consistency.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-global-payments-list*
*Context gathered: 2026-03-23*
