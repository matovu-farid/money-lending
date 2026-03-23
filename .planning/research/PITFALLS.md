# Domain Pitfalls

**Domain:** Payments page (global list, daily collections, quick-record) added to existing perpetual lending system
**Researched:** 2026-03-23
**Milestone context:** v1.1 — adding standalone Payments feature on top of shipped v1.0

---

## v1.1 Milestone Pitfalls

Pitfalls specific to adding a global payments view, daily collections summary, and quick-record workflow to the existing system. All findings are grounded in the v1.0 codebase.

---

## Critical Pitfalls

Mistakes that cause data corruption, financial inconsistency, or require rewrites.

---

### Pitfall 1: Soft-Delete Blindness in the Global Payments Query

**What goes wrong:** A global payments query that omits `isNull(payments.deletedAt)` silently includes soft-deleted payments in totals, the payments list, and daily collection summaries. Staff see voided payments in live figures and act on stale numbers.

**Why it happens:** The existing `getPaymentsForLoan` deliberately includes deleted rows — they appear with strikethrough on the loan-detail page (per LOAN-07). A developer copying that function for the new global list carries over the intent without noticing the different requirement. The v1.0 codebase intentionally has two patterns in the same service file:
- `getPaymentsForLoan` — fetches ALL rows (including deleted) for the per-loan history view.
- `recordPayment` / `recalculateFromPayment` — filters `isNull(payments.deletedAt)` for financial calculations.

The global list and daily collections always need the calculation pattern, never the history pattern.

**Consequences:** Over-counted collection totals; deleted payments appear without the per-loan context that explains why they exist; financial summaries are wrong.

**Prevention:**
- The new global-list and daily-collections service functions must explicitly use `isNull(payments.deletedAt)`.
- If deleted payments need to be visible globally (admin audit view), render them with a visual flag and always exclude them from aggregated totals.
- Add a code comment on `getPaymentsForLoan` noting it intentionally includes deleted rows, so the contrast with the global-list function is explicit.

**Detection:** Integration test: record a payment, soft-delete it, assert it does not appear in the global list count and does not contribute to daily totals.

**Phase:** Phase 1 — Global Payments List.

---

### Pitfall 2: Date-Grouping Bug in Daily Collections (UTC vs. Local Calendar Day)

**What goes wrong:** `paymentDate` is `timestamp with timezone`. The existing `record-payment-form.tsx` appends `"T00:00:00.000Z"` to the date string (line 53) — UTC midnight. A payment recorded as "2026-03-23" in Kampala (UTC+3) is stored as `2026-03-22T21:00:00+00:00`. PostgreSQL's `DATE(payment_date)` returns `2026-03-22` — one day behind what the loan officer entered. Every payment in the daily collections view appears under the wrong date.

**Why it happens:** The UTC-midnight pattern was chosen for consistency in v1.0. It worked for the loan-detail view (which shows the date portion as entered by the officer). A new grouping query using bare `DATE(payment_date)` breaks under this convention.

**Consequences:** Daily collections show the wrong date bucket for every payment. Staff cannot reconcile paper collection sheets against the app.

**Prevention:** Two consistent options:
1. **Group using timezone-aware cast** — `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` in all grouping queries.
2. **Store date-only** — migrate `paymentDate` to a `DATE` column (no timezone). Eliminates the problem permanently. Heavier migration work.

Given the system is single-location (Uganda), Option 1 is the lower-risk path for this milestone. If chosen, the `AT TIME ZONE 'Africa/Kampala'` cast must appear in every grouping query; never use bare `DATE(payment_date)`.

**Detection:** Record a payment for today. Verify the daily collections view shows it under today, not yesterday. Run the test at 23:00 local time when the UTC-vs-local gap is most visible.

**Phase:** Phase 2 — Daily Collections View.

---

### Pitfall 3: revalidatePath Scope Too Narrow After Quick-Record

**What goes wrong:** The existing `recordPaymentAction` calls `revalidatePath('/loans/${input.loanId}')`. When quick-record fires from the Payments page, this revalidation does not touch the Payments page or the daily collections view. The quick-record dialog closes with a success toast, but the global payments list does not update.

**Why it happens:** The Server Action was written for the loan-detail flow. Path revalidation is point-in-time and scoped to listed paths. Adding a new entry point does not expand the revalidation set.

**Consequences:** The payments list appears stale after quick-record. Loan officers see old data and doubt the system's reliability.

**Prevention:**
- Extend `recordPaymentAction` to also call `revalidatePath('/payments')`.
- If TanStack Query powers the payments list, also call `queryClient.invalidateQueries({ queryKey: ["payments"] })` in the mutation's `onSuccess` callback (but revalidatePath is still required for Server Component segments).
- Define a shared constant listing all paths that must be revalidated after any payment mutation, so the set is maintained in one place.

**Phase:** Phase 3 — Quick-Record Workflow.

---

### Pitfall 4: No Loan-Active Guard in Quick-Record

**What goes wrong:** The quick-record loan selector searches across all loans. If a `fully_paid` loan is selected, the system accepts the payment: `recordPayment` in the service layer checks only for `LoanNotFound`, not for `status === 'fully_paid'`. The cascade recalculation runs. The balance updates. But the loan was already closed.

**Why it happens:** The existing per-loan record-payment flow starts from the loan detail page where the status badge is prominently displayed — there is an implicit status context. Quick-record abstracts away that context entirely.

**Consequences:** Financial records show payments against closed loans. The loan status may flip back to `active` (which `recalculateFromPayment` does not do) or remain `fully_paid` while showing a non-zero balance — an inconsistent state that confuses the loan detail view.

**Prevention:**
- Filter the loan search in quick-record to only return `status = 'active'` loans.
- Add a server-side guard in `recordPaymentAction`: if `loan.status === 'fully_paid'` return `{ error: "Cannot record a payment against a fully paid loan" }`. The UI filter is UX; the server guard is enforcement.

**Phase:** Phase 3 — Quick-Record Workflow.

---

### Pitfall 5: Double-Submission of Quick-Record Form

**What goes wrong:** A fast double-click on the quick-record submit button sends two identical payment mutations. The first inserts the payment and updates the balance. The second reads the already-updated balance, re-runs `allocatePayment` with the new principal balance, and inserts a second valid payment — recording an unintended extra payment, firing `autoPostInterestEarned` twice, and potentially marking the loan `fully_paid` prematurely.

**Why it happens:** The existing `RecordPaymentForm` disables the button via `disabled={isPending}`. A new quick-record dialog built from scratch may not copy this guard faithfully, especially if the developer uses a different state management pattern.

**Consequences:** Duplicate payment entries. Incorrect loan balance. Duplicate interest auto-posted to the transaction log. Requires admin delete cascade to fix, which itself triggers another cascade recalculation.

**Prevention:**
- Copy the `disabled={isPending}` pattern on the submit button and all form inputs verbatim from the existing `RecordPaymentForm`.
- Keep `useTransition` as the pending state mechanism — it is already the project standard.
- Deeper defense: check for a recent duplicate before inserting (`same loanId + amount + paymentDate + recordedBy` within a 60-second window) and return an error rather than inserting.

**Phase:** Phase 3 — Quick-Record Workflow.

---

### Pitfall 6: N+1 Queries for Customer and Loan Name Enrichment

**What goes wrong:** Payments need to display customer name and loan reference in the global list. The naïve approach: fetch all payments, then loop and call a per-payment query for the loan, then per-loan for the customer. With 200 payments this is 401+ queries per page load.

**Why it happens:** The existing `getPaymentsForLoan` returns bare payment rows — customer name is not needed there (the loan context is already on the page). The global list requires enrichment that was never needed in v1.0. The dashboard service `getDashboardKPIs` already demonstrates this anti-pattern (N queries for N active loans with a nested payments fetch per loan).

**Consequences:** The global payments list times out or loads in 8+ seconds.

**Prevention:**
- Write a single JOIN query: `payments LEFT JOIN loans ON payments.loan_id = loans.id LEFT JOIN customers ON loans.customer_id = customers.id`.
- In Drizzle: chain `.leftJoin(loans, eq(payments.loanId, loans.id)).leftJoin(customers, eq(loans.customerId, customers.id))` and select only the needed columns.
- Never fetch bare payments and enrich in a for-loop.

**Phase:** Phase 1 — Global Payments List.

---

## Moderate Pitfalls

---

### Pitfall 7: TanStack Query Cache Key Fragmentation

**What goes wrong:** The payments list uses `queryKey: ["payments"]`. The daily collections component uses `queryKey: ["payments", "daily", date]`. Invalidating `["payments"]` after a quick-record mutation DOES invalidate `["payments", "daily", date]` by prefix matching (TanStack Query v5 default). However, if a developer uses a different root key (e.g., `["dailyCollections", date]`) or wraps the daily fetch in a separate hook with an unrelated key, invalidation breaks silently.

**Prevention:**
- Define a shared query key factory before writing any payment queries: `paymentsKeys = { all: () => ["payments"] as const, daily: (date: string) => ["payments", "daily", date] as const }`.
- All payment-related queries use this factory. Invalidating `paymentsKeys.all()` propagates to all subkeys.
- Do not use a different top-level key for data that derives from the payments table.

**Phase:** Phase 2 — Daily Collections View.

---

### Pitfall 8: Loan Search in Quick-Record Loads All Active Loans on Mount

**What goes wrong:** The loan selector in quick-record calls `listLoansAction()` which returns every active loan with customer name. On a business with 300 active loans this is an unnecessarily large payload loaded into a combobox that is difficult to navigate.

**Prevention:**
- The loan search must be a debounced server-side search: query `status = 'active'` loans where `customerName ILIKE '%{query}%'`, limit 10 results, triggered only when the user types at least 2 characters.
- Do NOT load all active loans on mount. An empty search state should show a prompt ("Type to search loans"), not a full list.

**Phase:** Phase 3 — Quick-Record Workflow.

---

### Pitfall 9: Daily Collections Aggregation Using Native Float

**What goes wrong:** The daily collections view sums payment amounts for display (e.g., "Total collected today: UGX 4,500,000"). A developer uses `payments.reduce((sum, p) => sum + parseFloat(p.amount), 0)`. For UGX amounts in the millions, `parseFloat` introduces floating-point errors that surface as display artifacts.

**Why it happens:** `payment.amount` is a NUMERIC string from Drizzle. The project rule is "BigNumber.js for all monetary calculations — native floats forbidden," but this rule is easy to overlook in a display-only aggregation context.

**Consequences:** UGX 4,500,000 displays as UGX 4,499,999.98. Staff distrust the system.

**Prevention:**
- Sum using BigNumber: `payments.reduce((sum, p) => sum.plus(p.amount), new BigNumber(0))`.
- Alternatively, push the aggregation to SQL (`SUM(amount)` in Postgres) and format the returned NUMERIC string — no client-side float.

**Phase:** Phase 2 — Daily Collections View.

---

### Pitfall 10: Receipt Link After Quick-Record Uses Wrong ID

**What goes wrong:** After a successful quick-record, a "Print Receipt" link is offered. The existing repayment receipt route is `/receipts/repayment/[paymentId]`. If the success callback uses `data.loanId` instead of `data.id`, the receipt 404s.

**Why it happens:** The existing per-loan record-payment form redirects to `/loans/${loanId}` — no receipt link in that flow. Quick-record adds receipt printing for the first time in this flow. The developer writes the link fresh and confuses the two IDs.

**Prevention:**
- After `recordPaymentAction`, the returned `data` is the payment row: `data.id` is the payment UUID, `data.loanId` is the loan UUID.
- Receipt link: `/receipts/repayment/${data.id}` — confirm against `src/app/(app)/receipts/repayment/[paymentId]/page.tsx`.

**Phase:** Phase 3 — Quick-Record Workflow.

---

## Minor Pitfalls

---

### Pitfall 11: Date Range Filter Off-by-One (Last Day Excluded)

**What goes wrong:** A date range filter for "up to March 23" sets `end = 2026-03-23T00:00:00Z` (midnight). Payments recorded on March 23 at any time after midnight are excluded.

**Prevention:** Set the end-date filter to `2026-03-23T23:59:59.999Z` (end of day), or use `lt(payments.paymentDate, nextDayStart)` — exclusive upper bound of the following day.

**Phase:** Phase 1 — Global Payments List.

---

### Pitfall 12: Ambiguous "Amount" Column (Total vs. Principal)

**What goes wrong:** The global list shows "Amount." Staff assume this is the principal repaid. `payment.amount` is the total received (interest + principal). A payment of UGX 150,000 where UGX 120,000 goes to interest shows "150,000" but the loan only went down by 30,000. Staff read it as a 150,000 reduction.

**Prevention:** Label the column "Total Received." Show `interestPortion` and `principalPortion` as sub-columns or in a hover tooltip. The loan-detail page already renders this split — reuse that pattern.

**Phase:** Phase 1 — Global Payments List.

---

### Pitfall 13: No Pagination on the Global Payments List

**What goes wrong:** A business running for a year may have 2,000+ active payment records. Fetching all of them renders a table that freezes the browser and saturates the Server Action response.

**Prevention:** The global payments service function must accept `limit` and `offset` from the start. Build pagination into the initial Server Action signature — retrofitting it later requires changing query keys, invalidation logic, and the action signature simultaneously.

Start with limit=50. Add a total count query for page controls.

**Phase:** Phase 1 — Global Payments List.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Global list query | Soft-deleted payments included (Pitfall 1) | Always filter `isNull(deletedAt)` |
| Global list query | N+1 customer/loan enrichment (Pitfall 6) | Single JOIN from the start |
| Global list UX | Missing pagination (Pitfall 13) | Pagination baked into the initial Server Action |
| Global list UX | Ambiguous "Amount" column (Pitfall 12) | Label as "Total Received," show split on hover |
| Global list filter | Date range off-by-one (Pitfall 11) | End-of-day upper bound |
| Daily collections grouping | UTC vs. local calendar day (Pitfall 2) | Use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` in grouping queries |
| Daily collections math | Native float summation (Pitfall 9) | BigNumber.js or SQL SUM |
| Daily collections cache | Query key fragmentation (Pitfall 7) | Shared query key factory before first hook is written |
| Quick-record form | Double submission (Pitfall 5) | Copy `disabled={isPending}` pattern verbatim |
| Quick-record form | No loan status guard (Pitfall 4) | Filter search to active loans + server-side status check |
| Quick-record form | Loan search loads all (Pitfall 8) | Debounced server-side search, limit 10 |
| Quick-record success | Receipt link wrong ID (Pitfall 10) | Use `data.id`, not `data.loanId` |
| Quick-record mutation | revalidatePath too narrow (Pitfall 3) | Add `/payments` to revalidation set |

---

## Sources

- Codebase: `src/services/payment.service.ts` — two intentional soft-delete patterns: `getPaymentsForLoan` (includes deleted) vs. `recordPayment` (excludes deleted)
- Codebase: `src/actions/payment.actions.ts` — existing `revalidatePath` scope, permission guards
- Codebase: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` — UTC midnight date construction (`"T00:00:00.000Z"` pattern)
- Codebase: `src/services/dashboard.service.ts` — N+1 anti-pattern example in `getDashboardKPIs`
- Codebase: `src/lib/interest/engine.ts` — `allocatePayment` floors balance at zero via `BigNumber.max`
- Codebase: `src/lib/db/schema/payments.ts` — NUMERIC(15,2) monetary columns, `deletedAt` soft-delete field
- Codebase: `src/lib/db/schema/loans.ts` — `loanStatusEnum("active" | "fully_paid")`
- [Next.js timezone handling in date grouping — GitHub Discussion #37877](https://github.com/vercel/next.js/discussions/37877) — MEDIUM confidence
- [TanStack Query v5 invalidation from mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations) — HIGH confidence
- [Drizzle ORM joins documentation](https://orm.drizzle.team/docs/select) — HIGH confidence
- [Prevent double form submissions — OpenReplay](https://blog.openreplay.com/prevent-double-form-submissions/) — MEDIUM confidence

---

## v1.0 Foundation Pitfalls (Retained for Reference)

The following pitfalls were documented during v1.0 research. They are already addressed in the shipped codebase. They are retained here as reference because they inform why certain v1.1 patterns must be followed exactly.

- **Float arithmetic** — Addressed: BigNumber.js used throughout, NUMERIC(15,2) in DB.
- **Soft-delete pattern** — Addressed: `deletedAt` on payments, `isNull` filter in all financial queries (guard for v1.1 — see Pitfall 1 above).
- **Cascade recalculation** — Addressed: `recalculateFromPayment` runs inside the same DB transaction.
- **Audit trail** — Addressed: `writeAuditLog` called in every payment mutation.
- **Interest-first allocation** — Addressed: `allocatePayment` pure function, tested.
- **Loan status as derived state** — Addressed: `fully_paid` set only by payment service, never by direct status update.
- **Role-based access** — Addressed: permission checks in Server Actions, not just UI.
