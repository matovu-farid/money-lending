# Phase 7: Daily Collections View - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Date-navigable daily summary tab within `/payments` showing total collected, payment count, and per-loan breakdown for any selected day — plus a "due today" list of active loans that haven't received a payment in 30+ days. Quick-record workflow and payment editing are separate phases (8 and 6 respectively).

</domain>

<decisions>
## Implementation Decisions

### Page placement
- Tab inside `/payments` — add a "Daily" tab alongside the existing "All Payments" list
- URL: `/payments?tab=daily` (default tab remains `list`)
- No separate sidebar entry — daily view is accessed from the payments page tabs

### Page layout
- Single scrollable view within the Daily tab: summary cards at top, then collected-today breakdown table, then due-today list below
- Not side-by-side columns — inline stacked sections

### Date navigation
- Left/right arrow buttons for prev/next day navigation
- Calendar popup (date picker) for jumping to any date
- Default to today on initial load

### Empty state
- When selected date has zero collections: show "No collections on this date" text message
- Summary cards display UGX 0 and 0 payments
- Due-today list still renders below (it's date-independent — always shows current overdue loans)

### Claude's Discretion
- Summary card design (number of cards, what stats to show — total collected, payment count, average payment)
- Collections breakdown table columns and sort order
- Due-today list columns (customer name, days since last payment, outstanding balance, loan amount)
- Visual urgency indicators for due-today items (badges, color coding)
- Loading skeleton design
- Tab component implementation (shadcn Tabs or custom)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — COLL-01 through COLL-04 define all Phase 7 requirements
- `.planning/ROADMAP.md` §Phase 7 — Success criteria, plan breakdown (07-01 data layer, 07-02 UI)

### Existing patterns
- `src/services/payment.service.ts` — `listPayments` with JOIN query, `isNull(deletedAt)` filter pattern
- `src/services/watchlist.service.ts` — Days-overdue calculation per active loan, last payment date lookup — reusable for due-today logic
- `src/services/dashboard.service.ts` — Aggregate payment stats (SUM, COUNT) pattern
- `src/app/(app)/payments/PaymentsClient.tsx` — Integration point: add tab switching here
- `src/app/(app)/payments/page.tsx` — Server component that fetches initial data

### State decisions
- `.planning/STATE.md` §Accumulated Context — date grouping must use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')`, never bare `DATE(payment_date)`
- `.planning/STATE.md` §Blockers — "Due today" aggregation query (MAX(paymentDate) per active loan, 30+ days) has no existing Drizzle analogue — prototype syntax against PGlite during planning
- `.planning/STATE.md` §Blockers — `AT TIME ZONE 'Africa/Kampala'` cast behavior in PGlite test environment must be verified

### Prior phase context
- `.planning/phases/06-global-payments-list/06-CONTEXT.md` — Phase 6 decisions on PaymentsClient patterns, CSV export, table conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `watchlist.service.ts`: Iterates active loans, computes days overdue + last payment date — core logic for COLL-04 "due today" list
- `dashboard.service.ts`: `getDashboardKPIs()` aggregates payment sums — pattern for daily collection totals
- `PaymentsClient.tsx`: TanStack Query + Server Actions + Table pattern — extend with tab switching
- UI components: Table, Card, Calendar, Popover, Tabs, Badge, Button
- `formatNumberWithCommas()`, `formatDate()` in `lib/utils.ts`
- `formatUGX()` helper in dashboard page — consider extracting to shared util

### Established Patterns
- TanStack Query for client-side data fetching (payments, expenses, income pages)
- Server Actions wrapping Effect.js service calls
- `isNull(deletedAt)` on all payment queries (soft-delete contract)
- BigNumber.js for monetary aggregation
- `useTransition` for mutation loading states

### Integration Points
- `PaymentsClient.tsx` — add tab state (`list` | `daily`) controlled by URL search param
- New service function: `getDailyCollections(date)` — SUM/COUNT of payments for a given date with timezone-aware grouping
- New service function: `getLoansDueToday()` — active loans where last payment was 30+ days ago (or no payments at all)
- New Server Actions: `getDailyCollectionsAction`, `getLoansDueTodayAction`
- New client component: `DailyCollectionsTab` rendered inside PaymentsClient when tab=daily

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing payments page patterns for consistency.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-daily-collections-view*
*Context gathered: 2026-03-23*
