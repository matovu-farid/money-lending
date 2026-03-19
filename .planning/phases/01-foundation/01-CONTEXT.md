# Phase 1: Foundation - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the database schema, Better Auth with 3-tier RBAC, customer CRUD, loan issuance engine, and the Interest Engine. This is everything that is expensive to change once real financial data exists. No payment processing, no receipts, no dashboard aggregates — those are Phase 2 and 3.

</domain>

<decisions>
## Implementation Decisions

### App Shell & Navigation
- **Layout:** Top bar (branding + user avatar/logout) + collapsible left sidebar. Sidebar collapses to icon-only rail; expands on toggle.
- **Sidebar groups and items (full nav from day one):**
  - *(ungrouped)* Dashboard
  - Operations: Customers, Loans, Payments
  - Capital: Creditors, Expenses & Income
  - Insights: Reports
  - System: Admin
- **Unbuilt sections** (Payments, Creditors, Expenses & Income, Reports in Phase 1) are visible but grayed out — not hidden.
- User avatar and logout live at the bottom of the sidebar.

### Auth UX
- **Auth pages:** Custom-built login, register, and forgot-password pages using our own components + Tailwind. Better Auth handles the logic; we own the UI. No pre-built Better Auth UI components.
- **Login method:** Email + password only. No username-based login.
- **Unassigned user landing:** Dedicated "pending approval" page — no sidebar, no nav, just a clear message and contact info. Shown to any user with the Unassigned role after login.
- **Role promotion:** Admin panel shows a user management table. Each row has an inline role dropdown — change and save without leaving the table.

### Customer Registration
- **Form placement:** Dedicated page (`/customers/new`) — full-page inline form, not a modal or drawer.
- **Fields:** Full Name, Contact (phone/email), Physical Address.
- **Detailed UI/UX design:** Deferred to `/frontend-design` skill.

### Loan Issuance
- **Structure:** Multi-step wizard with 3 steps:
  1. Loan details: Amount, Start Date, Interest Rate (default 10%/month)
  2. Collateral: Nature (land title, vehicle log book, etc.) — one item per loan
  3. Review & Confirm: Calculated summary + final confirmation
- **Collateral:** Captured on the loan form (Step 2), not pre-registered on the customer. One collateral item per loan.
- **Loan is perpetual:** No fixed maturity date, no `term_days`, no `due_date` columns. The loan rolls forward indefinitely in 30-day billing cycles until fully repaid.
- **Detailed UI/UX design:** Deferred to `/frontend-design` skill.

### Loan Ledger Model (CRITICAL — governs schema, interest engine, and all downstream phases)

**Core principle:** The payment table IS the rate-period table. Each payment that reduces principal creates a new rate period. No separate rate-periods or daily-accrual table.

**Daily rate formula:** `daily_rate = current_principal × monthly_rate / 30`
- Changes only when a payment reduces principal
- Constant between principal-changing payments

**Minimum interest rule (LOAN-10):**
- Within first 30 days of any payment period: always charge 30 days minimum
- After 30 days: prorated to actual days elapsed
- Formula: `interest_days = max(days_elapsed_since_last_payment, 30)`

**Payment allocation (interest-first):**
1. Calculate interest owed: `max(days_since_last_payment, 30) × daily_rate`
2. Plus any carried-forward unpaid interest from prior partial payments
3. Payment applied: interest first, remainder reduces principal
4. If payment < total interest owed: all goes to interest, principal unchanged, unpaid interest carries forward

**Payment table columns (source of truth for all calculations):**

| Column | Purpose |
|---|---|
| `payment_date` | When this period ends / next begins |
| `amount` | Total cash received |
| `interest_portion` | How much went to interest |
| `principal_portion` | How much went to principal |
| `principal_balance_before` | Principal that governed this period's rate |
| `principal_balance_after` | Principal that governs the next period's rate |

**Days overdue formula (watchlist — RISK-01, RISK-02):**
```
unpaid_interest = cumulative_interest_accrued − cumulative_interest_paid
days_overdue = unpaid_interest / current_daily_rate
Flag when days_overdue ≥ 30
```
- Day 0 (loan just issued): unpaid = 0, days_overdue = 0 → not flagged
- Day 30 (no payment): unpaid = 1 month interest, days_overdue = 30 → flagged

**Reference implementation table (loan officer sees this per customer):**
Shows payment events + periodic snapshots (every 15 days or on payment, whichever comes first):

| # | Event | Day | Princ. before | Princ. after | Daily rate | Days in period | Interest accrued (period) | Interest accrued (cumul.) | Interest paid (event) | Interest paid (cumul.) | Unpaid interest | Days overdue | Flagged |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Loan issued | 0 | — | 1,000,000 | 3,333 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | No |
| 2 | Dashboard | 15 | 1,000,000 | 1,000,000 | 3,333 | 15 | 50,000 | 50,000 | 0 | 0 | 50,000 | 15 | No |
| 3 | Pay 250K | 30 | 1,000,000 | 850,000 | 2,833 | 30 | 100,000 | 100,000 | 100,000 | 100,000 | 0 | 0 | No |
| 4 | Dashboard | 45 | 850,000 | 850,000 | 2,833 | 15 | 42,500 | 142,500 | 0 | 100,000 | 42,500 | 15 | No |
| 5 | Pay 50K | 60 | 850,000 | 850,000 | 2,833 | 30 | 85,000 | 185,000 | 50,000 | 150,000 | 35,000 | 12 | No |
| 6 | Dashboard | 75 | 850,000 | 850,000 | 2,833 | 15 | 42,500 | 227,500 | 0 | 150,000 | 77,500 | 27 | No |
| 7 | Pay 200K | 90 | 850,000 | 770,000 | 2,567 | 30 | 85,000 | 270,000 | 120,000 | 270,000 | 0 | 0 | No |
| 8 | Dashboard | 105 | 770,000 | 770,000 | 2,567 | 15 | 38,500 | 308,500 | 0 | 270,000 | 38,500 | 15 | No |

**How to reconstruct any loan's full history:** Replay all payments from the payment table. Each row gives `principal_balance_before` (→ daily rate for that period) and `principal_balance_after` (→ daily rate for next period). Interest is never stored as a balance — always calculated on demand.

### Interest Calculation Preview (Review Step)
- The Review step (Step 3) of loan issuance shows a calculated summary before the user confirms:
  - Daily interest amount (UGX)
  - Total interest at minimum interest period (`totalInterestAtMinPeriod`) — default 30 days, overridable per loan (LOAN-11)
  - Total owed at minimum interest period (`totalOwedAtMinPeriod`) — principal + interest
  - Minimum interest period reminder ("Minimum interest period applies even if repaid early", showing actual period days)
- Calculated client-side using the Interest Engine (same function as server). Not real-time on keystroke — shown when user reaches the Review step.

### Component Library
- **Foundation:** shadcn/ui — copy-paste components built on Radix UI primitives + Tailwind. Components live in the codebase (no runtime dependency).
- All Phase 1 UI components (buttons, inputs, tables, modals, dropdowns) built using shadcn/ui primitives.

### Customer Profile Page (Phase 1 scope)
- **Sections visible in Phase 1:**
  - Basic info (name, contact, address) — editable
  - Customer status badge (Active / Blacklisted / Inactive) — display only in Phase 1; status change is Phase 3
  - Active loan summary card (loan amount, outstanding balance, status) — summary only; full loan history is Phase 3
  - "Issue New Loan" CTA button — opens loan issuance wizard pre-filled with this customer
- **Customer list:** Data table with Name, Contact, Status columns. Row click navigates to customer profile.

### Claude's Discretion
- Data table column sorting, row hover states, empty state illustrations
- Sidebar collapse animation and icon selection
- Form field ordering within each step
- Error message copy and toast notification design
- Color scheme and typography (beyond Tailwind defaults) — handled by `/frontend-design`

### Effect Service Layer Injection (INFR-06 Deferral)
- Services return `Effect<S, E, never>` with `db` closed over from module scope in Phase 1
- Full `Context.Tag` / `Layer` wiring deferred to Phase 2 to reduce initial complexity
- Rationale: RESEARCH.md recommends skipping Layers for Phase 1; all service functions still satisfy typed error channels and BigNumber arithmetic requirements

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — All v1 requirements; Phase 1 covers: AUTH-01–05, CUST-01–04, LOAN-01–05, LOAN-10–11, INFR-01–03, INFR-05–06

### Project constraints
- `.planning/PROJECT.md` — Constraints section (Better Auth, PostgreSQL, Effect.js, BigNumber, NUMERIC(15,2), on-demand interest calculation, no daily accrual cron)

### Codebase baseline
- `.planning/codebase/STACK.md` — Current dependencies: Next.js 16.2, React 19.2, TypeScript 5.9, Tailwind v4, pnpm
- `.planning/codebase/STRUCTURE.md` — App Router layout, planned directory structure, path alias `@/`
- `.planning/codebase/CONVENTIONS.md` — Naming conventions, import order, styling patterns
- `.planning/codebase/CONCERNS.md` — Critical gaps to address in Phase 1: no DB layer, no auth, no validation, no audit logging

### Tech note (verify before implementing)
- Better Auth RBAC plugin API must be verified against current docs before writing role-enforcement middleware — training data may be stale
- Drizzle ORM current version and migration API must be confirmed before writing schema tasks

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/layout.tsx` — Root layout shell; extend this to add the sidebar/top-bar app shell
- `src/app/globals.css` — Tailwind v4 entry point; add shadcn/ui CSS variables here
- Path alias `@/` → `./src/` — use for all internal imports

### Established Patterns
- Tailwind v4 with PostCSS — all styling via utility classes; no CSS modules
- App Router (`src/app/`) — all pages and layouts follow the Next.js 15+ file convention
- TypeScript strict mode — explicit types required everywhere
- 2-space indentation, kebab-case directories, PascalCase component names
- Default exports for page/layout components; named exports for utilities

### Integration Points
- The app shell layout (sidebar + top bar) wraps all authenticated routes — implement as a route group layout (e.g., `src/app/(app)/layout.tsx`)
- Auth middleware gates the `(app)` route group; unassigned users redirect to `/pending-approval`
- Interest Engine lives in `src/lib/interest/` or `src/services/interest/` — imported by both the loan wizard Review step (client) and API route handlers (server)

</code_context>

<specifics>
## Specific Ideas

- The Review step of the loan wizard should feel like a "confirm before you commit" moment — show all the numbers clearly in UGX before the staff member clicks Issue Loan
- The "pending approval" page should communicate clearly that the account was created successfully and someone will assign their role — avoids confusion about whether signup worked

</specifics>

<deferred>
## Deferred Ideas

- Detailed visual design (spacing, color palette, typography, component aesthetics) — handled by `/frontend-design` skill before or during Phase 1 implementation
- Data table column sorting and filtering on customer list — Phase 3 (CUST-05)
- Customer status change (Active/Blacklisted/Inactive) — Phase 3 (CUST-06)
- Full customer loan history view — Phase 3 (CUST-07)
- Loan ledger UI table (per-customer payment history with 15-day snapshots) — Phase 2/3 UI; the engine and payment schema are Phase 1/2

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-19*
