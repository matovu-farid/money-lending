# Domain Pitfalls

**Domain:** Money Lending / Financial Management System
**Researched:** 2026-03-19
**Confidence:** HIGH (domain fundamentals are well-established; patterns drawn from financial software engineering principles and known failure modes in lending systems)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or incorrect financial outcomes.

---

### Pitfall 1: Floating-Point Arithmetic for Money

**What goes wrong:** JavaScript's native `number` type uses IEEE 754 double-precision floating point. Operations like `0.1 + 0.2` do not produce `0.3` — they produce `0.30000000000000004`. In a lending system, this compounds invisibly across thousands of daily interest calculations. A principal of 1,000,000 at 10%/month accumulates floating-point drift that eventually causes a borrower's balance to be a few coins off, receipts to not match ledger totals, and P&L statements to have unexplained rounding discrepancies.

**Why it happens:** Developers reach for `Number`, `parseFloat`, or standard arithmetic operators because they are the path of least resistance in JavaScript. The error is invisible in development (it appears in the 10th+ decimal place) and only surfaces at scale or when totals are compared across contexts.

**Consequences:**
- Loan balance never reaches exactly 0.00 — "fully paid" status never triggers
- Receipt amounts differ from ledger entries by fractions
- Monthly P&L totals don't balance
- Audit trails show inconsistent figures

**Prevention:**
- Store ALL monetary values in the database as `NUMERIC(15,2)` or `BIGINT` (integer cents/minor units). Never use `FLOAT` or `DECIMAL` in PostgreSQL for money columns.
- In application code, use a decimal library — `decimal.js` or `big.js` — for ALL arithmetic involving money. Do not mix native `number` operations with decimal library operations.
- Establish a single canonical rounding rule (e.g., `ROUND_HALF_UP` to 2 decimal places) and apply it consistently at every calculation boundary.
- Write unit tests that verify `0.1 + 0.2 === 0.3` using the decimal library, and that 30 days of daily interest on a round principal produces the exact expected total.

**Detection (warning signs):**
- Any test involving accumulated interest totals fails with off-by-one-cent errors
- Receipt "total paid" doesn't match sum of individual payment records
- A fully-paid loan shows a remaining balance of 0.0000000001

**Phase:** Address in Phase 1 (database schema + loan engine foundation). Retrofitting this after payments exist is extremely painful.

---

### Pitfall 2: Cron Job Double-Execution (Interest Accrued Twice)

**What goes wrong:** The daily interest cron runs once at midnight. If the server restarts, the job scheduler re-initializes and fires the job again. In serverless or containerized environments, two instances can run simultaneously. Result: interest is accrued twice for the same day, doubling the charge to borrowers. Because interest goes to `interest_accrued` (not directly to `balance`), the error may not be visible until payment allocation.

**Why it happens:** Developers implement "run this job at midnight" without implementing idempotency. They assume the scheduler will never fire twice. In practice: deployments, server restarts, container restarts, and timezone edge cases all cause duplicate runs.

**Consequences:**
- Borrowers are charged double interest for one or more days
- Creditor interest also double-accrued
- Correcting this after the fact requires identifying affected loans and reversing entries — without an audit trail, this is impossible to do accurately

**Prevention:**
- Before accruing interest for a loan on a given date, check whether an `interest_accrual` record already exists for that loan on that date. If it does, skip and log.
- Use a dedicated `daily_accrual_log` table with a `UNIQUE(loan_id, accrual_date)` constraint. The constraint will cause the second run to fail gracefully rather than insert a duplicate row.
- Alternatively, use PostgreSQL advisory locks (`pg_try_advisory_lock`) to ensure only one instance of the job runs at a time.
- Log every cron execution with start time, end time, loans processed count, and outcome.

**Detection (warning signs):**
- Loan interest balance increases by 2x on a specific date
- Cron execution logs show two runs within seconds of each other
- Any month where total interest charged doesn't match manual calculation

**Phase:** Address in Phase 2 (cron infrastructure). Idempotency must be built in from the first cron implementation, not added later.

---

### Pitfall 3: Payment Allocation Order Not Enforced at the Database Level

**What goes wrong:** The business rule is "interest first, remainder to principal." This logic lives in the application layer. A developer bypasses the API (e.g., a direct database fix, a migration, or a bulk import) and credits principal directly. Now the loan has principal reduced but interest still outstanding. The loan appears closer to paid-off than it is. The borrower disputes their balance.

**Why it happens:** Business rules enforced only in application code are invisible to anyone working directly with the database. There is no constraint preventing a payment record from being inserted with an incorrect allocation.

**Consequences:**
- Loan balance understated (borrower shown as owing less than they do)
- Discrepancy between interest accrued and interest collected in P&L
- "Fully paid" triggered prematurely

**Prevention:**
- Implement a PostgreSQL trigger or check constraint that validates payment records: `principal_paid` can only be > 0 if `interest_paid` >= current `interest_outstanding` for that loan at payment time. (Trigger-based enforcement is more flexible than a check constraint here.)
- In the application, wrap the entire payment allocation in a single database transaction: read current interest balance, allocate payment, write payment record, update loan balance — atomically.
- Write integration tests that attempt to over-allocate to principal and verify the system rejects it.

**Detection (warning signs):**
- A loan's `interest_outstanding` is positive but `principal_outstanding` decreased
- Sum of all `principal_paid` across payments exceeds expected principal reduction given payments made

**Phase:** Address in Phase 2 (loan engine + payment processing). The allocation logic and its tests should be complete before the UI is built.

---

### Pitfall 4: Audit Trail as Afterthought

**What goes wrong:** Developers add an `updated_at` timestamp to tables and call it an audit trail. When a loan officer changes a loan amount after disbursement, or an admin overrides the interest rate mid-loan, there is no record of what changed, who changed it, or what it was before. The client cannot answer "why is this borrower's balance what it is?" during a dispute.

**Why it happens:** Audit logging feels like overhead during initial development. It gets deferred to "after MVP" and is never retrofitted because it requires schema changes and rewrites to every update path.

**Consequences:**
- Cannot reconstruct a loan's history during a dispute
- No accountability for admin overrides (minimum interest period override, rate changes)
- Regulatory exposure if the business is ever audited
- Cannot debug calculation errors after the fact

**Prevention:**
- Design an `audit_log` table from the start: `(id, table_name, record_id, action, changed_by, changed_at, before_state JSONB, after_state JSONB)`.
- Use PostgreSQL triggers or a middleware layer to write audit entries on every `INSERT`, `UPDATE`, and `DELETE` to financial tables (`loans`, `payments`, `interest_accruals`, `creditor_investments`).
- Log admin overrides explicitly with reason field: `(override_type, old_value, new_value, admin_id, reason, timestamp)`.
- Include `changed_by` (Clerk user ID) in every audit entry — do not rely only on database-level triggers which cannot know the application user.

**Detection (warning signs):**
- A loan's balance cannot be reconstructed from its payment history alone
- An admin setting was changed but no one knows when or by whom

**Phase:** Address in Phase 1 (schema design). The audit log schema must exist before any financial data is written.

---

### Pitfall 5: Role-Based Access Control Enforced Only in the UI

**What goes wrong:** The frontend hides the "Delete Loan" button for Loan Officers. But the API route `/api/loans/[id]` accepts a `DELETE` request from any authenticated Clerk session. A Loan Officer who knows the endpoint can delete loans directly. This is also exploitable via browser DevTools.

**Why it happens:** Clerk makes it easy to check roles in React components. Developers enforce RBAC at the component level and assume the UI is the only entry point. They defer server-side enforcement to "later."

**Consequences:**
- Loan Officers can modify or delete loans they should only be able to read or create
- Viewers can submit payments
- No audit trail of the unauthorized action (because the API didn't check the role before proceeding)

**Prevention:**
- Define a middleware function that extracts the Clerk session, resolves the user's role, and checks it against a permission map BEFORE the route handler executes. This runs on the server, not the client.
- Create a permissions matrix document (Loan Officer: create payment, view loans; Admin: edit loans, override settings; Super Admin: all; Viewer: read only) and implement it as a server-side constant — not inline per-route logic.
- Write integration tests that call sensitive API routes with each role and verify correct `403` responses for unauthorized roles.
- Never trust `role` data sent from the client — always resolve it from the Clerk session on the server.

**Detection (warning signs):**
- A Loan Officer can reach an edit or delete endpoint without a 403 response
- Role checks only appear in React components, not in API route handlers

**Phase:** Address in Phase 1 (auth + RBAC foundation). All subsequent phases depend on this being correct.

---

### Pitfall 6: Clerk Webhook Reliability for Login Activity Tracking

**What goes wrong:** The project requires login activity tracking via Clerk webhooks. Clerk sends webhook events on sign-in, sign-out, and user updates. If the webhook endpoint is down, times out, or returns a non-2xx status, Clerk will retry — but if retries also fail, events are lost permanently. The login activity log becomes incomplete without any indication of the gap.

**Why it happens:** Developers implement the webhook handler synchronously (validate → write to DB in the same request). If the database is slow or the handler throws, the endpoint returns 500 and the event is dropped after retries.

**Consequences:**
- Incomplete login activity log — security events missing
- Admin cannot audit who was logged in during a security incident
- Clerk webhook retries can flood the endpoint under failure conditions

**Prevention:**
- Webhook handler must: (1) validate the Svix signature immediately, (2) write the raw event payload to a `webhook_events` queue table (fast insert), (3) return `200` immediately. A separate background process reads the queue and processes events.
- Set a strict timeout on the webhook handler (under 3 seconds). Never do complex business logic inside a webhook handler.
- Monitor the `webhook_events` table for unprocessed events older than 5 minutes.
- Use Clerk's webhook delivery logs (in the Clerk dashboard) to verify events are being received. Set up alerting if the endpoint starts returning non-2xx.

**Detection (warning signs):**
- Login activity log shows gaps during periods when the server was under load
- Webhook handler takes more than 1 second to respond
- No monitoring on the `webhook_events` table

**Phase:** Address in Phase 3 (admin + audit features). The fast-insert queue pattern must be in place before going live.

---

### Pitfall 7: 30-Day Minimum Interest Period Not Enforced Transactionally

**What goes wrong:** The business rule is: borrowers pay at least 30 days of interest even if they repay in full on day 5. The frontend shows a "days remaining" and the backend calculates minimum interest. But when the payment is submitted, the minimum interest check is done in the route handler. A race condition: two simultaneous payment submissions (double-click, network retry) both pass the check independently and together they clear the loan early without applying the minimum interest correctly.

**Why it happens:** Minimum interest enforcement is checked before writing, not locked during writing. Concurrent requests both read the "not yet paid" state before either writes.

**Consequences:**
- Loan is marked Fully Paid with less than 30 days of interest collected
- Business loses revenue
- The error is invisible until end-of-month reconciliation

**Prevention:**
- Use a `SELECT ... FOR UPDATE` (pessimistic lock) on the loan row at the start of every payment transaction. This serializes concurrent payments on the same loan.
- Calculate minimum interest as: `principal * daily_rate * max(30, days_elapsed)`. Enforce this calculation server-side, not just in the UI.
- The payment route must be idempotent: include a client-generated `idempotency_key` in the request. If a key is already in the `payment_idempotency` table, return the existing result rather than processing again.

**Detection (warning signs):**
- Two payments submitted within milliseconds show the second one also "succeeding"
- A loan marked Fully Paid on day 10 has less than 30 days of interest collected

**Phase:** Address in Phase 2 (payment processing). The locking and idempotency patterns must be in place before any payment UI is built.

---

### Pitfall 8: Interest Calculation Off-By-One on Loan Start Date

**What goes wrong:** Daily interest begins accruing from the loan disbursement date. If the cron runs at midnight, what date does it use — UTC or local time? If the server is in UTC and the business is in UTC+3, a loan disbursed at 11pm local time on March 1 is disbursed at 8pm UTC on March 1. The cron at midnight UTC fires before midnight local time. Day 1 of interest accrual is computed based on UTC dates, not local dates. Over 30 days, the total interest charged may be off by one day.

**Why it happens:** Timezone handling in financial systems is universally underestimated. Developers default to server timezone or UTC without thinking through when the business day starts and ends.

**Consequences:**
- Borrowers charged interest for one day more or less than they should be
- "30 days" doesn't mean 30 calendar days in the borrower's timezone
- Disputes about when a loan started vs when interest started

**Prevention:**
- Define the "business timezone" as a configuration constant (e.g., `Africa/Kampala`). ALL date calculations for loans use this timezone — never raw UTC.
- Store `loan_start_date` as a `DATE` (not `TIMESTAMP`) in the database, using the business timezone. The date is what matters, not the exact millisecond.
- The cron job's "today" must be computed as `new Date()` converted to the business timezone, then date-only. Do not use `new Date().toISOString().split('T')[0]` (this gives UTC date).
- Use `date-fns-tz` or `luxon` for timezone-aware date arithmetic. Never use raw `Date` object arithmetic for business date calculations.

**Detection (warning signs):**
- A loan started March 1 shows first interest accrual on March 2 (or March 1 runs twice)
- "30 days elapsed" triggers at 29 or 31 calendar days depending on time of disbursement
- Cron logs show `accrual_date: 2026-03-19` when local business date is March 20

**Phase:** Address in Phase 1 (schema + cron design) and Phase 2 (cron implementation). Document the timezone assumption explicitly in the codebase.

---

### Pitfall 9: Loan Status Transitions Not Guarded

**What goes wrong:** Loan statuses are: `Pending → Active → Partially Paid → Fully Paid → Defaulted`. A developer writes a status update endpoint that accepts any status value. A malicious or mistaken actor sends `PATCH /api/loans/123 { status: "Fully Paid" }` without any payment being recorded. The loan is marked paid, the borrower owes nothing, and there is no corresponding payment record.

**Why it happens:** Status is stored as an enum and updated freely. There is no state machine enforcing valid transitions or preconditions.

**Consequences:**
- Loans marked Fully Paid without payment — unrecoverable without audit log
- Defaulted loans marked Active again without approval workflow
- Interest accrual continues (or stops) incorrectly based on wrong status

**Prevention:**
- Implement a server-side state machine: define a `VALID_TRANSITIONS` map (`{ Active: ["Partially Paid", "Defaulted"], ... }`) and reject any transition not in the map.
- Status should be derived from financial state where possible, not set directly: "Fully Paid" is set only by the payment processing logic after confirming `outstanding_balance === 0`.
- Only Super Admin can manually override status, and every manual override must write an audit log entry with reason.
- The API should not have a general "update loan status" endpoint — status changes should be side effects of business operations (payment recorded, days elapsed, admin decision).

**Detection (warning signs):**
- A loan's status is Fully Paid but `outstanding_balance > 0`
- Loan status was changed without a corresponding payment or admin action in the audit log

**Phase:** Address in Phase 2 (loan engine). State machine logic must be in place before any status-changing UI is built.

---

### Pitfall 10: Creditor Interest Calculation Entangled with Borrower Loan Engine

**What goes wrong:** The project notes that creditor daily interest "reuses the loan engine." If this is implemented as literal code reuse (same function, same table, same cron), a change to the borrower interest logic silently changes creditor interest logic. A bug fix for one becomes a regression for the other.

**Why it happens:** DRY (Don't Repeat Yourself) is applied at the wrong abstraction boundary. The calculation formula is similar, but the business semantics are different: borrower interest is owed TO the business, creditor interest is owed BY the business.

**Consequences:**
- A change to minimum interest period logic for borrowers accidentally applies to creditors
- Interest rate override in settings affects creditors when it should only affect borrowers
- Reports mix up interest income (from borrowers) and interest expense (to creditors)

**Prevention:**
- Share the mathematical formula (a pure function: `calculateDailyInterest(principal, rate)`) but implement separate database tables, separate cron tasks, and separate service modules for borrower loans vs creditor investments.
- In the P&L report, explicitly distinguish: `interest_income` (from borrowers) vs `interest_expense` (to creditors). These must be sourced from separate tables.
- Name things precisely: `borrower_interest_accruals` vs `creditor_interest_accruals` — not a shared `interest_accruals` table with a `type` discriminator.

**Detection (warning signs):**
- A settings change to "default interest rate" affects creditor interest accruals
- P&L shows one "interest" line that combines income and expense

**Phase:** Address in Phase 1 (schema design). Separation of concerns at the schema level prevents later entanglement.

---

## Moderate Pitfalls

---

### Pitfall 11: Receipt Generation Without Snapshot

**What goes wrong:** Receipts display loan details fetched live from the database at print time. If the loan's interest rate or customer name is later edited, reprinting the receipt shows the updated values — not the values at time of transaction.

**Prevention:**
- When generating a receipt (disbursement or repayment), snapshot the relevant values into the receipt record at creation time: `principal_at_disbursement`, `rate_at_disbursement`, `interest_paid`, `principal_paid`, `balance_after`. The receipt table is immutable after creation.
- Receipt generation logic should read from the snapshot, not live loan data.

**Phase:** Address in Phase 2 (receipts). Treat receipts as immutable financial documents from day one.

---

### Pitfall 12: N+1 Queries in Dashboard and Reports

**What goes wrong:** The executive dashboard loads all active loans, then for each loan queries payments, then for each loan queries interest accruals. With 500 active loans, this is 1,500+ database queries per page load. The dashboard becomes unusable.

**Prevention:**
- Dashboard aggregates should be computed with SQL `GROUP BY` queries or materialized views — not application-layer loops.
- Write the dashboard data queries first (before the UI), verify they use indexes, and check query plans with `EXPLAIN ANALYZE`.
- Index foreign keys: `loan_id` on `payments`, `loan_id` on `interest_accruals`, `customer_id` on `loans`.

**Phase:** Address in Phase 3 (dashboard + reports). Write efficient queries from the start; don't optimize "later."

---

### Pitfall 13: Permissive Input Validation on Financial Fields

**What goes wrong:** The payment submission form accepts any number for payment amount. A loan officer enters a negative payment amount (`-5000`) due to a typo. The allocation logic subtracts from interest outstanding, effectively adding interest owed and reducing the balance in unexpected ways.

**Prevention:**
- Server-side validation (not just client-side): payment amount must be a positive number, greater than zero, less than a configurable maximum (e.g., 10x the original principal as a sanity check).
- Reject non-numeric, zero, and negative values with a clear error message before the amount touches any calculation logic.
- Add database-level check constraints: `CHECK (amount > 0)` on payment tables.

**Phase:** Address in Phase 2 (payment processing API). All financial input endpoints need strict server-side validation.

---

### Pitfall 14: Blacklisted Customer Status Not Blocking Loan Issuance

**What goes wrong:** A customer is marked `Blacklisted`. A new loan application is created for them (perhaps by a different loan officer who didn't check the status). The system allows it because the loan issuance form doesn't check customer status.

**Prevention:**
- Loan issuance flow must verify `customer.status === 'Active'` at two points: (1) when the loan application is created, and (2) when the disbursement receipt is printed/finalized.
- The API endpoint for creating a loan must reject the request if the customer is Blacklisted or Inactive, with a clear error message.

**Phase:** Address in Phase 2 (loan issuance workflow). This is a business rule, not a nice-to-have.

---

## Minor Pitfalls

---

### Pitfall 15: PDF Export Rendering Inconsistencies Across Environments

**What goes wrong:** PDF generation works in development but produces garbled characters, missing fonts, or broken layouts in production. This is especially common with Puppeteer/headless Chrome in containerized environments.

**Prevention:**
- Test PDF generation in the target production environment, not just locally.
- Use a server-side PDF library with explicit font embedding (e.g., `@react-pdf/renderer` with bundled fonts, or a service like Browserless rather than a locally installed Chrome).
- PDFs are generated server-side; never rely on browser `window.print()` for reports that need to be filed or emailed.

**Phase:** Address in Phase 4 (reports). Test in the actual hosting environment before presenting to client.

---

### Pitfall 16: Repayment Simulator Drift from Actual Calculation

**What goes wrong:** The simulator ("if borrower pays X, how many days left?") uses a slightly different formula than the actual daily interest cron. Over time, the simulator's projections diverge from the real balance. Borrowers are told they have 20 days left, but the actual cron accrues interest differently.

**Prevention:**
- The simulator must call the same service function that the cron uses for interest calculation — not a separate "approximation" function written for the UI.
- Write a test that runs the simulator for N days and then runs the actual cron for N days and verifies the outcomes match.

**Phase:** Address in Phase 3 (monitoring + risk tools). The cron calculation logic must be extracted to a shared, tested service before the simulator is built.

---

### Pitfall 17: Missing Database Indexes on Query-Critical Columns

**What goes wrong:** Filtering loans by status, sorting by due date, and finding overdue borrowers all perform sequential table scans as the loan portfolio grows. Queries that run in 50ms at launch run in 8 seconds with 10,000 loan records.

**Prevention:**
- At schema creation time, add indexes on: `loans.status`, `loans.due_date`, `loans.customer_id`, `loans.created_at`, `payments.loan_id`, `payments.created_at`, `interest_accruals.loan_id`, `interest_accruals.accrual_date`.
- Composite index on `(loan_id, accrual_date)` for the uniqueness constraint on daily accruals (also serves query performance).

**Phase:** Address in Phase 1 (schema design). Retrofitting indexes is easy, but designing the schema without them creates bad habits and hidden performance issues.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Schema design | Float columns for money | Use NUMERIC(15,2) or BIGINT; audit log table from day 1 |
| Auth + RBAC setup | UI-only role checks | Server-side middleware enforcing role on every API route |
| Cron job implementation | Double-execution accruing interest twice | Idempotency via unique constraint on (loan_id, accrual_date) |
| Payment processing | Race condition on concurrent payments | SELECT FOR UPDATE + idempotency key |
| Payment allocation | Business rule bypassed via direct DB access | Enforce via trigger or strict API-only access pattern |
| Interest calculation | Timezone mismatch causing off-by-one day | Single business timezone constant; DATE type not TIMESTAMP |
| Loan issuance | Minimum interest period not enforced concurrently | Transactional check with pessimistic lock |
| Receipts | Live data on reprinted receipts | Immutable snapshot at creation time |
| Status management | Free-form status updates bypassing state machine | Server-side transition guard; status derived from financial state |
| Creditor module | Shared code entangling creditor and borrower logic | Separate tables and service modules; shared math function only |
| Dashboard/reports | N+1 query patterns | SQL aggregation; indexes in place before reports are built |
| PDF export | Environment-specific rendering failures | Test in production environment before client demo |
| Repayment simulator | Divergence from actual cron formula | Simulator calls the same service function as the cron |
| Clerk webhooks | Lost login events on handler failure | Fast-insert queue pattern; async processing; 200 immediately |

---

## Sources

- Domain knowledge: IEEE 754 floating-point specification (known limitation of JavaScript `number` type) — HIGH confidence
- PostgreSQL NUMERIC vs FLOAT behavior: PostgreSQL documentation — HIGH confidence
- Clerk webhook delivery behavior (retries, failures): consistent with webhook delivery patterns across major providers — MEDIUM confidence (could not verify Clerk-specific retry count without web access)
- Cron idempotency patterns: standard distributed systems practice — HIGH confidence
- Payment allocation race conditions: standard database transaction isolation patterns — HIGH confidence
- Timezone handling issues in financial systems: well-documented class of bugs in financial software — HIGH confidence
- All patterns validated against PROJECT.md requirements — findings are specific to this system's stated constraints (PostgreSQL, Next.js, Clerk, daily cron)
