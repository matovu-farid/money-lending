---
phase: quick-260722-loan-waiver
plan: 01
type: execute
wave: 1
depends_on: [feat/rolled-over-loan-visibility Phase 1]
# REQUIRED: import helpers from src/lib/loan-visibility.ts (assertLoanOperational,
# isTerminalLoanStatus / maybeUpdateLoanStatusAfterPayment). Do not re-implement
# raw status === "active" guards. Migration number: next free after visibility's
# 0027_loans_rolled_over_from_idx (likely 0028_loan_waivers.sql).
files_modified:
  - drizzle/0028_loan_waivers.sql
  - drizzle/meta/_journal.json
  - src/lib/db/schema/loan-waivers.ts
  - src/lib/db/schema/index.ts
  - src/types/loan-waiver.ts
  - src/types/index.ts
  - src/lib/validators.ts
  - src/services/category.service.ts
  - src/services/loan-waiver.service.ts
  - src/services/auto-post.service.ts
  - src/services/ledger-queries.service.ts
  - src/services/payment.service.ts
  - src/services/transaction.service.ts
  - src/services/loan.service.ts
  - src/services/activity.service.ts
  - src/services/report.service.ts
  - src/lib/interest/loanBalanceData.ts
  - src/lib/loan-statement.ts
  - src/lib/credit-score.ts
  - src/lib/cache-invalidation.ts
  - src/lib/permissions.ts
  - src/types/common.ts
  - src/actions/loan-waiver.actions.ts
  - src/collections/loan-waivers.ts
  - src/components/loans/waive-loan-dialog.tsx
  - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
  - src/lib/email.ts
  - src/services/__integration__/setup.ts
autonomous: true
requirements: [LOAN-WAIVER-01]

must_haves:
  truths:
    - "Admin can waive a partial amount of an active loan from the loan detail page"
    - "Waiver reduces outstanding principal and/or unpaid interest via ledger entries"
    - "Waiver allocation is interest-first, loan-type-aware (perpetual, fixed_rate, reducing_balance)"
    - "Interest waiver updates overdue/unpaid-interest calculations (not just ledger)"
    - "Waiver posts DR Loan Losses / CR Interest Earned and/or DR Loan Losses / CR Loans Receivable"
    - "Waiver requires a reason and is audit-logged"
    - "Non-admins cannot see or invoke the waiver action"
    - "Loan status becomes fully_paid only when all economic obligation is cleared (loan-type-aware)"
    - "Waiver journal entries are protected from manual deletion"
    - "Loan delete reverses waiver journals"
  artifacts:
    - path: "src/services/loan-waiver.service.ts"
      provides: "waiveLoanAmount service with ledger posting and allocation"
      exports: ["waiveLoanAmount"]
    - path: "src/actions/loan-waiver.actions.ts"
      provides: "Admin-only waiveLoanAmountAction"
      exports: ["waiveLoanAmountAction", "listLoanWaiversAction"]
    - path: "src/components/loans/waive-loan-dialog.tsx"
      provides: "Admin waiver dialog on loan detail"
    - path: "drizzle/0028_loan_waivers.sql"
      provides: "loan_waivers table + Loan Losses category seed"
  key_links:
    - from: "src/services/loan-waiver.service.ts"
      to: "src/lib/loan-visibility.ts"
      via: "assertLoanOperational guard before mutation"
      pattern: "assertLoanOperational"
    - from: "src/services/loan-waiver.service.ts"
      to: "src/services/payment.service.ts"
      via: "maybeUpdateLoanStatusAfterPayment on full economic payoff"
      pattern: "maybeUpdateLoanStatusAfterPayment"
    - from: "src/lib/interest/loanBalanceData.ts"
      to: "src/services/payment.service.ts"
      via: "getLastSettlementDate includes waiver dates"
      pattern: "getLastSettlementDate"
    - from: "src/services/loan-waiver.service.ts"
      to: "src/services/transaction.service.ts"
      via: "reverseInterestAccrual + postJournalEntry"
      pattern: "referenceType.*loan_waiver"
    - from: "src/collections/loan-waivers.ts"
      to: "src/lib/cache-invalidation.ts"
      via: "invalidateLendingProjections + emitTableChange"
      pattern: "emitTableChange"
---

<objective>
Add admin-only partial loan amount waiver on the loan detail page, with proper double-entry ledger posting and full integration into balance/overdue/reporting derivative calculations.

Purpose: Admins need to forgive part of a borrower's obligation (principal and/or interest) without a cash payment. Unlike penalty waiver (a flag only), this is a financial write-down that must flow through the ledger and every surface that derives loan balances.

Output: `loan_waivers` table, waiver service/action/collection, waiver dialog on loan detail, updated overdue/settlement date logic, statement/activity/report integration, and Cypress E2E coverage.
</objective>

<execution_context>
@/Users/faridmatovu/.claude/get-shit-done/workflows/execute-plan.md
@/Users/faridmatovu/.claude/get-shit-done/templates/summary.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-2.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-3-FINAL.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-6.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-7.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-8.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-9.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-10-FINAL.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-11.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-12-FINAL.md
@.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-13-FINAL.md
</execution_context>

<context>
@src/services/payment.service.ts
@src/services/collateral-settlement.service.ts
@src/services/auto-post.service.ts
@src/services/ledger-queries.service.ts
@src/lib/interest/engine-server.ts
@src/lib/interest/engine.ts
@src/lib/interest/loanBalanceData.ts
@src/lib/interest/overdue.ts
@src/actions/loan.actions.ts
@src/app/(app)/loans/[loanId]/loan-detail-client.tsx
@src/components/loans/settle-collateral-dialog.tsx
@src/app/(app)/loans/[loanId]/loan-info-cards.tsx
@src/lib/permissions.ts
@src/services/category.service.ts
@src/services/transaction.service.ts
@src/services/loan.service.ts
@src/lib/loan-statement.ts
@src/services/activity.service.ts
@src/services/report.service.ts
@src/lib/credit-score.ts
@src/collections/payments.ts
@src/lib/loan-visibility.ts
@src/collections/operational-loans.ts
@src/collections/loan-views.ts
@docs/superpowers/plans/2026-07-22-rolled-over-loan-visibility.md

<design_decisions>
1. **Allocation:** Interest-first, loan-type-aware. Do NOT reuse bare `allocateLoanPaymentServerSide` — extract shared `allocateLoanSettlementAmount` that dispatches by `loanType` using the same rules as `allocatePayment` in `engine.ts` (including fixed_rate early-payoff and min-interest-period floors).

2. **Ledger:**
   - Interest portion: `reverseInterestAccrual` first, then DR Loan Losses / CR Interest Earned (`referenceType: loan_waiver`, `referenceId: waiverId`)
   - Principal portion: DR Loan Losses / CR Loans Receivable (`referenceType: loan_waiver`, `referenceId: waiverId`)
   - Non-cash — no Cash leg

3. **Overdue fix (CRITICAL):** Rename/extend `getLastPaymentDate` → `getLastSettlementDate` to return MAX(payment_date, waiver_date) for non-deleted, non-wrong payments and non-deleted waivers. Feed this into `computeLoanOverdueInfo` via `loanBalanceData.ts`. Without this, interest waivers reduce ledger revenue but UI overdue/daysOverdue/cron/watchlist stay wrong.

4. **fully_paid criteria:**
   - perpetual / reducing_balance: ledger principal = 0 AND unpaid interest = 0
   - fixed_rate: same — must not mark fully_paid on principal-only zero while term interest remains (align with fixed_rate allocation rules)

5. **Permissions:** **`loan:waiver`** — granted only to `admin` and `superAdmin`. **Not** in `MANAGING_SUPERVISOR_ELEVATED`. Action uses `withAction({ permission: "loan:waiver" })` + UI uses `has("loan:waiver")`. Do **not** reuse `settings:update` (elevated supervisors must not waive).

6. **Immutability:** Waivers are append-only in v1. No soft-delete/reversal UI. `loan_waiver_reversal` reserved for `deleteLoan` cleanup only.

7. **Credit score policy:** Waivers do NOT improve timeliness score. Principal waiver may reduce outstanding balance for paydown score — document explicitly; do not treat waiver as payment behavior.

8. **Migration:** `0028_loan_waivers.sql` — next free after visibility's `0027_loans_rolled_over_from_idx.sql`.

9. **Visibility integration (shipped on `feat/rolled-over-loan-visibility`):**
   - Entry guard: `assertLoanOperational(loan)` from `src/lib/loan-visibility.ts` — blocks waivers on `fully_paid`, `rolled_over`, `settled_collateral`, etc.
   - Status transition: `maybeUpdateLoanStatusAfterPayment(tx, loan, "fully_paid", actorId)` from `src/services/payment.service.ts` — never raw `tx.update(loans).set({ status: "fully_paid" })`. Cancels pending rate-change requests on closure.
   - UI: reuse existing `readOnly = isLoanReadOnly(loan.status)` in `loan-detail-client.tsx`. Show "Waive Amount" when `!readOnly && has("loan:waiver")` — same pattern as Settle Collateral / Record Payment gates.
   - Balances: `computeLoanBalanceData` already zeros non-operational loans via `isOperationalLoan` (R19-3). Full waiver → `fully_paid` removes loan from `operationalLoanCollection` / watchlist automatically.
   - Cache: `invalidateLendingProjections` already invalidates `queryKeys.loans.operational`. Also subscribe `operational-loans.ts` to `loan_waivers` + `transactions` table changes (R21-1).
   - Pickers: `LoanSearchCombobox` already uses `useOperationalLoansWithBalances()` — Task 10 fixes display to `outstandingBalance` and drops redundant `status === "active"` filter.

## Product decisions (locked 2026-07-22)

| # | Question | Decision |
|---|----------|----------|
| 1 | Dashboard interest KPI on interest waiver | **Net margin** — show Interest Earned − Loan Losses (rename label/copy accordingly) |
| 2 | Who can waive? | **Admin-only** (`admin` + `superAdmin` via `loan:waiver`; not delegated supervisors) |
| 3 | Auto-reset penalty waiver when interest waiver zeros overdue? | **No** — see penalty reset rationale below |
| 4 | Show waivers on customer loan history? | **No** |
| 5 | Rename "Last Payment" → "Last Settlement"? | **No** — keep existing column labels |
| 6 | Waiver date / backdating? | **No backdating** — waiver posts **at creation time** (`waiverDate = now`, server-set). No date picker, no `validateBackdating`, no 3-day note. Admin waives then and there. |

### Penalty waiver reset — why it exists, and why waivers must not trigger it

**Why reset exists today:** When an admin waives the penalty rate on a loan that is 60+ days overdue, `penaltyWaived` suppresses the extra penalty multiplier. The overdue cron clears that flag when `daysOverdue === 0` so the **next** overdue episode can apply penalty automatically again. Without reset, a one-time admin penalty waiver would persist forever — even if the borrower falls 60+ days behind again later.

**Why interest waiver must not trigger reset:** An interest waiver is a **write-down**, not the borrower catching up via payment. If forgiving interest dropped `daysOverdue` to 0 and we ran the same reset logic, we would silently undo the admin’s separate penalty-waiver decision even though the borrower did not pay. **Implementation:** only reset `penaltyWaived` when the borrower reached 0 days overdue via a **payment** (last settlement event is a payment), not when overdue hit zero because of a waiver.
</design_decisions>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema, category seed, and types</name>
  <files>
    drizzle/0028_loan_waivers.sql,
    drizzle/meta/_journal.json,
    src/lib/db/schema/loan-waivers.ts,
    src/lib/db/schema/index.ts,
    src/types/loan-waiver.ts,
    src/types/index.ts,
    src/lib/validators.ts,
    src/services/category.service.ts,
    src/services/__integration__/setup.ts
  </files>
  <action>
1. Create `loan_waivers` table:
   - `id` uuid PK
   - `loan_id` FK → loans
   - `amount` numeric NOT NULL
   - `waiver_date` timestamptz NOT NULL
   - `reason` text NOT NULL
   - `recorded_by` FK → user
   - `deleted_at` timestamptz NULL (for deleteLoan cleanup only, not user-facing undo)
   - `created_at` timestamptz DEFAULT now()

2. Migration also INSERTs default category: `{ name: "Loan Losses", type: "expense", is_default: true }` ON CONFLICT DO NOTHING.

3. Add `"Loan Losses"` to `DEFAULT_EXPENSE_CATEGORIES` in `category.service.ts`.

4. Add types:
```typescript
export interface WaiveLoanAmountInput {
  loanId: string
  amount: string       // NUMERIC string, whole UGX
  reason: string
  // waiverDate: NOT client-supplied — service sets to now at submit (decision #6)
}
export type LoanWaiver = InferSelectModel<typeof loanWaivers>
```

5. Zod validator: amount > 0, reason min 10 chars, loanId uuid. **No `waiverDate` on input** (decision #6).

6. **Permissions:** Add `loan:waiver` to `PERMISSIONS` and `adminExtras` in `src/lib/permissions.ts` and `src/types/common.ts`. **Critical:** also add `p !== "loan:waiver"` to the `MANAGING_SUPERVISOR_ELEVATED` filter — `adminExtras` permissions are copied into elevation unless explicitly excluded (same trap as if `creditor:*` were not filtered). Grant only on `admin` / `superAdmin` role sets. Update `permissions.test.ts` expected catalog + length (R6-M1 / R7-M2).

7. Update `refresh_loan_balance()` in same migration (R2-C3):
   - `last_payment_date` = MAX(non-deleted payment dates, non-deleted waiver dates)
   - Add `AFTER INSERT OR UPDATE OR DELETE ON loan_waivers` trigger calling `refresh_loan_balance(loan_id)`
   - Name trigger/function consistently for `scripts/db-verify-triggers.ts` (R7-H2)
   - `outstanding_balance` still derives from transactions (unchanged)

8. **Integration setup (R8-H2, R12-M3):** Add `loan_waivers` to `resetDb()` TRUNCATE **before** `loans` in `setup.ts`. Extend `seedCategories()` with Loan Losses, Loans Receivable, Cash (categories waiver tests need).
  </action>
  <verify>
    <automated>npx drizzle-kit check 2>&1 | tail -10</automated>
  </verify>
  <done>Migration 0028 applies cleanly. Types and validators compile. Loan Losses category seeded in migration + category service defaults.</done>
</task>

<task type="auto">
  <name>Task 2: Settlement date fix + loan-type-aware allocation</name>
  <files>
    src/services/payment.service.ts,
    src/lib/interest/loanBalanceData.ts,
    src/lib/interest/engine-server.ts,
    src/lib/interest/engine.ts,
    src/services/__tests__/loan-waiver-allocation.test.ts
  </files>
  <action>
1. Add `getLastSettlementDate(loan)` and **`getLastSettlementEvent(loan)`** in `payment.service.ts`:
   - `getLastSettlementDate` = date of last settlement (MAX of payment/waiver dates)
   - `getLastSettlementEvent` = `{ kind: "payment" | "waiver"; date: Date }` — on same timestamp, **payment wins** (needed for penalty-reset guard, locked decision #3)
   - Query union of active payments + active waivers; fallback `loan.startDate`
   - Keep `getLastPaymentDate` as alias or replace all callers with settlement helpers

2. Update ALL callers of `getLastPaymentDate` to use `getLastSettlementDate`:
   - `computeLoanBalanceData` / `loanBalanceData.ts`
   - `computeOverdue` in `loan.service.ts` — use `balanceInfo.lastPaymentDate` for **both** overdue inputs **and** the returned `lastPaymentDate` field (R2-C1, R11-M1); NOT `loanPayments.at(-1)`
   - `markPaymentWrong` reallocation path in `payment.service.ts` (R2-H9)
   - `daily-collections.service.ts` (inherits via computeLoanBalanceData)

2b. **Point-in-time ledger (R10-C1):** In `computeLoanBalanceData`, pass `asOf` to `getLoanBalancesFromLedger`, `getRemainingPrincipalFromLedger`, and **`getInterestEarnedFromLedger` (add `asOf` param)**. Settlement helpers filter events with dates ≤ `asOf`. Required for **edit/unmark payment** historical allocate (R9-H4); waivers always use `asOf = now` (decision #6).

3. Extract `allocateLoanSettlementAmount(params)` in `engine-server.ts`:
   - Takes: amount, asOf, loanId, loanType, and balance info from `computeSingleLoanBalanceData`
   - Dispatches to same rules as `allocatePayment` in `engine.ts`:
     - perpetual: interest-first then principal
     - fixed_rate: respect remaining term interest on payoff
     - reducing_balance: interest-first on current outstanding
   - Include min-interest-period floor validation
   - Return `{ interestPortion, principalPortion, loanFullyPaid }` where `loanFullyPaid` requires BOTH principal = 0 AND unpaid interest = 0 (loan-type-aware)
   - **Refactor `allocateLoanPaymentServerSide` to call this shared helper** (R8-H1) — payments and waivers must not diverge
   - **Wire `interestAlreadyPaidInPeriod`** — param exists on current server allocator but is unused (`engine-server.ts`); `editPayment` computes it but does not pass it; **`unmarkPaymentWrong` omits it entirely** (R11-H2, R12-M1). Honor in shared helper; pass from edit + unmark; include same-period waiver interest portions.

4. Add **`isLoanEconomicallyFullyPaid(loanId, asOf, tx?)`** — ledger principal = 0 AND accrual unpaid interest = 0. Used by waiver service and all payment status transitions (R8-C1).

4b. **`markPaymentWrong` revert (R11-H1):** When reverting `fully_paid → active`, use `!isLoanEconomicallyFullyPaid` — not `ledgerBalance > 0` alone. Test: principal waiver → interest payment → mis-close → mark wrong → reverts to `active`.

5. Add batch **`getLastSettlementEventsForLoans(loanIds)`** for overdue cron (R8-M1) **and** batch-fetch in `computeLoanBalanceData` before the per-loan loop (R11-M3).

6. **`getLastSettlementDate(loan, { asOf? })` (R9-H4):** When `asOf` provided, MAX of payment/waiver dates **≤ asOf** (fallback `startDate`). “Today” balance paths omit `asOf`. Edit/unmark/repost pass `asOf = paymentDate`.

7. Unit tests for allocation across all three loan types + min-period edge case.

8. **Payment overpayment cap (R7-H1):** In `recordPayment` / edit / unmark paths, fixed_rate `totalOwed` monthly interest must use ledger `principalBalanceBefore`, not `loan.principalAmount`.

9. **Edit/unmark principal walk (R9-C2):** Reconstruct `principalBalanceBefore` by subtracting prior payment **and** prior waiver principal portions (chronological). Shared helper used by `editPayment` + `unmarkPaymentWrong`. Test: waive principal → edit earlier payment → ledger correct.

10. **Period interest already settled (R9-M2):** Include same-period waiver interest portions in `interestAlreadyPaidInPeriod` for edit/reallocate; pass into allocator.

11. **Edit penalty context (R10-M2):** In `editPayment`, use `newPaymentDate` (not `new Date()`) for overdue/penalty context when recomputing allocation.
  </action>
  <verify>
    <automated>npx vitest run src/lib/interest src/services/__tests__/loan-waiver-allocation.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>Interest waivers advance settlement date. Allocation handles all loan types. Tests pass.</done>
</task>

<task type="auto">
  <name>Task 3: Waiver service + ledger posting</name>
  <files>
    src/services/loan-waiver.service.ts,
    src/services/auto-post.service.ts,
    src/services/ledger-queries.service.ts,
    src/services/transaction.service.ts,
    src/services/payment.service.ts,
    src/lib/loan-visibility.ts,
    src/services/__integration__/loan-waiver.service.test.ts
  </files>
  <action>
Implement `waiveLoanAmount(input, actorId)` following `collateral-settlement.service.ts` transaction pattern:

1. Lock loan (`FOR UPDATE`). **Must** call `assertLoanOperational` from `src/lib/loan-visibility.ts` (visibility plan R11-2 / R19-1). Do not use a raw `status === "active"` check.
2. Set **`waiverDate = new Date()`** server-side (decision #6 — no client backdating)
3. Load ledger principal via `getLoanBalancesFromLedger(loanId, undefined, tx)` inside transaction (current ledger at submit)
4. Compute allocation via `allocateLoanSettlementAmount` with **`asOf = endOfDay(waiverDate)`** — amount must be ≤ total owed now
5. Insert `loan_waivers` row with server `waiverDate`
6. If interest portion > 0:
   a. `reverseInterestAccrual(tx, { loanId, paymentDate: waiverDate, actorId })`
   b. Re-read interest owed post-reversal if needed
   c. `autoPostLoanWaiverInterest(tx, { amount, loanId, waiverId, waiverDate, actorId })`
7. If principal portion > 0:
   - `autoPostLoanWaiverPrincipal(tx, { amount, loanId, waiverId, waiverDate, actorId })`
   - Implement both auto-post helpers like **`autoPostPrincipalRecovery`** (non-cash expense/asset legs, no `depositLocation`, no Cash leg — R11-M2)

8. Status: **only when** `await isLoanEconomicallyFullyPaid(loanId, waiverDate, tx)` after journals, call **`maybeUpdateLoanStatusAfterPayment(tx, loan, "fully_paid", actorId)`** imported from `@/services/payment.service` (R11-C2). Never call on partial waiver. Helper cancels pending rate-change requests via `cancelPendingRateChangeRequestsForLoan`.
9. `writeAuditLog`: action `loan.waiver`, entityType `loan`, beforeValue/afterValue with portions + reason (reason in audit only — not activity description)

Add to `ledger-queries.service.ts`:
- `getWaiverPortionsFromLedger(loanId, waiverId)` — mirror `getPaymentPortionsFromLedger`
- **Batch variant** `getWaiverPortionsFromLedger(waiverIds[])` for `PaymentsClient` running-balance interleaving (R10-M5, R12-M2)

Add to `transaction.service.ts` `systemReferenceTypes`:
- `"loan_waiver"`, `"loan_waiver_reversal"` (R8-M5)
- Unit test: `deleteTransaction` blocks both types (R8-H4)

Integration tests:
- Partial principal waiver reduces ledger balance
- Interest waiver reduces UI unpaid interest (via settlement date)
- Waiver with pre-existing `interest_accrual` rows (reverse + post)
- Full waiver → `fully_paid` via `maybeUpdateLoanStatusAfterPayment`; loan no longer in operational list
- fixed_rate loan: cannot fully_paid with principal-only waiver while interest remains
- Waiver on `fully_paid` / `rolled_over` / `settled_collateral` throws `ValidationError` via `assertLoanOperational`
- Full waiver with pending rate-change request → request cancelled (same as payment closure)
  </action>
  <verify>
    <automated>npx vitest run src/services/__integration__/loan-waiver.service.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>Service posts correct journals. Integration tests pass including accrual reversal and loan-type edge cases.</done>
</task>

<task type="auto">
  <name>Task 4: Actions, collection, cache invalidation, deleteLoan cleanup</name>
  <files>
    src/actions/loan-waiver.actions.ts,
    src/collections/loan-waivers.ts,
    src/collections/operational-loans.ts,
    src/services/loan.service.ts,
    src/actions/__tests__/authorization.test.ts,
    src/lib/email.ts
  </files>
  <action>
1. `waiveLoanAmountAction` — `withAction({ permission: "loan:waiver" })`, validate input (amount + reason only), call service. **Do not** accept or validate client `waiverDate`; **do not** use `validateBackdating` (decision #6).
2. `listLoanWaiversAction` — **`permission: "loan:waiver"`** (not `loan:read` — prevents officers reading write-down reasons via direct action call), filter by loanId
3. `loan-waivers.ts` collection — query via list action, mutation calls waive action then:
   - `invalidateLendingProjections(qc)` (already includes `queryKeys.loans.operational`, `loanStatusCounts`, customer loan keys — R21-1)
   - `qc.invalidateQueries({ queryKey: queryKeys.loanWaivers.all })` (R11-H4)
   - `emitTableChange("loan_waivers")`
   - `emitTableChange("transactions")`
   - `emitTableChange("loans")`
   - Do **not** add global collection bootstrap in providers — import only from gated admin UI (creditor pattern, R11-H4)

3b. **`operational-loans.ts` sync:** Add `subscribeToTableChanges("loan_waivers", …)` and extend existing `transactions` subscription if not already covered — so watchlist/payment pickers refresh after waiver without full page reload.

4. Update `deleteLoan` in `loan.service.ts`:
   - Before deleting loan, find all waiver transactions (`referenceType = "loan_waiver"`)
   - Post reversing journals (`referenceType: "loan_waiver_reversal"`) with **exact opposite legs** per portion from `getWaiverPortionsFromLedger` (R11-H3):
     - Interest waiver reversal: DR Interest Earned / CR Loan Losses
     - Principal waiver reversal: DR Loans Receivable / CR Loan Losses
     - **No Cash leg** — do not copy payment reversal template from `deleteLoan`
   - Soft-delete `loan_waivers` rows

5. Fire-and-forget admin email: `notifyAdmin({ eventType: "loan.waiver", ... })` — add `"loan.waiver"` to `NotificationEvent`, `SUBJECT_MAP`, `DIRECTION_MAP` in `email.ts` (R7-H4)

6. Export `loanWaiversCollection` from `collections/index.ts`; add `queryKeys.loanWaivers` (R7-M4/M5)

7. **`previewWaiverAllocationAction`** — `permission: "loan:waiver"`, same `allocateLoanSettlementAmount` as service, `asOf = now`, no client date (R4-M1, R12-H1 — must exist before Task 5 dialog)

8. Authorization tests: admin/superAdmin allowed; loanOfficer, supervisor, and elevated managing supervisor rejected
  </action>
  <verify>
    <automated>npx vitest run src/actions/__tests__/authorization.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>Actions enforce admin-only. Collection invalidates all dependent caches. deleteLoan cleans up waiver journals.</done>
</task>

<task type="auto">
  <name>Task 5: UI — waiver dialog on loan detail</name>
  <files>
    src/components/loans/waive-loan-dialog.tsx,
    src/app/(app)/loans/[loanId]/loan-detail-client.tsx
  </files>
  <action>
1. Create `WaiveLoanDialog` (pattern: `settle-collateral-dialog.tsx`):
   - Shows Principal Balance, Unpaid Interest, Total Due
   - Amount input with live allocation preview (interest/principal split) via `previewWaiverAllocationAction` (uses today’s balances — no date picker)
   - Required reason textarea (min 10 chars)
   - **No waiver date field** — posts at submit time (decision #6)
   - Confirm with loading state
   - Success toast

2. Wire into `loan-detail-client.tsx` action bar (reuse existing `readOnly = isLoanReadOnly(loan.status)`):
   - "Waive Amount" button when **`!readOnly && has("loan:waiver")`** — do not duplicate raw `status === "active"` checks (visibility R11-2)
   - Non-admins: no button; `PermissionInfo requiredRole="admin"` if shown near admin actions
   - Place near Record Payment / Settle Collateral

3. Optional waiver history table below payment table:
   - Query `loanWaiversCollection` filtered by loanId
   - Render only when `has("loan:waiver")` — reasons are admin-only (R7-L3)
   - Columns: date, amount, reason, recorded by

4. Ensure balance props refresh after waiver via collection invalidation (no stale simulator/balance cards).
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>Admin sees Waive Amount on operational loans only. Dialog validates and submits. Balances refresh post-waiver.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Downstream integrations + E2E</name>
  <files>
    src/lib/loan-statement.ts,
    src/lib/__tests__/loan-statement.test.ts,
    src/services/activity.service.ts,
    src/services/report.service.ts,
    src/lib/credit-score.ts,
    src/lib/__tests__/credit-score.test.ts,
    src/services/__integration__/fuzz-ledger.test.ts,
    scripts/reconcile-loan-balances.ts,
    cypress/e2e/loan-waiver.cy.ts
  </files>
  <action>
1. **Loan statement** — add `StatementEvent` kind `"waiver"` with interestPortion, principalPortion, reason. Pass waivers into `buildLoanStatement`.

2. **Activity feed** — add `case "loan.waiver"` in `activity.service.ts` with human-readable description (**amount + portions only — never free-text reason**, R9-L4, R11-M8). Formatter must not dump audit `afterValue.reason`.

3. **Reports** — in `report.service.ts` cashflow classifier, add explicit skip for `loan_waiver` and `loan_waiver_reversal` (like `collateral_settlement`). P&L auto-includes Loan Losses expense via category aggregation. **Transaction report (R11-H5):** decide whether to redact `loan_waiver` rows for viewers without `loan:waiver` (amounts visible via `reports:read` today) — default: redact/filter unless product accepts officer visibility of write-down amounts (not reasons).

4. **Credit score** — document in `credit-score.ts`: waivers excluded from timeliness; paydown uses ledger principal (waiver reduces outstanding but is not a payment event).

5. **Fuzz tests** — extend `fuzz-ledger.test.ts` with pay → waive interest → pay → waive principal sequences; assert balance invariants.

6. **Reconcile script** — add note/check for waiver transactions when comparing ledger vs projection.

7. **Cypress E2E** (`cypress/e2e/loan-waiver.cy.ts`) (R9-M5):
   - Prefer shared helper (e.g. promote admin + open waive dialog) if patterns exist
   - Admin logs in, navigates to active loan
   - Waives partial amount with reason
   - Asserts principal balance / total due decreased
   - Asserts non-admin cannot see Waive Amount button
   - Asserts activity feed or toast confirmation (no reason text in public activity)
  </action>
  <verify>
    <automated>npx cypress run --spec cypress/e2e/loan-waiver.cy.ts</automated>
  </verify>
  <done>Statement, activity, reports, credit score documented. Fuzz invariants hold. Cypress E2E passes.</done>
</task>

<task type="auto">
  <name>Task 7: Accrual cron + settlement path alignment (Round 2)</name>
  <files>
    src/services/transaction.service.ts,
    src/services/payment.service.ts,
    src/lib/interest/engine.ts,
    src/services/collateral-settlement.service.ts,
    src/services/__integration__/transaction.service.test.ts,
    src/app/api/cron/month-end/route.ts
  </files>
  <action>
1. **Accrual cron (R2-C2, R7-C2):** Extend `computeSegmentedInterest` with **`settlementEvents`** (payment + waiver dates) that advance `segmentStart` even when principal unchanged (interest-only waivers/payments). Principal-reducing events: payment principal portions + waiver principal portions. Update `accrueInterestForLoans` to build both lists from payments + `loan_waivers` + ledger portions.

2. **Collateral settlement (R2-H2, R11-C1, R11-H6):** Replace `computeAccruedInterest` payment-only last-date with `getLastSettlementDate` or use `computeSingleLoanBalanceData` unpaid interest inside `settleWithCollateral` transaction. Add **`assertLoanOperational(loan)`** (replace raw `status !== "active"`). Add **`SELECT … FOR UPDATE`** on loan inside tx; re-read balances after lock.

3. **Rollover prefill (R2-H3):** Update `getCustomerActiveLoan` to return balances from `computeSingleLoanBalanceData` / `getLoanBalanceSummary`, not `computeAccruedInterest`.

4. **Rollover server validation (R9-C1):** In `createLoan` rollover path (loan locked): recompute carried principal/interest from ledger + unpaid interest. Reject (or clamp) client amounts that exceed server balances. Integration test: waive principal → rollover with inflated client carry → reject or post ledger amounts only.

5. Integration test: waive interest → run accrual cron → assert no re-accrual of forgiven amount.

6. **Accrual cron lock (R9-H3, R12-H2, R13-H1):** Per-loan **`SELECT … FOR UPDATE` on `loans` row** (same lock as waiver/collateral — no advisory lock) before compute/post in `accrueInterestForLoans`; re-read settlement events **and** `computeSingleLoanBalanceData(loan.id, asOfDate)` after lock (batch prefetch is stale if waiver runs mid-cron).

7. **Payment status transitions (R7-C1, R8-C1, R11-H1):** In **`recordPayment`, `editPayment`, `deletePayment`, `markPaymentWrong`, `unmarkPaymentWrong`**, use shared `isLoanEconomicallyFullyPaid` for promote **and** revert paths — not ledger-principal-only. Test: principal waiver → interest payment → delete payment → stays `active`; mark wrong reverts mis-closed `fully_paid`.
  </action>
  <verify>
    <automated>npx vitest run src/services/__integration__/transaction.service.test.ts src/services/__tests__/collateral-settlement.service.test.ts src/services/__integration__/payment.service.test.ts --reporter=verbose 2>&1 | tail -25</automated>
  </verify>
  <done>Month-end cron respects waivers. Settlement and rollover use settlement-aware balances.</done>
</task>

<task type="auto">
  <name>Task 8: Reports, dashboard KPIs, running balance (Round 2)</name>
  <files>
    src/services/dashboard.service.ts,
    src/app/(app)/dashboard/page.tsx,
    src/app/(app)/loans/[loanId]/loan-detail-client.tsx,
    src/app/(app)/loans/[loanId]/payment-table.tsx,
    src/services/export/excel.service.ts,
    src/components/transactions/transaction-list-client.tsx,
    src/lib/cache-invalidation.ts,
    src/collections/loan-waivers.ts
  </files>
  <action>
1. **Dashboard net margin KPI (product decision #1):** Add **Loan Losses** to `getDashboardKPIs` ledger category query. Compute **netInterestMargin** = net Interest Earned − net Loan Losses. Update `DashboardKPIs` type, dashboard page label/popover (rename from gross “Interest Earned”).

2. **Dashboard activity feed (R2-H5, R9-H2, R10-H2):** Add `loan.waiver` case in `getRecentActivity` with amount + portions **only when `getSessionPermissions` includes `loan:waiver`** — pass flag from `getRecentActivityAction`. Omit/redact for others. Never include free-text reason.

3. **Payment running balance (R2-H1):** In `loan-detail-client.tsx`, interleave waiver events in chronological walk with payment principal portions. Use `getWaiverPortionsFromLedger` or waiver collection.

4. **Global payments running balance (R4-H1, R8-H3):** Same interleaving in `PaymentsClient.tsx` `balanceAfterMap`; **seed each loan from ledger outstanding**, not `loan.principalAmount`.

5. **Excel export (R2-M2):** "Last Payment" column fixed by Task 2 `computeOverdue` (keep label — decision #5).

6. **Transaction log labels (R2-M9, R10-M4):** Human-readable labels for `loan_waiver` and `loan_waiver_reversal`.

7. **Cache invalidation (R2-H6, R7-M7, R21-1):** Waiver collection calls `invalidateLendingProjections` (covers `loans.operational`, `loanStatusCounts`, etc.). Add `subscribeToTableChanges("loan_waivers"|"transactions")` on `dashboard.ts`, `daily-collections.ts`, and **`operational-loans.ts`** (Task 4). Handler-specific invalidation for activities/retained earnings/cashflow as needed.
  </action>
  <verify>
    <automated>npx vitest run src/services/__tests__/dashboard.service.test.ts src/services/__tests__/excel.service.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>Dashboard KPIs and activity accurate. Running balance reflects waivers. Exports and transaction log labeled. Full cache invalidation.</done>
</task>

<task type="auto">
  <name>Task 9: Scripts, tests, permission policy (Round 2)</name>
  <files>
    scripts/reconcile-loan-balances.ts,
    scripts/audit-amounts.ts,
    src/lib/schemas/collections.ts,
    src/lib/interest/__tests__/stateful-model.test.ts,
    src/lib/db/__integration__/loan-balances-trigger.test.ts,
    cypress/e2e/loan-balance-live.cy.ts,
    src/lib/permissions.ts,
    src/actions/loan-waiver.actions.ts
  </files>
  <action>
1. **Reconcile script (R2-C4):** Use `getLastSettlementDate` for expected LPD. Compare unpaid interest via `computeSingleLoanBalanceData`, not raw Interest Earned ledger. Add waiver journal sanity checks.

2. **db-verify-triggers (R7-H2):** Add `on_loan_waivers_change_for_loan_balance` + `trg_loan_waivers_loan_balance` to `EXPECTED_*` in `scripts/db-verify-triggers.ts`.

3. **Audit script (R2-M16):** Add `loan_waivers.amount <= 0` check.

4. **Collection schema (R2-M10):** Add `loanWaiverSchema` to `lib/schemas/collections.ts`.

5. **Trigger test (R2-C3):** Extend `loan-balances-trigger.test.ts` for waiver → LPD update.

6. **Stateful/property tests (R2-M17):** Add amount-waiver ops to fuzz/stateful suites.

7. **Cypress (R2-M18):** Update `loan-balance-live.cy.ts` for waiver scenarios; add interest-waiver overdue assertion.

8. **Permission tests:** `loan:waiver` on admin/superAdmin only; **`MANAGING_SUPERVISOR_ELEVATED.has("loan:waiver") === false`**; loanOfficer/supervisor/elevated supervisor rejected on waive + list actions.

9. **Activity formatter test (R7-M6):** Add `loan.waiver` case to `activity.service.test.ts`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/db/__integration__/loan-balances-trigger.test.ts src/services/__integration__/fuzz-ledger.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>Scripts updated. Tests cover waiver lifecycle. Permission policy documented and enforced.</done>
</task>

<task type="auto">
  <name>Task 10: UI stats, pickers, cron penalty guard (Round 3–5)</name>
  <files>
    src/app/(app)/loans/[loanId]/loan-detail-client.tsx,
    src/app/(app)/payments/LoanSearchCombobox.tsx,
    src/app/api/cron/overdue/route.ts,
    src/app/api/cron/overdue/__tests__/route.test.ts,
    src/services/loan.service.ts,
    src/app/(app)/customers/[id]/page.tsx,
    src/app/(app)/loans/page.tsx,
    src/app/(app)/payments/DailyCollectionsTab.tsx,
    cypress/e2e/loan-detail.cy.ts
  </files>
  <action>
1. **Repaid progress bar (R3-C1):** Replace `totalPaid = principal - balance` with sum of payment principal portions from ledger. Add separate "Write-downs" line from waiver total.

2. **LoanSearchCombobox (R4-H2, visibility R20-2):** Already sources `useOperationalLoansWithBalances()` — show `outstandingBalance` (from balance join) not `principalAmount` as balance label. Remove redundant `.filter(loan => loan.status === "active")` since operational collection is already active-only.

3. **Term schedule (R3-H2):** Label fixed/reducing schedule as "Original schedule" OR rebuild from ledger remaining principal.

4. **Penalty cron guard (product decision #3, R6-H2, R7-H3, R8-M1):** Extend `shouldResetPenaltyWaiver(daysOverdue, penaltyWaived, lastSettlementKind)` — only reset when `daysOverdue === 0` **and** `lastSettlementKind === "payment"`. Cron uses **`getLastSettlementEventsForLoans`** batch map. Tests in `route.test.ts` + `overdue.test.ts`.

5. **updateLoan guard (R3-M1, R8-M4):** If loan has active waivers, reject **principal** edit (triggers payment repost). Document: rate/startDate edits with waivers unsupported v1.

6. **UI copy (R6-L4):** Distinguish “Waive Penalty” (`settings:update`) from “Waive Amount” (`loan:waiver`) in tooltips.

7. **Cypress (R4-M2):** Extend `loan-detail.cy.ts` — waiver reduces balance; `% repaid` not inflated.

Do **not** implement: customer loan history waiver rows (decision #4); "Last Settlement" rename (decision #5).
  </action>
  <verify>
    <automated>npx vitest run src/app/api/cron/overdue/__tests__/route.test.ts --reporter=verbose 2>&1 | tail -15</automated>
  </verify>
  <done>UI stats honest. Pickers show correct balance. Penalty waiver preserved after interest waiver. updateLoan blocked when waivers exist.</done>
</task>

</tasks>

<verification>
1. TypeScript: `npx tsc --noEmit`
2. Unit + integration: `npx vitest run src/services/__integration__/loan-waiver.service.test.ts src/lib/interest --reporter=verbose`
3. Auth: `npx vitest run src/actions/__tests__/authorization.test.ts`
4. Fuzz: `npx vitest run src/services/__integration__/fuzz-ledger.test.ts`
5. E2E: `npx cypress run --spec cypress/e2e/loan-waiver.cy.ts`
</verification>

<success_criteria>
- Admin can waive partial loan amount from loan detail page
- Ledger shows Loan Losses expense + reduced Loans Receivable / Interest Earned
- UI balances, overdue badges, watchlist, cron, dashboard KPIs reflect waiver
- All three loan types allocate correctly
- Interest waiver resets overdue accrual window via settlement date (including computeOverdue, SQL trigger, reconcile)
- Month-end accrual cron does not re-accrue forgiven interest (settlementEvents in computeSegmentedInterest)
- deletePayment / markPaymentWrong / recordPayment / editPayment use loan-type-aware fully_paid (not ledger-principal-only)
- Payment and waiver share `allocateLoanSettlementAmount` allocator
- Payment running balance and loan statement reflect waivers
- Collateral settlement and rollover use settlement-aware balances; rollover carry validated against ledger (not client)
- Edit/unmark payment reconstructs principal including waiver write-downs
- Settlement date for edit allocate is asOf-aware (later waivers do not zero earlier unpaid interest)
- Accrual cron locks loan before post (no re-accrual race with concurrent waiver)
- Dashboard does not leak waiver amounts to viewers without `loan:waiver`
- Waivers post at creation time only (no backdating; server-set `waiverDate`)
- Point-in-time ledger (`asOf`) for payment edit paths, not waiver backdating
- Dashboard activity redaction uses session permissions, not formatter-only
- Waiver uses shipped visibility helpers (`assertLoanOperational`, `isLoanReadOnly` UI gate)
- Partial waiver on non-operational loans blocked via `assertLoanOperational`
- Full waiver calls `maybeUpdateLoanStatusAfterPayment` only when `isLoanEconomicallyFullyPaid`
- Collateral settlement and waiver mutually exclusive under row lock (no concurrent stale balance posts)
- deleteLoan waiver reversal uses non-cash opposite legs (not payment Cash template)
- Activity/transaction surfaces do not leak waiver reason text
- Full waiver removes loan from operational watchlist / payment pickers
- Dashboard net margin KPI (Interest Earned − Loan Losses) reflects waivers
- Active loans report and Excel export show correct last settlement date
- Loan detail % repaid excludes waivers from customer repayment stats
- Penalty waiver not auto-reset by interest waiver alone
- LoanSearchCombobox and payment pickers show outstanding balance
- Only admin/superAdmin can waive (`loan:waiver`; not elevated supervisors)
- deleteLoan reverses waiver journals
- Waiver journals protected from manual deletion
- Cypress E2E covers admin flow and permission gate
</success_criteria>

<output>
After completion, create `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-SUMMARY.md`
</output>
