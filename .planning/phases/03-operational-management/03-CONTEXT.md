# Phase 3: Operational Management - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Executive dashboard, customer search and filtering, borrower watchlist, repayment simulator, balance-to-days converter, and in-app due-date alerts. Staff can monitor the loan portfolio, surface at-risk borrowers, and simulate repayment outcomes without leaving the system.

Requirements: CUST-05, CUST-06, CUST-07, RISK-01, RISK-02, RISK-03, RISK-04, ALRT-01, RPTS-01

</domain>

<decisions>
## Implementation Decisions

### Executive Dashboard (RPTS-01)
- **Layout:** Two rows of 3 KPI summary cards at the top, recent activity feed below
- **KPI cards (6 total):** Loans Outstanding (UGX), Repayments Collected (UGX), Interest Earned (UGX), Active Borrowers (count), Overdue Count (count), Capital in System (UGX)
- **Capital card:** Shown from day one with UGX 0 — creditor data comes in Phase 4 but the card slot is pre-allocated for layout consistency
- **Activity feed:** Last 10 recent events (payments received, loans issued, overdue flags) in chronological order
- **Data source:** All KPIs are SQL-aggregated from the underlying transaction records — no cached/materialized values

### Customer Search & Filtering (CUST-05)
- **Placement:** Enhance the existing customers data table — add search bar + filter dropdowns above the table
- **Search:** By customer name (text search)
- **Filters:** Customer status (Active/Blacklisted/Inactive), loan status, days remaining
- **Pagination:** Server-side pagination on the enhanced table

### Customer Status Management (CUST-06)
- **UX pattern:** Inline dropdown on customer profile page — status badge becomes a dropdown, click to change, confirm with a reason
- **Same pattern as:** Role assignment dropdown in admin panel (Phase 1)
- **Blacklist safeguard:** Blacklisted customers are blocked from new loan issuance. Existing active loans continue normally. Attempt to issue a loan to a Blacklisted customer returns a validation error.
- **Audit:** Status changes logged with reason, acting user, and timestamp

### Customer Loan History (CUST-07)
- **Display:** Loan cards on the customer profile page — each card shows loan amount, date, status, outstanding balance
- **Expandable payments:** Click a loan card to expand and see individual payments with interest/principal split
- **Reuses:** Existing loan detail patterns from Phase 2

### Borrower Watchlist (RISK-01, RISK-02)
- **Location:** Dedicated /watchlist page with its own sidebar nav item
- **Scope:** Shows ONLY flagged borrowers (days_overdue >= 30) — not all active loans
- **Calculation:** Real-time on page load — calculates days overdue for all active loans using the Interest Engine, then filters to flagged. Does NOT depend on the cron job for data freshness.
- **Days overdue display:** Color-coded badge — green (0-14 days), yellow (15-29 days), red (30+ days). Badge appears on watchlist rows, loan cards, and customer profile.
- **Table columns:** Customer name, loan amount, outstanding balance, days overdue (badge), daily rate, last payment date

### Repayment Simulator (RISK-03, RISK-04)
- **Location:** Inline on the existing loan detail page — "Simulate Payment" section
- **Input:** Single field: "Simulate payment of UGX ___"
- **Display:** Side-by-side comparison — current state on left, simulated state on right (before/after view showing days remaining, interest portion, principal portion, new balance)
- **Engine:** Uses the same `calculateInterest`, `calculateDailyRate`, and allocation logic as the real payment system (RISK-04 compliance — single implementation)
- **Balance-to-days converter:** Derived from the simulator — entering an amount shows how many days the borrower would have remaining

### In-App Due-Date Alerts (ALRT-01)
- **Trigger:** Cron job generates alerts 5 days before a loan's due date (30-day cycle boundary)
- **Storage:** Notifications table — stores alert per user (Admin and Loan Officer roles)
- **Display:** Bell icon in the top bar with unread count badge. Click opens a dropdown listing alerts: "Loan #123 for [Customer] — due in X days"
- **Dismissibility:** Alerts are dismissible (mark-as-read) per user. Dismissed alerts stop showing in the dropdown. Other users retain their own copy.
- **Target roles:** Admin and Loan Officer only

### Claude's Discretion
- KPI card styling, spacing, and icon choices
- Activity feed item formatting and event type icons
- Search debounce timing and empty-state messaging
- Watchlist table sort order and column widths
- Simulator input validation and edge-case messaging (e.g., amount exceeds balance)
- Notification dropdown styling and "mark all as read" behavior
- Color-coded badge exact color values within the green/yellow/red scheme

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 3 covers: CUST-05, CUST-06, CUST-07, RISK-01, RISK-02, RISK-03, RISK-04, ALRT-01, RPTS-01

### Phase 1 context (loan model)
- `.planning/phases/01-foundation/01-CONTEXT.md` — Loan Ledger Model section defines: payment allocation logic, daily rate formula, minimum interest rule, days overdue formula (`unpaid_interest / current_daily_rate`), watchlist threshold (>= 30 days), reference implementation table

### Phase 2 context (upstream decisions)
- `.planning/phases/02-loan-operations/02-CONTEXT.md` — Payment edit/delete policy (soft delete, crossed out display), receipt generation patterns, existing cron approach

### Project constraints
- `.planning/PROJECT.md` — Constraints section: BigNumber arithmetic, Effect.js services, NUMERIC(15,2), perpetual loans (no due dates), on-demand interest calculation

### Codebase patterns
- `.planning/codebase/CONVENTIONS.md` — Naming conventions, import order, styling patterns
- `.planning/codebase/STRUCTURE.md` — App Router layout, directory structure, path alias

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/interest/engine.ts` — `calculateDaysOverdue()`, `calculateDailyRate()`, `calculateInterest()`, `calculateLoanSummary()` — all ready for watchlist and simulator
- `src/lib/interest/index.ts` — Barrel export for all interest engine functions
- `src/app/api/cron/overdue/route.ts` — Existing overdue detection cron (detection-only, no DB writes). Extend for ALRT-01 to write notifications.
- `src/lib/db/schema/customers.ts` — `customerStatusEnum` already defines `active`, `blacklisted`, `inactive`
- `src/services/customer.service.ts` — Existing customer service to extend with search/filter/status change
- `src/services/loan.service.ts` — Loan service patterns to follow
- `src/services/payment.service.ts` — Payment service with audit log pattern
- `src/components/layout/sidebar.tsx` — Sidebar navigation to add watchlist link
- `src/app/(app)/dashboard/page.tsx` — Placeholder dashboard page ready to be built out
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` — Loan detail client component to extend with simulator

### Established Patterns
- Server Actions over Route Handlers (user feedback)
- No Zod in Server Actions — TypeScript types + runtime guards
- Effect.js services return `Effect<S, E, never>` with db closed over
- `writeAuditLog` is plain async inside Drizzle tx callbacks
- Server component + client island: page.tsx fetches via Effect.runPromise, passes props to client component

### Integration Points
- Dashboard replaces placeholder at `src/app/(app)/dashboard/page.tsx`
- Customer search/filter enhances existing `src/app/(app)/customers/` pages
- Watchlist is a new route: `src/app/(app)/watchlist/page.tsx`
- Simulator embeds into existing loan detail page
- Bell icon + notification dropdown integrates into the app shell layout (`src/app/(app)/layout.tsx` or top bar component)
- Cron endpoint extended to write to a new `notifications` table

</code_context>

<specifics>
## Specific Ideas

- Side-by-side comparison for the simulator — current state vs simulated state gives the loan officer a clear before/after view when considering a payment
- Days overdue color-coded badges provide instant visual triage across the entire system (watchlist, loan cards, customer profile)
- Watchlist is real-time on page load — never stale, always uses the same Interest Engine as everything else

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-operational-management*
*Context gathered: 2026-03-21*
