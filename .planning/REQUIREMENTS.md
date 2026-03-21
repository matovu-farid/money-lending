# Requirements: Money Lending Management System

**Defined:** 2026-03-19
**Core Value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## v1 Requirements

### Authentication & Access (AUTH)

- [x] **AUTH-01**: User can register, log in, reset password, and maintain sessions via Better Auth
- [x] **AUTH-02**: New user accounts default to **Unassigned** on signup — zero permissions until a role is explicitly granted
- [x] **AUTH-03**: System enforces a 3-tier role hierarchy via Better Auth roles plugin:

  | Capability | Super Admin | Admin | Loan Officer | Unassigned |
  |------------|:-----------:|:-----:|:------------:|:----------:|
  | Assign Super Admin or Admin roles | ✓ | — | — | — |
  | Assign Loan Officer role | ✓ | ✓ | — | — |
  | Activate / deactivate any user | ✓ | ✓ | — | — |
  | Edit system settings (interest defaults, overrides) | ✓ | — | — | — |
  | Override interest rate & minimum period per loan | ✓ | ✓ | — | — |
  | Register customers, issue loans, record payments | ✓ | ✓ | ✓ | — |
  | Print receipts | ✓ | ✓ | ✓ | — |
  | View watchlist, alerts & customer data | ✓ | ✓ | ✓ | — |
  | Manage creditors & record creditor repayments | ✓ | ✓ | — | — |
  | Record expenses & income | ✓ | ✓ | — | — |
  | View dashboard & reports | ✓ | ✓ | ✓ | — |
  | Export reports (PDF/Excel) | ✓ | ✓ | — | — |

- [x] **AUTH-04**: System records login activity per user (session history stored internally)
- [x] **AUTH-05**: A user can only assign roles at or below their own level — Admins cannot create Super Admins

### Customer Management (CUST)

- [x] **CUST-01**: User can register a customer with Full Name, Contact (phone/email), and Physical Address
- [x] **CUST-02**: User can view and edit a customer's profile
- [x] **CUST-03**: User can capture security/collateral details per loan (nature: land title, vehicle log book, etc.)
- [x] **CUST-04**: System blocks loan issuance if required customer or collateral details are incomplete
- [x] **CUST-05**: User can search and filter customers by name, status, loan status, and days remaining — with pagination
- [x] **CUST-06**: User can set customer status: Active, Blacklisted, or Inactive
- [x] **CUST-07**: User can view a customer's full loan history — all past and current loans with payment breakdown

### Loan Engine (LOAN)

- [x] **LOAN-01**: User can create a loan application: Amount, Date, Interest Rate (default 10%/month, minimum), linked Security
- [x] **LOAN-02**: Loan is open-ended (perpetual) — no fixed maturity date. Interest accrues on the outstanding principal in 30-day billing cycles. The loan rolls forward indefinitely until the balance reaches zero. Default interest rate is 10%/month (minimum).
- [x] **LOAN-03**: System calculates interest on reducing balance using: `daily_rate = outstanding_principal × monthly_rate / 30`; `interest = daily_rate × days_elapsed` — computed on-demand from payment history, no daily accrual records needed. The daily rate changes only when a payment reduces principal.
- [x] **LOAN-04**: All interest calculations use a BigNumber library for precision (no native float arithmetic)
- [x] **LOAN-05**: Loan status transitions through lifecycle: Pending → Active → Fully Paid. **DEVIATION (v1):** Reduced from 5 statuses to 3 by user decision — `partially_paid` and `defaulted` removed for v1 simplicity. Overdue detection handled by watchlist (Phase 3) instead of a status flag.
- [x] **LOAN-06**: Loan officer can manually record a customer payment (amount, date) — payments happen off-app (cash, mobile money, etc.) and are entered into the system by staff
- [x] **LOAN-07**: Loan officer can edit or delete a recorded payment — every create, update, and delete is written to the audit log with the acting user, timestamp, and before/after values
- [x] **LOAN-08**: System allocates payments interest-first, then applies remainder to principal
- [x] **LOAN-09**: System accepts any payment amount (no minimum repayment)
- [x] **LOAN-10**: System enforces a 30-day minimum interest period — within the first 30 days, borrower always pays 30 days of interest regardless of when they repay. After 30 days, interest is prorated to actual days elapsed. Formula: `interest_days = max(days_elapsed, 30)`
- [x] **LOAN-11**: Admin can override the minimum interest period and default interest rate per loan or globally

### Receipts (RCPT)

- [x] **RCPT-01**: System auto-generates a printable disbursement receipt when a loan is issued (Loan Amount, Date, Interest Rate) — blocked if any detail is incomplete
- [x] **RCPT-02**: System generates a printable repayment receipt for each payment received
- [x] **RCPT-03**: System blocks receipt printing if any customer, loan, or payment detail is missing or incorrect

### Monitoring & Risk (RISK)

- [x] **RISK-01**: System displays "days overdue" per loan: `days_overdue = unpaid_interest / current_daily_rate` where `unpaid_interest = cumulative_interest_accrued − cumulative_interest_paid`. Shown on loan officer dashboard as a loan ledger table (see CONTEXT.md Loan Ledger Specification)
- [x] **RISK-02**: System auto-flags borrowers with days_overdue ≥ 30 on a watchlist — meaning they have not paid enough to cover their interest obligations for a full billing cycle
- [x] **RISK-03**: User can simulate repayments: "If borrower pays X amount, how many days will they have left?"
- [x] **RISK-04**: Repayment simulator uses the same calculation engine as the cron (not a separate implementation)

### Alerts & Notifications (ALRT)

- [x] **ALRT-01**: System sends in-app alert to Admin and Loan Officer 5 days before a loan's due date
- [x] **ALRT-02**: System sends email notification to Admin on every payment CUD operation (created, updated, or deleted) and on loan disbursement — includes actor, loan reference, amount, and timestamp

### Creditor Management (CRED)

- [x] **CRED-01**: User can register a creditor with Name, Address, Contact, Amount invested, and Interest rate
- [x] **CRED-02**: User can view and edit a creditor's profile and full investment history
- [x] **CRED-03**: System calculates daily interest on creditor funds using the same reducing-balance engine as borrower loans
- [x] **CRED-04**: User can record repayments made back to creditors
- [x] **CRED-05**: System displays creditor dashboard: capital invested, interest accrued, repayments made, outstanding balance
- [ ] **CRED-06**: System displays system-wide capital view: total funds from all creditors combined

### Financial Transactions (FINC)

- [x] **FINC-01**: System maintains a transaction log of all debit and credit entries across the business
- [x] **FINC-02**: User can record expenses with configurable categories (Rent, Salaries, Office Expenses, Interest Payments, DStv, custom)
- [x] **FINC-03**: User can record income with configurable categories (Share Capital, Bonuses, Interest Earned, custom)

### Reports & Dashboard (RPTS)

- [x] **RPTS-01**: System displays executive dashboard: total loans outstanding, repayments collected, interest earned, capital in system, active borrowers, overdue count
- [ ] **RPTS-02**: System generates loan portfolio report: active loans with days remaining, interest accrued, status, risk flags
- [ ] **RPTS-03**: System auto-generates monthly Profit & Loss statement (Interest Income + Other Income minus all Expenses)
- [ ] **RPTS-04**: System auto-generates Balance Sheet: Assets (loans outstanding), Liabilities (creditor balances), Equity (share capital)
- [ ] **RPTS-05**: User can export all reports to PDF and Excel formats

### Infrastructure (INFR)

- [ ] **INFR-01**: PostgreSQL database with NUMERIC(15,2) monetary columns (UGX), audit log table (records every payment CUD with actor, timestamp, before/after values), and schema migrations
- [x] **INFR-02**: RESTful API (Next.js Route Handlers) with Zod input validation and consistent error handling
- [x] **INFR-03**: Responsive frontend for desktop and tablet (not mobile-first); all monetary values displayed in UGX
- [x] **INFR-04**: Scheduled job (lightweight cron) for overdue loan detection and predictive alerts only — not for financial calculations
- [ ] **INFR-05**: All monetary arithmetic in TypeScript/JavaScript uses a BigNumber library (bignumber.js or decimal.js) — no native float operations on money values
- [ ] **INFR-06**: Effect.js used throughout the service layer — all service functions return `Effect<Success, Error, Dependencies>`, errors are typed and exhaustive, dependencies injected via Layer

## v2 Requirements

### Alerts

- Overdue loan auto-flagging (automatic flag when loan passes due date) — deferred, manual monitoring covers v1

### QA & Testing

- Unit and integration tests for loan calculation engine
- End-to-end tests for full loan lifecycle
- User acceptance testing with client team

## Out of Scope

| Feature                                | Reason                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Native mobile apps (iOS/Android)       | Web-only engagement — explicitly excluded                               |
| SMS notifications                      | Excluded from this version                                              |
| Mobile money platform integrations     | Excluded explicitly                                                     |
| Multi-currency support                 | Single currency only                                                    |
| Offline mode                           | Not required                                                            |
| Automated debt collection workflows    | Excluded explicitly                                                     |
| Guarantor details                      | Borrower is their own guarantor — separate guarantor capture not needed |
| Payment reversal/adjustment            | Not in requirements — design schema to accommodate later                |
| Real-time (sub-daily) interest accrual | Anti-feature — once daily is the correct model                          |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| AUTH-01     | Phase 1 | Complete |
| AUTH-02     | Phase 1 | Complete |
| AUTH-03     | Phase 1 | Complete |
| AUTH-04     | Phase 1 | Complete |
| AUTH-05     | Phase 1 | Complete |
| CUST-01     | Phase 1 | Complete |
| CUST-02     | Phase 1 | Complete |
| CUST-03     | Phase 1 | Complete |
| CUST-04     | Phase 1 | Complete |
| CUST-05     | Phase 3 | Complete |
| CUST-06     | Phase 3 | Complete |
| CUST-07     | Phase 3 | Complete |
| LOAN-01     | Phase 1 | Complete |
| LOAN-02     | Phase 1 | Complete |
| LOAN-03     | Phase 1 | Complete |
| LOAN-04     | Phase 1 | Complete |
| LOAN-05     | Phase 1 | Complete |
| LOAN-06     | Phase 2 | Complete |
| LOAN-07     | Phase 2 | Complete |
| LOAN-08     | Phase 2 | Complete |
| LOAN-09     | Phase 2 | Complete |
| LOAN-10     | Phase 1 | Complete |
| LOAN-11     | Phase 1 | Complete |
| RCPT-01     | Phase 2 | Complete |
| RCPT-02     | Phase 2 | Complete |
| RCPT-03     | Phase 2 | Complete |
| RISK-01     | Phase 3 | Complete |
| RISK-02     | Phase 3 | Complete |
| RISK-03     | Phase 3 | Complete |
| RISK-04     | Phase 3 | Complete |
| ALRT-01     | Phase 3 | Complete |
| ALRT-02     | Phase 2 | Complete |
| CRED-01     | Phase 4 | Complete |
| CRED-02     | Phase 4 | Complete |
| CRED-03     | Phase 4 | Complete |
| CRED-04     | Phase 4 | Complete |
| CRED-05     | Phase 4 | Complete |
| CRED-06     | Phase 4 | Pending |
| FINC-01     | Phase 4 | Complete |
| FINC-02     | Phase 4 | Complete |
| FINC-03     | Phase 4 | Complete |
| RPTS-01     | Phase 3 | Complete |
| RPTS-02     | Phase 4 | Pending |
| RPTS-03     | Phase 4 | Pending |
| RPTS-04     | Phase 4 | Pending |
| RPTS-05     | Phase 4 | Pending |
| INFR-01     | Phase 1 | In Progress (schema + audit table defined in 01-01) |
| INFR-02     | Phase 1 | Complete |
| INFR-03     | Phase 1 | Complete |
| INFR-04     | Phase 2 | Complete |
| INFR-05     | Phase 1 | In Progress (bignumber.js installed, no-float pattern enforced in schema design, 01-01) |
| INFR-06     | Phase 1 | In Progress (Effect.js error types defined in 01-01; full service layer in 01-04/05) |

**Coverage:**

- v1 requirements: 52 total (AUTH×5, CUST×7, LOAN×11, RCPT×3, RISK×4, ALRT×2, CRED×6, FINC×3, RPTS×5, INFR×6)
- Phase 1: 21 requirements (AUTH-01–05, CUST-01–04, LOAN-01–05, LOAN-10–11, INFR-01–03, INFR-05–06)
- Phase 2: 9 requirements (LOAN-06–09, RCPT-01–03, ALRT-02, INFR-04)
- Phase 3: 9 requirements (CUST-05–07, RISK-01–04, ALRT-01, RPTS-01)
- Phase 4: 13 requirements (CRED-01–06, FINC-01–03, RPTS-02–05)
- Unmapped: 0

---

_Requirements defined: 2026-03-19_
_Last updated: 2026-03-19 after roadmap creation_
