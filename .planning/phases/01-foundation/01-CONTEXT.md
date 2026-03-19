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
- **Detailed UI/UX design:** Deferred to `/frontend-design` skill.

### Interest Calculation Preview (Review Step)
- The Review step (Step 3) of loan issuance shows a calculated summary before the user confirms:
  - Daily interest amount (UGX)
  - Total interest at 30 days
  - Total owed at 30 days (principal + interest)
  - Minimum interest period reminder ("30-day minimum interest applies even if repaid early")
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

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-19*
