# Money Lending Management System

## What This Is

A web-based platform for a lending business to manage the full loan lifecycle — from customer onboarding and loan issuance through daily interest calculation, repayment collection, and financial reporting. Tracks investor (creditor) capital, operational expenses, and generates monthly financial statements (P&L, Balance Sheet). Includes PDF/Excel export, borrower watchlist, repayment simulator, and in-app alerts. Desktop and tablet use by lending staff.

## Core Value

A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## Requirements

### Validated

- ✓ AUTH-01–05: Better Auth with RBAC, 3-tier role hierarchy, session tracking — v1.0
- ✓ CUST-01–07: Customer CRUD, search/filter/pagination, status management, loan history — v1.0
- ✓ LOAN-01–11: Perpetual reducing-balance loans, BigNumber arithmetic, interest-first payment allocation, 30-day minimum period, admin overrides — v1.0
- ✓ RCPT-01–03: Disbursement and repayment receipts with completeness guards — v1.0
- ✓ RISK-01–04: Days-overdue calculation, borrower watchlist (≥30 days), repayment simulator using same engine as cron — v1.0
- ✓ ALRT-01–02: In-app due-date alerts (5 days before), email notifications on all financial events — v1.0
- ✓ CRED-01–06: Creditor registration, reducing-balance interest accrual, repayment tracking, system-wide capital view — v1.0
- ✓ FINC-01–03: Transaction log, expense/income with configurable categories — v1.0
- ✓ RPTS-01–05: Executive dashboard, loan portfolio report, monthly P&L, Balance Sheet, PDF/Excel export — v1.0
- ✓ UX-01–05: Loading spinners, useTransition, optimistic mutations, TanStack Query, page skeletons — v1.0
- ✓ INFR-02–04: Server Actions, responsive UI, overdue detection cron — v1.0

### Active

- [ ] Standalone Payments page with global list, search, and filters
- ✓ COLL-01–04: Daily collections view with timezone-aware aggregation, breakdown table, due-today list — v1.1 Phase 07
- [ ] Quick-record payment (select loan inline, no navigation required)

### Out of Scope

- Native mobile apps (iOS/Android) — web-only engagement
- SMS notifications — excluded from this version
- Mobile money platform integrations — excluded
- Multi-currency support — single currency (UGX) only
- Offline mode — not required
- Automated debt collection workflows — excluded
- Guarantor details — borrower is their own guarantor
- Real-time (sub-daily) interest accrual — daily is the correct model

## Context

- **Shipped:** v1.0 MVP on 2026-03-22 (~52,000 LOC TypeScript, 300 files)
- **Tech stack:** Next.js 16, React 19, Better Auth, Drizzle ORM, PostgreSQL, Effect.js, BigNumber.js, TanStack Query, Tailwind CSS, shadcn/ui (base-ui primitives)
- **Requirements doc:** `private_docs/Money_Lending_App_Requirements.docx` (v1.0, Feb 16 2026)
- **Known tech debt:**
  - INFR-06: Effect.js services close over module-scope db — full Context.Tag/Layer DI deferred
  - Test files have TypeScript warnings (unused vars, missing module declarations)
  - `FormEvent` deprecated warnings in form components (Next.js 16 / React 19 change)

## Constraints

- **Auth:** Better Auth — self-hosted, RBAC plugin, no vendor lock-in
- **Roles:** Super Admin → Admin → Loan Officer → Unassigned (new signups default to Unassigned)
- **Database:** PostgreSQL with NUMERIC(15,2) monetary columns
- **Currency:** Ugandan Shillings (UGX) — single currency, no conversion
- **Arithmetic:** BigNumber.js for all monetary calculations — native floats forbidden
- **Error handling:** Effect.js typed errors throughout service layer
- **Frontend:** React 19 + Next.js 16 — responsive for desktop and tablet
- **Interest:** On-demand formula from payment history — no daily accrual rows
- **Cron:** Detection and alerts only — no financial calculations

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Better Auth over Clerk | Self-hosted, open source, built-in RBAC, no vendor lock-in | ✓ Good |
| PostgreSQL | Client requirement; relational model suits financial data | ✓ Good |
| On-demand interest (no accrual cron) | Simpler architecture, payment table is source of truth | ✓ Good |
| Interest-first payment allocation | Core business rule — non-negotiable | ✓ Good |
| 30-day minimum interest period | Business rule: borrower pays at least 30 days even if repaid early | ✓ Good |
| Perpetual loans (no maturity date) | Loans roll indefinitely until fully paid — matches business model | ✓ Good |
| 3 statuses (pending→active→fully_paid) | Simplified from 5 — overdue handled by watchlist, not status | ✓ Good |
| Server Actions over Route Handlers | Direct function calls, no fetch ceremony — per user preference | ✓ Good |
| No Zod in Server Actions | TypeScript types sufficient; Zod only for raw untrusted input | ✓ Good |
| Effect services close over module db | Full Layer/Context.Tag DI deferred — pragmatic for v1 timeline | ⚠️ Revisit |
| writeAuditLog as plain async (not Effect) | Effect.runPromise inside Drizzle tx causes runtime errors | ✓ Good |
| base-ui primitives (not Radix) | shadcn@latest uses @base-ui/react — no asChild prop, render prop pattern | ✓ Good |
| TanStack Query for expense/income only | Full app-wide adoption deferred — useTransition handles most cases | ✓ Good |
| Loans created as active (no pending) | Disbursement is off-app; recording = it happened | ✓ Good |

---
## Current Milestone: v1.1 Payments

**Goal:** Build out the Payments section as a first-class page — global payments list, daily collections view, and quick-record workflow.

**Target features:**
- Global payments list with search/filter (date, customer, amount, loan)
- Daily collections summary view
- Quick-record payment without navigating to individual loan page

---
*Last updated: 2026-03-23 after v1.1 milestone started*
