# Feature Landscape

**Domain:** Money Lending / Microfinance Management System
**Researched:** 2026-03-19
**Confidence:** MEDIUM — primary source is the client requirements document (Feb 2026); external research tools unavailable; findings cross-referenced against established microfinance domain knowledge

---

## Table Stakes

Features users expect. Missing = product feels incomplete or is operationally unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Customer registration and profile management | Every lending system starts with a borrower identity. No profile = no loan | Low | Full name, phone/email, physical address; edit capability required |
| Loan issuance with amount, rate, and date | Core transaction of the business — without it, the system is an address book | Medium | Must link to customer, guarantor, and collateral at creation time |
| Interest calculation (daily, reducing balance) | Industry standard for microfinance; borrowers expect transparent accrual | High | Runs via cron daily; payment allocation: interest first, then principal |
| Loan status lifecycle | Staff must know at a glance where each loan stands | Medium | Pending → Active → Partially Paid → Fully Paid → Defaulted |
| Payment recording and receipt generation | Every payment must produce a traceable artifact; no receipt = operational dispute risk | Medium | Receipt must include loan ID, customer name, amount paid, balance remaining, date |
| Loan disbursement receipt | Required at point of issuance; proof of transaction for both parties | Low | Blocked if customer/guarantor/collateral details are incomplete |
| Customer search, filtering, and pagination | Loan officers manage dozens to hundreds of customers; no search = unusable at scale | Low | Filter by status, search by name/phone |
| Overdue/defaulted loan flagging | Without automatic flagging, overdue loans are invisible until discovered manually | Medium | Auto-flag based on due date; visual distinction in lists |
| Role-based access control | Staff must not have equal access to all functions; financial risk otherwise | Medium | Roles: Super Admin, Admin, Loan Officer, Viewer; enforced at API level |
| Executive dashboard | Management needs at-a-glance portfolio health without running individual reports | Medium | Outstanding loans, repayments today, interest earned, capital deployed, overdue count |
| Audit trail for all financial writes | Regulatory and operational requirement; without it, disputes cannot be resolved | High | Every loan, payment, and edit must record who did what and when |
| Expense and income tracking | The business has operating costs that affect profitability; without this, P&L is impossible | Medium | Categorized transactions; debit/credit ledger |
| Profit & Loss statement | Required to understand if the business is profitable; expected by any operator | High | Auto-generated monthly from income/expense ledger and interest earned |
| Input validation safeguards | Financial fields with bad data cause cascading calculation errors | Medium | Block loan issuance if required fields are missing; validate amounts and dates |
| Secure authentication and session management | Financial data cannot be exposed to unauthenticated users | Low | Clerk handles this; login, password reset, session expiry |

---

## Differentiators

Features that set this system apart from a basic spreadsheet or generic CRM. Not universally expected, but materially improve the product's value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Repayment simulator ("if borrower pays X, how many days left?") | Loan officers can give borrowers a real-time answer at the counter; eliminates guesswork and manual calculation | Medium | Requires working interest calculation service; renders result instantly without persisting |
| Balance-to-days converter | Converts outstanding balance into days remaining — intuitive risk indicator staff can communicate verbally | Low | Derived from balance / daily interest rate; display in borrower watchlist |
| Borrower watchlist (auto-flag when < 30 days remaining) | Proactive risk management — officers see who needs follow-up before default, not after | Medium | Computed daily after cron runs; shown prominently on dashboard |
| 5-day pre-due-date in-app alert | Gives loan officers actionable lead time; reduces default by prompting outreach | Medium | Triggered by cron; stored as notification record, consumed by UI |
| Email alert to admin on every money-in / money-out | Admin oversight without requiring login; critical for small business owners who are not always present | Low | Webhook-style email triggered on each payment or disbursement |
| Creditor / investor capital tracking | Most small lending businesses borrow capital from investors — ignoring this creates a double-books problem | High | Mirrors loan engine for creditor side; tracks interest owed to investors |
| Balance Sheet auto-generation | Goes beyond P&L to show solvency; essential for businesses managing investor capital | High | Assets (loan book + cash), Liabilities (creditor obligations), Equity |
| PDF and Excel report export | Reports must leave the system — for sharing with investors, auditors, or regulators | Medium | PDF for receipts and statements; Excel for raw data portability |
| Customer blacklist status | Prevents re-issuance to bad actors without requiring manual memory; institution-level risk control | Low | Status field; block loan issuance to blacklisted customers at UI and API level |
| Full loan history per customer | Repeat borrowers are the norm; officers need to see prior behavior instantly | Low | Chronological list of all loans, payments, and statuses per customer |
| Guarantor and collateral capture at loan level | Reduces default recovery friction; staff know what security exists before chasing payment | Low | Stored per-loan, not per-customer; same person can guarantee different loans |
| Minimum interest period enforcement (30 days, admin-overridable) | Protects business revenue when borrowers repay early; business rule must be system-enforced not memory-enforced | Medium | Admin can override per-loan or change default; audit log captures overrides |
| Login activity tracking | Detects unauthorized access; accountability for staff actions | Low | Clerk webhooks write login events to audit table |

---

## Anti-Features

Features that appear useful but create problems in practice for this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time interest accrual (sub-daily) | Appears more accurate but creates reconciliation complexity, race conditions, and confuses staff who are used to daily statements | Run the cron once per day; display "as of today" balances clearly |
| Automatic payment scheduling / direct debit | Sounds useful but microfinance borrowers typically pay in cash at the counter; automating scheduled pulls without payment infrastructure causes phantom transactions | Record payments manually at point of receipt |
| Complex multi-tier loan products | Lending businesses that try to offer many product types early create configuration hell and support burden | Start with one loan product (flat rate, daily accrual); add products only when validated |
| Built-in SMS notifications | Appears essential but requires per-country telecom integrations, gateway costs, and regulatory compliance; scope creep risk is severe | Scope excludes SMS; email to admin is sufficient for v1 |
| Mobile money integration | Same problem as SMS — gateway APIs vary by region, require business account setup, and add payment reconciliation complexity | Excluded from scope; record cash/transfer payments manually |
| Soft-delete everything by default | Appears safer but in financial systems soft-delete without clear access control means deleted loans reappear in reports, inflating totals | Hard-delete non-financial records; never delete financial records — mark as voided/cancelled with audit trail |
| Inline editing in data tables | Seems productive but in financial systems inline edits bypass validation flows and audit logging | Route all edits through dedicated edit forms with validation and change logging |
| "Undo" for payments | Users request this but payment reversal in lending must follow a formal process (credit note, reversal entry) to maintain ledger integrity | Implement a formal payment reversal / adjustment workflow, not a simple undo button |
| Role permissions UI that lets admins create custom roles | Adds configuration complexity without proportional benefit for a small team | Ship with fixed role set (Super Admin, Admin, Loan Officer, Viewer); roles are code-level, not database-configured |

---

## Feature Dependencies

```
Auth (Clerk) → Everything (all routes protected)

Customer Profile
  → Loan Issuance (loan requires a customer)
  → Guarantor + Collateral capture (required before disbursement receipt)
  → Customer search and history

Loan Issuance
  → Disbursement receipt
  → Interest calculation cron (loan must exist before accrual starts)
  → Loan status lifecycle

Interest Calculation Cron
  → Balance-to-days converter (requires current balance)
  → Borrower watchlist (< 30 days flag requires current balance)
  → 5-day pre-due alert (requires calculated due date)
  → Overdue auto-flagging

Payment Recording
  → Repayment receipt
  → Email alert to admin (money-in trigger)
  → Loan status update (Partially Paid / Fully Paid)
  → Interest-first allocation rule

Expense + Income Tracking
  → P&L statement (requires categorized ledger)
  → Balance Sheet (requires ledger + loan book values)

Creditor Registration
  → Creditor interest calculation (reuses loan engine)
  → Creditor repayment tracking
  → System-wide capital view
  → Balance Sheet (creditor balances = liabilities)

Audit Log
  → Login activity tracking
  → All financial writes (payments, loans, creditor transactions)
  → Admin override recording (minimum interest period, rate changes)

Dashboard
  → Loan portfolio data (requires active loans)
  → Creditor capital data (requires creditor records)
  → Watchlist (requires cron to have run)
  → P&L figures (requires expense/income ledger)

PDF/Excel Export
  → P&L statement (source data)
  → Balance Sheet (source data)
  → Loan portfolio report (source data)
  → Receipts (individual documents, independent)
```

---

## MVP Recommendation

The minimum viable system — loan officer can register a customer, issue a loan, collect a payment, and print a receipt.

**Prioritize (must ship together):**

1. Authentication and RBAC — nothing works without identity
2. Customer registration with guarantor and collateral capture
3. Loan issuance with validation safeguards
4. Disbursement receipt (printable)
5. Daily interest calculation cron
6. Payment recording with interest-first allocation
7. Repayment receipt (printable)
8. Loan status lifecycle
9. Audit trail for all financial writes

**Ship second (operational completeness):**

10. Executive dashboard
11. Customer search, filtering, blacklist status
12. Borrower watchlist and overdue flagging
13. Repayment simulator
14. In-app alerts (5-day pre-due)
15. Email notification on money-in / money-out
16. Expense and income tracking

**Ship third (financial reporting):**

17. Creditor management and capital tracking
18. P&L statement
19. Balance Sheet
20. PDF and Excel export
21. Login activity tracking

**Defer (post-launch):**

- Loan portfolio report (can be approximated from dashboard initially)
- Admin settings UI for overriding interest rate/minimum period (hardcode defaults; add UI after MVP validates)

---

## Features Commonly Forgotten in Lending Systems

These are not in scope debates — they are things teams assume exist but discover are missing after launch:

| Forgotten Feature | Why It Gets Missed | Impact When Missing |
|------------------|--------------------|---------------------|
| Receipt safeguard (block printing if data incomplete) | Developers assume staff will always enter data correctly | Printed receipts with wrong amounts or missing customer names; disputes, trust erosion |
| Audit trail on admin overrides | Teams add audit logs for transactions but forget configuration changes | Admin changes the default rate; no record of who, when, or what it was before |
| Loan officer cannot void their own payment | Access control for creates is added; access control for reversals is forgotten | Loan officer records fraudulent payment, then voids it; no admin oversight |
| Interest calculation idempotency (cron runs twice in a day) | Cron is treated as "just a job"; no guard against double-execution | Interest accrues twice; customer balances wrong; hard to detect without reconciliation |
| Creditor balance as a liability on Balance Sheet | Teams build creditor tracking as standalone; forget it feeds the Balance Sheet | Balance Sheet shows wrong equity figure; investor reports are wrong |
| Customer status check at payment time | Status is checked at loan issuance but not at payment recording | Payment recorded for a blacklisted customer's loan after blacklisting; confusing ledger |
| Printable receipt branding | Receipt generation is built generically; client branding is assumed "easy to add later" | Receipts go out without client logo, business name, or contact details; unprofessional |
| Pagination on all list views | First build uses small test data; pagination added only when a list becomes slow | System bogs down after 200+ loans; staff pagination is an afterthought requiring refactor |
| Per-session timeout enforcement | Auth is set up but session expiry on inactivity is not configured | Loan officer walks away; another person uses open session |
| Cron failure alerting | Cron is set up but there is no notification if it fails | Interest stops accruing silently; balances frozen until someone notices manually |

---

## Sources

**Confidence notes:**

- PRIMARY (HIGH): CLIENT REQUIREMENTS DOCUMENT — PROJECT.md, derived from Money_Lending_App_Requirements.docx v1.0 (Feb 16 2026). All features in Table Stakes and Differentiators that match PROJECT.md requirements are HIGH confidence.
- MEDIUM: Domain knowledge of microfinance and small lending business operations, informed by widely documented microfinance management system patterns (CGAP standards, Mifos/Fineract feature sets, common MFI software requirements).
- LOW: The "Commonly Forgotten" section draws on domain reasoning and engineering experience; not verified against current user research. Flag for validation with client during UAT.

External sources could not be fetched during this research session (WebSearch, WebFetch, and Bash tools were not available). All findings derive from primary client context plus domain knowledge. Phase-specific research should verify the cron idempotency pattern and receipt generation approach against current library documentation.
