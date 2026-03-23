# Feature Landscape

**Domain:** Payments page — global payments list, daily collections view, quick-record workflow
**Researched:** 2026-03-23
**Milestone context:** v1.1 — adding standalone Payments section to existing lending management app (v1.0 already shipped)
**Confidence:** HIGH for table stakes (informed by existing codebase + domain patterns); MEDIUM for differentiators (informed by microfinance UX research)

---

## Scope Boundary

This file covers ONLY the new features for v1.1. Existing payment features (record, edit, delete, history in loan detail, receipts, simulator) are NOT re-examined here. Research focuses on what is needed to make payments a first-class, globally accessible section.

---

## Table Stakes

Features users expect from a payments page. Missing = the page feels like a stub or is operationally unusable.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Global paginated payments list | Payments are currently only visible inside individual loan pages. Staff need to see all payments across all loans in one place — audits, disputes, end-of-day reconciliation all require this | Medium | `getPaymentsForLoan` exists but is loan-scoped; need a new `listAllPayments` query joining `payments → loans → customers` |
| Search by customer name | Loan officers handle many borrowers; finding a specific customer's payment history by name is the fastest lookup path | Low | `customers.fullName` available via join; no full-text index needed for initial scale |
| Filter by date range | Daily collections reconciliation, monthly reporting — staff filter to "today" or a specific week constantly | Low | `payments.paymentDate` column exists; date range WHERE clause |
| Filter by loan status | Distinguishes payments on active vs fully-paid loans — relevant for collections focus | Low | `loans.status` enum available via join |
| Columns: date, customer name, loan ID, amount, interest portion, principal portion, balance after | These are the columns a loan officer needs to answer "what did borrower X pay, and how was it applied?" | Low | All fields exist in `payments` schema (`interestPortion`, `principalPortion`, `principalBalanceAfter`) |
| Navigate to source loan from payment row | Every payment row must be a gateway to the full loan detail — staff need context (balance, history) | Low | Link to `/loans/[loanId]` |
| Empty state with call to action | Page must not be a blank void when no payments exist or filters return nothing | Low | No existing dependency |
| Deleted payment visibility (with indicator) | The system uses soft-deletes (`deletedAt`). Admins need to see voided payments to audit for fraud or reconcile discrepancies | Medium | `payments.deletedAt` exists; show with visual indicator (strikethrough/badge), hide by default, admin-only toggle |

---

## Daily Collections View

A specific sub-view answering the question: "What needs to be collected today and what has already come in?"

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Summary header: total collected today (UGX) | Loan officers start the day with a cash target; this metric is the first thing they check at end of day | Low | SUM of `payments.amount` where `paymentDate = today` |
| List of payments recorded today | Confirms what has already been entered for the current date — avoids double-recording | Low | Filter `paymentDate = today` on the global list |
| "Due today" section — loans where last payment was 30+ days ago | The business model is 30-day cycles. A loan that has not received a payment in 30+ days has an overdue borrower. Collections view surfaces exactly who to chase | High | Requires computing "days since last payment" per active loan — joins `payments` and `loans`, aggregates last payment date per loan. No existing query for this. |
| Count of loans due today | Single number the loan officer can track as a daily target | Low | Derived from "due today" query |

---

## Quick-Record Payment Workflow

Currently recording a payment requires: navigate to Loans → click a loan → navigate to payments/new page. Quick-record eliminates this navigation chain.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Loan selector (search by customer name or loan ID) | The first step of quick-record is picking which loan the payment is for — must support searching since staff won't remember UUIDs | Medium | Reuse customer search patterns; query active loans with customer name; no existing global loan search combobox |
| Inline payment form (modal or slide-over) | Once a loan is selected, the form fields appear without a page navigation — amount, date, optional note — matches the existing form's fields | Low | Reuse `recordPaymentAction` Server Action directly; form structure mirrors existing `RecordPaymentForm` |
| Live balance preview before submit | After entering amount, show projected balance after payment — builds confidence and catches data entry errors | Medium | Reuse interest calculation engine; the simulator (`simulatorPanel`) has this logic already |
| Receipt link after successful submission | Every recorded payment must offer a path to print the receipt — matches existing post-record UX on the loan detail page | Low | Existing receipt page at `/receipts/repayment/[paymentId]` |
| Return to context (payment list or collections) | After recording, the user stays in the Payments section — not bounced to the loan detail page (which is what the current form does) | Low | Change redirect target from `/loans/[loanId]` to `/payments` |

---

## Differentiators

Features not universally expected but materially improve the payments section for loan officers in a cash-based microfinance context.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Collections progress bar (today: X collected / Y expected) | Gives officers a motivating daily target — visual progress is more scannable than two numbers | Low | Requires "due today" total + "collected today" total; both derivable from existing data |
| "Days since last payment" column in collections due view | Makes urgency immediately legible — a borrower at 45 days is more urgent than one at 31 days | Low | `CURRENT_DATE - MAX(paymentDate)` per loan, or `CURRENT_DATE - loans.startDate` if no payments |
| Sticky date filter defaulting to today | The page most commonly opens to answer "what happened today?" — defaulting to today removes the most common filter interaction | Low | URL search param with today as default; can be overridden |
| Export daily collections to PDF | End-of-day paper summary for the business owner who is not always on the system — matches existing PDF export patterns | Medium | Reuse `pdf.service.ts`; new template for daily collections; optional in v1.1 |

---

## Anti-Features

Features that appear useful for a payments page but should be explicitly excluded.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Bulk payment recording (multiple loans at once) | Appears efficient for busy collection days, but each payment requires interest-first allocation which is sequential and depends on prior balance — bulk entry creates ordering ambiguity and audit complexity | Record payments one at a time via quick-record; the form is fast enough |
| Inline edit directly in the payments table | Payment editing is already handled with a reason-required flow on the loan detail page. Inline edits in a global list bypass the reason field and audit expectations | Link to existing edit flow on loan detail; do not add a second edit entry point |
| Payment categorization / type tags (cash, transfer, etc.) | Not in the existing schema (`payments` has no payment_method column); adding it now means a migration and UX complexity without a stated business need | Out of scope for v1.1; add if a real need surfaces post-launch |
| Scheduled/expected payment forecast list | Perpetual reducing-balance loans have no fixed schedule — the "next payment" amount is not predetermined (borrowers can pay any amount at any time). A schedule view would show fabricated numbers | Use the repayment simulator for projections; do not create a fake schedule |
| Overdue status badge on payment rows | A payment row records what happened (money received), not the loan's current overdue state. Adding overdue state to payment rows conflates two concerns | Overdue state belongs on the loan/customer/watchlist views; not on the payment transaction log |

---

## Feature Dependencies

```
Existing (v1.0)
  recordPaymentAction (Server Action)
  getPaymentsForLoan (service, loan-scoped)
  payments schema (id, loanId, paymentDate, amount, interestPortion, principalPortion, principalBalanceBefore, principalBalanceAfter, recordedBy, deletedAt)
  loans schema (id, customerId, status, startDate, principalAmount, interestRate)
  customers schema (id, fullName)
  /receipts/repayment/[paymentId] (receipt page)
  allocatePayment (interest engine)

New for v1.1
  listAllPayments query
    → joins: payments → loans → customers
    → filters: date range, customer name search, loan status
    → pagination
    → soft-delete toggle (admin only)

  Daily collections query
    → payments where paymentDate = today (collected today list + sum)
    → active loans where no payment in last 30 days OR days since last payment >= 30 (due today list)
    → requires: MAX(paymentDate) per loan aggregate

  Quick-record flow
    → listActiveLoans with customer name (combobox search)
    → recordPaymentAction (reuse — no changes needed)
    → post-success: redirect to /payments (not /loans/[loanId])
    → optional: pre-submit balance preview using existing interest engine

  Receipt link in quick-record
    → /receipts/repayment/[paymentId] (existing — no changes needed)
```

---

## MVP Recommendation for v1.1

The three target features should ship as a single coherent payments section.

**Phase 1 — Global payments list (foundation everything else depends on):**
1. `listAllPayments` service function with join, filters, pagination
2. `/payments` page with table, search, date filter, loan status filter
3. Navigate-to-loan link per row
4. Admin-only deleted payment toggle

**Phase 2 — Daily collections view (builds on list infrastructure):**
5. Collections summary header (total collected today, count due today)
6. "Due today" list (active loans, 30+ days since last payment)
7. Today filter as default URL state

**Phase 3 — Quick-record workflow (highest operational value):**
8. Active loan combobox search (by customer name)
9. Inline payment form (modal) reusing `recordPaymentAction`
10. Post-record redirect back to `/payments`
11. Receipt link in success state

**Defer from v1.1:**
- Daily collections PDF export — useful but not blocking
- Live balance preview in quick-record — nice-to-have; simulator already exists for this purpose
- Collections progress bar — low complexity but depends on "due today" count being reliable first

---

## Commonly Forgotten in Payments List Pages

| Forgotten Feature | Why It Gets Missed | Impact When Missing |
|------------------|--------------------|---------------------|
| Soft-deleted payment visibility (admin only) | Developers build the happy path; deleted records are filtered out globally and never surfaced | Admin cannot audit voided payments; fraud detection is blind |
| Date filter defaults to today (not all-time) | Default is left as "all records"; page loads slowly and shows irrelevant historical data | Officers see hundreds of old records before today's activity; collections workflow is broken |
| Loan combobox must filter to active loans only | Quick-record combobox shows all loans including fully_paid; officer records against a closed loan | Payment recorded on a closed loan; balance goes negative or errors silently |
| Pagination on global list | First implementation works fine with 50 payments; no one tests with 500+ | Page times out or becomes unusable as portfolio grows |
| "No results" state for filtered queries | Filter applied, nothing matches — blank table with no explanation | Officer assumes the page is broken; support ticket raised |
| Receipt link after quick-record success | The existing per-loan payment form redirects to loan detail which has the receipt button. Quick-record bypasses this; receipt link must be explicit in the success toast or dialog | Payment recorded but officer cannot print receipt; borrower goes unreceipted |

---

## Sources

- **HIGH confidence:** Existing codebase (`payments` schema, `payment.service.ts`, `record-payment-form.tsx`, `loans/page.tsx`) — directly inspected 2026-03-23
- **HIGH confidence:** PROJECT.md requirements doc (Money_Lending_App_Requirements.docx v1.0, Feb 16 2026) — v1.1 requirements explicitly stated
- **MEDIUM confidence:** Microfinance domain patterns — daily collections group-by-date workflow, due-today targeting, confirmed by Odoo Microfinance LMS and LoanBook field app descriptions
- **MEDIUM confidence:** Loan officer UX patterns — progressive disclosure, contextual quick-record, daily target dashboards — informed by Medium/Design Bootcamp loan officer triage article and HES FinTech servicing docs
- **LOW confidence:** Collections PDF export as differentiator — inferred from existing pdf.service.ts patterns in codebase; not validated with client
