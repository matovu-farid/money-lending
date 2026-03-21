# Money Lending Management System

## What This Is

A web-based platform for a lending business to manage the full loan lifecycle — from customer onboarding and loan issuance through daily interest calculation, repayment collection, and financial reporting. It also tracks investor (creditor) capital, operational expenses, and generates end-of-month financial statements. Targeted at desktop and tablet use by lending staff.

## Core Value

A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## Requirements

### Validated

**Loan Engine** (Validated in Phase 2: Loan Operations)
- [x] Payment allocation: interest first, remainder to principal
- [x] No minimum repayment amount
- [x] Daily interest calculation on reducing balance

**Receipts** (Validated in Phase 2: Loan Operations)
- [x] Loan disbursement receipt (auto-generated, printable) — blocked if details incomplete
- [x] Repayment receipt on each payment received
- [x] Receipt safeguard: block printing if any detail is missing or incorrect

**Alerts & Notifications** (Validated in Phase 2: Loan Operations)
- [x] Email notification to admin on every money-in and money-out
- [x] Overdue loan auto-flagging

### Active

**Authentication & Access**
- [ ] Clerk integration for authentication, registration, login, password reset, session management
- [ ] Role-based access control: Super Admin, Admin, Loan Officer, Viewer (mapped via Clerk)

**Customer Onboarding**
- [ ] Customer registration with Full Name, Contact (phone/email), Physical Address
- [ ] Customer profile page with edit capability
- [ ] Guarantor details per loan: Name, Contact, Address
- [ ] Security/Collateral details per loan: Nature (land title, motor vehicle log book, etc.)
- [ ] Validation safeguards — block loan issuance if required details are incomplete

**Loan Engine**
- [ ] Loan application: Amount, Date, Interest Rate (default 10%/month), linked Security & Guarantor
- [ ] Daily interest calculation on reducing balance
- [ ] 30-day default loan term with payment due at end of term
- [ ] Payment allocation: interest first, remainder to principal
- [ ] No minimum repayment amount
- [ ] 30-day minimum interest period (admin-overridable)
- [ ] Loan status lifecycle: Pending → Active → Partially Paid → Fully Paid → Defaulted

**Receipts**
- [ ] Loan disbursement receipt (auto-generated, printable) — blocked if details incomplete
- [ ] Repayment receipt on each payment received
- [ ] Receipt safeguard: block printing if any detail is missing or incorrect

**Infrastructure**
- [ ] PostgreSQL database schema
- [ ] RESTful API with input validation and error handling
- [ ] Responsive frontend (desktop and tablet)
- [ ] Automated daily interest via scheduled cron job

**Monitoring & Risk**
- [x] Balance-to-days converter (remaining days based on balance and daily interest)
- [x] Borrower watchlist: auto-flag borrowers with fewer than 30 days remaining
- [x] Repayment simulator: "If borrower pays X, how many days left?"
- [x] Customer search, filtering, and pagination
- [x] Customer status management: Active, Blacklisted, Inactive
- [x] Full customer loan history

**Alerts & Notifications**
- [x] Predictive in-app alert: 5 days before loan due date
- [ ] Email notification to admin on every money-in and money-out
- [ ] Overdue loan auto-flagging

**Admin & Oversight**
- [ ] Login activity tracking via Clerk webhooks
- [ ] Admin panel: role assignment, activate/deactivate users
- [ ] Admin settings: override minimum interest period and default interest rate

**Creditor Management**
- [ ] Creditor registration: Name, Address, Contact, Amount, Interest rate
- [ ] Creditor profile with investment history
- [ ] Daily interest calculation for creditor funds (reuses loan engine)
- [ ] Creditor repayment tracking
- [ ] Creditor dashboard: capital, interest accrued, repayments, outstanding balance
- [ ] System-wide capital view: total from all creditors

**Expenses & Income**
- [ ] Transaction log: all debit/credit entries
- [ ] Expense tracking with configurable categories (Rent, Salaries, Office Expenses, Interest Payments, custom)
- [ ] Income tracking with configurable categories (Share Capital, Bonuses, Interest Earned, custom)

**Dashboard & Reports**
- [x] Executive dashboard: loans outstanding, repayments, interest earned, capital, active borrowers, overdue count
- [ ] Loan portfolio report: active loans with days remaining, interest accrued, status, risk flags
- [ ] Profit & Loss statement (auto-generated monthly)
- [ ] Balance Sheet (auto-generated: Assets, Liabilities, Equity)
- [ ] Export all reports to PDF and Excel

**QA & Launch**
- [ ] Unit and integration tests for loan calculation engine
- [ ] End-to-end tests for full loan lifecycle
- [ ] User acceptance testing with client team

### Out of Scope

- Native mobile apps (iOS/Android) — web-only engagement
- SMS notifications — excluded from this version
- Mobile money platform integrations — excluded
- Multi-currency support — single currency only
- Offline mode — not required
- Automated debt collection workflows — excluded

## Context

- Requirements document: `private_docs/Money_Lending_App_Requirements.docx` (v1.0, Feb 16 2026)
- Phase 1 (Foundation) complete — auth, customers, loans, interest engine
- Phase 2 (Loan Operations) complete — payments, receipts, email alerts, overdue cron
- Phase 3 (Operational Management) complete — customer search/filter/status, dashboard KPIs, watchlist, simulator, notifications
- Client will provide branding assets for receipts and reports
- UAT will involve maximum 3 client-side testers
- Hosting and domain costs are separate from this engagement
- All monetary values in local currency

## Constraints

- **Auth:** Better Auth — all authentication, session management, password recovery, RBAC
- **Roles:** 3-tier hierarchy — Super Admin (system owner, assigns Admins) → Admin (assigns Loan Officers, manages operations) → Loan Officer (daily work). New signups default to Unassigned (no permissions) until granted a role
- **Database:** PostgreSQL — no alternatives
- **Currency:** Ugandan Shillings (UGX) — single currency, no conversion
- **Arithmetic:** All monetary calculations in TypeScript/JavaScript must use a BigNumber library (e.g., bignumber.js or decimal.js) — native floats are forbidden for financial math
- **Error handling:** Effect.js used throughout — typed errors, dependency injection via Layer, no untyped throws
- **Frontend:** React + Next.js — responsive, desktop and tablet (no mobile-first)
- **Interest calculation:** Formula-based on-demand from loan history (no daily accrual cron) — `interest = balance × daily_rate × days`
- **Scheduled jobs:** Lightweight cron for overdue detection and alerts only — no financial calculations in cron
- **Platform:** Web-only — no native mobile

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Better Auth for auth | Switched from Clerk — self-hosted, open source, built-in RBAC plugin, no vendor lock-in | — Pending |
| PostgreSQL | Client requirement; relational model suits financial data | — Pending |
| Daily cron for interest | Interest calculated once daily, not in real-time | — Pending |
| Payment allocates interest first | Core business rule — non-negotiable | — Pending |
| 30-day minimum interest period | Business rule: borrower pays at least 30 days even if repaid early | — Pending |

---
*Last updated: 2026-03-21 after Phase 3 completion*
