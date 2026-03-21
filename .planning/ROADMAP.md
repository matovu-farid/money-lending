# Roadmap: Money Lending Management System

## Overview

A greenfield Next.js 16 monolith built in four phases that follow the system's natural data dependency graph. Phase 1 lays the schema, auth, and loan calculation engine — everything that is expensive to change once real financial data exists. Phase 2 completes the core transaction loop so a loan officer can do their full daily job: record a payment and hand the borrower a receipt. Phase 3 adds the operational layer — customer search, the borrower watchlist, the repayment simulator, and the in-app alert system — all of which require a proven engine underneath them. Phase 4 closes the financial picture with creditor capital tracking, the expense/income ledger, and the P&L and Balance Sheet reports that management depends on. Every v1 requirement maps to exactly one phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Database schema, Better Auth with RBAC, customer CRUD, loan issuance engine, and the Interest Engine that everything downstream depends on (completed 2026-03-20)
- [x] **Phase 2: Loan Operations** - Payment processing with interest-first allocation, minimum period enforcement, disbursement and repayment receipt generation, and email alerts on every financial event (completed 2026-03-20)
- [x] **Phase 3: Operational Management** - Executive dashboard, customer search and filtering, borrower watchlist, repayment simulator, balance-to-days converter, and in-app due-date alerts (completed 2026-03-21)
- [ ] **Phase 4: Financial Reporting** - Creditor capital tracking, expense and income ledger, Profit and Loss statement, Balance Sheet, and PDF/Excel report export

## Phase Details

### Phase 1: Foundation
**Goal**: The schema, authentication, and loan calculation engine are correct and production-safe before any financial data is written
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, CUST-01, CUST-02, CUST-03, CUST-04, LOAN-01, LOAN-02, LOAN-03, LOAN-04, LOAN-05, LOAN-10, LOAN-11, INFR-01, INFR-02, INFR-03, INFR-05, INFR-06
**Success Criteria** (what must be TRUE):
  1. A new signup lands on an "Unassigned" account with no permissions; a Super Admin can promote them to Admin or Loan Officer, and that promotion is immediately enforced on every API route without page refresh
  2. A Loan Officer can register a customer with name, contact, and address, then attach collateral details; attempting to create a loan without those fields populated returns a validation error — not a partially created record
  3. A loan can be issued with a principal amount, start date, interest rate (defaulting to 10%/month), and the system computes the correct reducing-balance interest for any number of elapsed days using BigNumber arithmetic — results are reproducible and match manual calculation
  4. All monetary columns in the database are NUMERIC(15,2); every service function returns an Effect type with a typed error channel; no native float operations appear anywhere in the financial calculation path
  5. The audit log table exists and a row is written in the same database transaction as every financial mutation — the row captures the acting user, timestamp, and before/after values
**Plans:** 7/7 plans complete

Plans:
- [x] 01-01-PLAN.md — Install dependencies, DB schema, Vitest, Effect.js error types
- [ ] 01-02-PLAN.md — Interest Engine TDD (pure BigNumber calculation functions)
- [ ] 01-03-PLAN.md — Better Auth setup, RBAC, proxy.ts auth gate, role assignment
- [ ] 01-04-PLAN.md — Customer CRUD service layer and API routes
- [ ] 01-05-PLAN.md — Loan issuance service with atomic transaction and settings API
- [ ] 01-06-PLAN.md — App shell, sidebar navigation, auth pages, pending-approval page
- [ ] 01-07-PLAN.md — Customer UI pages, loan wizard with interest preview, admin panel

### Phase 2: Loan Operations
**Goal**: A loan officer can record a payment and hand the borrower a printed receipt — the core daily transaction loop is complete
**Depends on**: Phase 1
**Requirements**: LOAN-06, LOAN-07, LOAN-08, LOAN-09, RCPT-01, RCPT-02, RCPT-03, ALRT-02, INFR-04
**Success Criteria** (what must be TRUE):
  1. A loan officer can record a payment (amount, date) against an active loan; the system allocates interest first, applies the remainder to principal, and the loan's outstanding balance updates correctly in a single atomic transaction
  2. Editing or deleting a recorded payment is possible; every such change writes an audit row capturing the before and after state and the acting user — no payment modification goes unlogged
  3. A disbursement receipt is generated immediately when a loan is issued and is printable; the receipt is blocked (with a clear error) if any required customer, loan, or collateral detail is missing
  4. A repayment receipt is generated for each recorded payment; the receipt reflects the correct allocation (interest paid, principal paid, outstanding balance) at the moment of that payment
  5. An email notification is sent to Admin on every payment creation, update, or deletion and on every loan disbursement — the email includes the actor, loan reference, amount, and timestamp
**Plans:** 4/4 plans complete

Plans:
- [ ] 02-01-PLAN.md — TDD allocatePayment engine, payment service with CRUD/soft-delete/recalculation cascade
- [ ] 02-02-PLAN.md — Loan detail page with payments table, record payment form, edit/delete dialogs
- [ ] 02-03-PLAN.md — Disbursement and repayment receipt pages with @media print and RCPT-03 guard
- [ ] 02-04-PLAN.md — Email notifications for admin alerts and INFR-04 overdue detection cron

### Phase 3: Operational Management
**Goal**: Staff can monitor the loan portfolio, surface at-risk borrowers, and simulate repayment outcomes without leaving the system
**Depends on**: Phase 2
**Requirements**: CUST-05, CUST-06, CUST-07, RISK-01, RISK-02, RISK-03, RISK-04, ALRT-01, RPTS-01
**Success Criteria** (what must be TRUE):
  1. A user can search customers by name, filter by status (Active, Blacklisted, Inactive) or loan status, and paginate through results; a customer's status can be changed and the change is reflected immediately on their record and in any open loan safeguards
  2. The borrower watchlist automatically shows every borrower with fewer than 30 days remaining based on current balance and daily interest rate; the count is accurate without any manual refresh
  3. Entering a hypothetical payment amount into the repayment simulator returns the updated days-remaining figure using the same Interest Engine calculation function as the rest of the system — not an approximation
  4. An in-app alert appears for Admin and Loan Officer users 5 days before any loan's due date; the alert is generated by the cron job and does not require a manual trigger
  5. The executive dashboard displays live, SQL-aggregated totals for loans outstanding, repayments collected, interest earned, active borrowers, and overdue count — figures match the underlying transaction records
**Plans:** 4/4 plans complete

Plans:
- [x] 03-01-PLAN.md — Notifications schema, Phase 3 types, shared UI components (KpiCard, OverdueBadge), sidebar Watchlist link (completed 2026-03-21)
- [ ] 03-02-PLAN.md — Customer search/filter/pagination, status management with audit, loan history with expandable payments
- [ ] 03-03-PLAN.md — Executive dashboard with KPI cards and activity feed, borrower watchlist page
- [ ] 03-04-PLAN.md — Repayment simulator on loan detail, notification bell with cron-generated alerts

### Phase 4: Financial Reporting
**Goal**: Management can see where all capital is (creditor investments, loan book, expenses, income) and export the Profit and Loss statement and Balance Sheet
**Depends on**: Phase 3
**Requirements**: CRED-01, CRED-02, CRED-03, CRED-04, CRED-05, CRED-06, FINC-01, FINC-02, FINC-03, RPTS-02, RPTS-03, RPTS-04, RPTS-05
**Success Criteria** (what must be TRUE):
  1. A creditor can be registered with name, address, contact, amount invested, and interest rate; their reducing-balance interest accrues daily using the same math function as borrower loans but written to a separate table — a change to borrower interest rates does not affect creditor accruals
  2. Repayments made back to creditors can be recorded and are reflected immediately in the creditor dashboard showing capital invested, interest accrued, repayments made, and outstanding balance; the system-wide capital view aggregates across all creditors
  3. Expenses and income can be recorded with configurable categories; every entry appears in the transaction log as a debit or credit; the log is the single source of truth for the P&L calculation
  4. The monthly Profit and Loss statement (interest income plus other income minus all expenses) and the Balance Sheet (loan book assets, creditor liabilities, equity) are auto-generated and show correct figures that reconcile with the transaction log
  5. Any report — loan portfolio, P&L, Balance Sheet — can be exported to PDF and to Excel with formatting intact; the exported file can be opened and printed by the client without additional software configuration
**Plans:** 1/8 plans executed

Plans:
- [ ] 04-01-PLAN.md — Install deps, create all Phase 4 schema files, error types, TypeScript types
- [ ] 04-02-PLAN.md — TDD creditor service (CRUD, interest accrual, repayment allocation, dashboard)
- [ ] 04-03-PLAN.md — Transaction/category service, auto-posting hooks into payment service
- [ ] 04-04-PLAN.md — Creditor UI pages (list, register, profile with KPI dashboard, dialogs)
- [ ] 04-05-PLAN.md — Expense/income pages with category management, transaction log with filters
- [ ] 04-06-PLAN.md — Report service (P&L, Balance Sheet, Portfolio), creditor auto-posting
- [ ] 04-07-PLAN.md — Report UI pages, PDF/Excel export services, Route Handlers
- [ ] 04-08-PLAN.md — Dashboard wiring (capitalInSystem), month-end cron, end-to-end checkpoint

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 7/7 | Complete   | 2026-03-20 |
| 2. Loan Operations | 4/4 | Complete   | 2026-03-20 |
| 3. Operational Management | 4/4 | Complete   | 2026-03-21 |
| 4. Financial Reporting | 1/8 | In Progress|  |
