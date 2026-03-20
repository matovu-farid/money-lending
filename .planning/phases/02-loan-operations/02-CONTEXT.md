# Phase 2: Loan Operations - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Payment processing with interest-first allocation, minimum period enforcement, disbursement and repayment receipt generation, and email alerts on every financial event. This completes the core daily transaction loop — a loan officer can record a payment and hand the borrower a printed receipt.

Requirements: LOAN-06, LOAN-07, LOAN-08, LOAN-09, RCPT-01, RCPT-02, RCPT-03, ALRT-02, INFR-04

</domain>

<decisions>
## Implementation Decisions

### Payment Edit/Delete Policy
- **Soft delete only** — deleted payments keep their row with a `deleted_at` timestamp. Never hard-deleted.
- **UI display:** Deleted payments appear crossed out in the payment list — no data is ever truly hidden from the user.
- **Permissions:** The Loan Officer who recorded the payment can edit/delete it. Admins can edit/delete any payment. (Matches the "same role that created + admin override" pattern.)
- **Auto-recalculate:** Editing or deleting a payment triggers automatic recalculation of all subsequent payments' interest/principal split and balances. Ensures financial consistency.
- **Reason required:** Every edit and delete requires a reason/note before confirming. Stored in the audit log alongside before/after values for accountability.

### Receipt Generation
- **Technology:** Browser print with `@media print` CSS. No PDF library needed. Dedicated receipt page with print-optimized layout.
- **Print trigger:** Manual — after loan issuance or payment recording, show a success state with a "Print Receipt" button. No auto-opening print dialogs.
- **Disbursement receipt fields:** Business name/logo, date, customer name & contact, loan amount (UGX), interest rate, minimum interest period, collateral details, issued-by officer name, unique receipt number.
- **Repayment receipt fields:** Business name/logo, date, customer name, loan reference, payment amount, interest paid, principal paid, outstanding balance after payment, received-by officer name, receipt number.
- **RCPT-03 enforcement:** Receipt print button is disabled (with clear message) if any required customer, loan, or payment detail is missing.

### Claude's Discretion
- Payment recording form layout and field ordering
- Receipt page styling, spacing, and typography within the print-optimized layout
- Email notification HTML template design and copy
- Success/error toast messaging after payment operations
- The INFR-04 cron job implementation approach (lightweight scheduled job for overdue detection)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 2 covers: LOAN-06, LOAN-07, LOAN-08, LOAN-09, RCPT-01, RCPT-02, RCPT-03, ALRT-02, INFR-04

### Phase 1 context (upstream decisions)
- `.planning/phases/01-foundation/01-CONTEXT.md` — Loan Ledger Model section defines payment allocation logic (interest-first), payment table columns, daily rate formula, minimum interest rule, and days overdue formula. This is the financial engine Phase 2 builds on.

### Project constraints
- `.planning/PROJECT.md` — Constraints section: BigNumber arithmetic, Effect.js services, NUMERIC(15,2), Resend for email, perpetual loans (no due dates)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db/schema/payments.ts` — Payment table schema already defined with `interest_portion`, `principal_portion`, `principal_balance_before`, `principal_balance_after` columns. Needs `deleted_at`, `deleted_by`, `delete_reason` columns added for soft delete.
- `src/lib/interest/engine.ts` — `calculateInterest()`, `calculateDailyRate()`, `formatAmount()` ready for payment allocation logic. `calculateDaysOverdue()` available for overdue detection cron.
- `src/services/audit.service.ts` — `writeAuditLog(tx, entry)` pattern for in-transaction audit logging. Extend for payment CUD with reason field.
- `src/services/loan.service.ts` — `createLoan()` pattern (atomic tx with audit log) to follow for payment service.
- `src/lib/errors.ts` — Effect.js tagged errors. Add `PaymentNotFound`, `InsufficientPaymentData`, `ReceiptBlockedError` etc.
- `src/lib/auth.ts` — Resend already initialized. Extract email sending into a shared utility for reuse in payment alert emails.

### Established Patterns
- Effect.js services return `Effect<S, E, never>` with db closed over (Phase 1 deferral — no Context.Tag/Layer yet)
- `writeAuditLog` is plain async (not Effect) — called with `await` inside Drizzle tx callbacks
- Server Actions preferred over Route Handlers (user feedback)
- No Zod in Server Actions — TypeScript types + runtime guards

### Integration Points
- Payment recording UI integrates into the loan detail page (from Phase 1 loans list)
- Receipt pages are standalone routes (`/receipts/disbursement/[loanId]`, `/receipts/repayment/[paymentId]`) optimized for `@media print`
- Email alerts use existing Resend instance from `src/lib/auth.ts` — extract to `src/lib/email.ts`
- INFR-04 cron job for overdue detection — new scheduled endpoint or external trigger

</code_context>

<specifics>
## Specific Ideas

- Deleted payments should appear crossed out in the payment list — "no data is ever truly lost" is a core principle for this financial system
- Reason/note for edits and deletes creates a clear accountability trail — important for a lending business where every shilling must be accounted for

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-loan-operations*
*Context gathered: 2026-03-20*
