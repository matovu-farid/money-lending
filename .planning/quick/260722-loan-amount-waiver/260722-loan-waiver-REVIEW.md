# Adversarial Review: Loan Amount Waiver Plan

**Reviewed:** 2026-07-22  
**Plan:** `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-PLAN.md`  
**Method:** Codebase trace of every derivative calculation, integration point, and existing pattern the waiver touches.

---

## Executive Summary

The original plan correctly identified ledger posting (`DR Loan Losses / CR …`) and admin permissions, but **under-estimated the derivative calculation layer**. This app does not store "remaining balance" on the loan row — almost every UI surface recomputes balances from ledger + accrual engine + payment history. A waiver that only posts ledger entries without updating the **settlement date pipeline** would leave overdue badges, watchlist, cron, rollover, and loan statements wrong after an interest waiver.

The revised plan addresses **7 critical gaps**, **12 high gaps**, and documents medium/low items.

---

## CRITICAL Findings (fixed in revised plan)

### C1. Interest waiver does not reduce UI overdue without settlement date fix

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` (`getLastPaymentDate`), `src/lib/interest/loanBalanceData.ts`, `src/lib/interest/overdue.ts` |
| **Problem** | `unpaidInterest` and `daysOverdue` accrue from `lastPaymentDate`, which only reads the `payments` table. Crediting Interest Earned via waiver increases ledger `totalInterestPaid` but `interestAccruedSinceLastPayment` is unchanged — badges/watchlist/cron stay wrong. |
| **Fix (in plan Task 2)** | Replace with `getLastSettlementDate` = MAX(payment_date, waiver_date). Feed into `computeLoanOverdueInfo`. |

### C2. `allocateLoanPaymentServerSide` is perpetual-only

| | |
|---|---|
| **Files** | `src/lib/interest/engine-server.ts`, `src/lib/interest/engine.ts` |
| **Problem** | Server allocator does simple interest-first split. `engine.ts` has full `allocatePayment` with fixed_rate (remaining term interest on payoff), reducing_balance, and min-period rules. Using server allocator for waivers mis-allocates on non-perpetual loans. |
| **Fix (in plan Task 2)** | New `allocateLoanSettlementAmount` dispatching by `loanType`, mirroring `allocatePayment`. |

### C3. `fully_paid` on principal-only zero ignores fixed_rate interest

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` (lines 283–294), `src/lib/interest/engine.ts` |
| **Problem** | Existing payment flow marks `fully_paid` when Loans Receivable ledger = 0. For fixed_rate, borrower may still owe remaining term interest. Waivers inherit this bug. |
| **Fix (in plan Task 2–3)** | `loanFullyPaid` requires principal = 0 AND unpaid interest = 0, loan-type-aware. |

### C4. `deleteLoan` won't reverse waiver journals

| | |
|---|---|
| **Files** | `src/services/loan.service.ts` (`deleteLoan`) |
| **Problem** | Deletion reverses payments, rollover, disbursement — not `loan_waiver` entries. Orphaned expense/revenue corrupts portfolio totals. |
| **Fix (in plan Task 4)** | Post `loan_waiver_reversal` journals + soft-delete waiver rows during loan delete. |

### C5. `reverseInterestAccrual` + waiver amount coordination

| | |
|---|---|
| **Files** | `src/services/transaction.service.ts`, `src/services/collateral-settlement.service.ts` |
| **Problem** | Reversal posts DR Interest Earned / CR Interest Receivable. Then waiver posts DR Loan Losses / CR Interest Earned. If waiver amount computed from pre-reversal UI `unpaidInterest`, double-counting or Interest Receivable drift occurs. |
| **Fix (in plan Task 3)** | Allocate inside transaction after reversal; integration test with pre-seeded accrual rows. |

### C6. Waiver journals can be manually deleted

| | |
|---|---|
| **Files** | `src/services/transaction.service.ts` (`systemReferenceTypes`, line 443) |
| **Problem** | Protected types include `payment`, `collateral_settlement`, etc. — not `loan_waiver`. Admin could delete waiver legs via transaction UI. |
| **Fix (in plan Task 3)** | Add `"loan_waiver"` and `"loan_waiver_reversal"` to `systemReferenceTypes`. |

### C7. Min-interest-period floor ignored by server allocator

| | |
|---|---|
| **Files** | `src/lib/interest/overdue.ts`, `src/lib/interest/engine.ts` |
| **Problem** | Min-period uses `minimumDefaultInterest - totalInterestPaid`. Waiving interest increases ledger paid but not accrual-since-last-settlement. Borrower can appear still owing min-period interest. |
| **Fix (in plan Task 2)** | Settlement-aware allocation includes min-period validation. |

---

## HIGH Findings (fixed or documented in revised plan)

### H1. No cache invalidation for waivers

| | |
|---|---|
| **Files** | `src/collections/payments.ts`, `src/lib/cache-invalidation.ts`, `src/lib/table-events.ts` |
| **Problem** | Payments emit `invalidateLendingProjections` + `emitTableChange("payments"|"transactions"|"loans")`. Dashboard, daily collections, reports won't refresh. |
| **Fix (in plan Task 4)** | New collection with same invalidation fan-out. |

### H2. Category seeding missing in production defaults

| | |
|---|---|
| **Files** | `src/services/category.service.ts`, `src/services/__integration__/setup.ts` |
| **Problem** | `DEFAULT_EXPENSE_CATEGORIES` has no `"Loan Losses"`. Test `seedCategories()` only seeds 3 categories. |
| **Fix (in plan Task 1)** | Migration INSERT + add to `DEFAULT_EXPENSE_CATEGORIES` + test setup. |

### H3. Loan statement omits waivers

| | |
|---|---|
| **Files** | `src/lib/loan-statement.ts` |
| **Problem** | Events: issue, payment, rate_changed, penalty. No waiver kind — cumulative totals wrong. |
| **Fix (in plan Task 6)** | Add `{ kind: "waiver", ... }` event. |

### H4. Activity feed has no waiver case

| | |
|---|---|
| **Files** | `src/services/activity.service.ts` |
| **Problem** | Handles `loan.settle_with_collateral`, `payment.create` — not `loan.waiver`. |
| **Fix (in plan Task 6)** | Add formatter case. |

### H5. Rollover carries stale balances if overdue fix missing

| | |
|---|---|
| **Files** | `src/app/(app)/loans/new/page.tsx`, `src/services/loan.service.ts` |
| **Problem** | Rollover uses balance summary for carried interest/principal. Without settlement date fix, post-waiver rollover carries too much. |
| **Fix** | Resolved by C1 fix — rollover reads recomputed balances automatically. |

### H6. Cron overdue / watchlist badges inherit overdue bug

| | |
|---|---|
| **Files** | `src/app/api/cron/overdue/route.ts`, `src/components/watchlist/overdue-badge.tsx`, `src/app/(app)/loans/page.tsx` |
| **Problem** | All use `computeSingleLoanBalanceData` → same overdue pipeline. |
| **Fix** | Resolved by C1 fix. |

### H7. Credit score policy undefined

| | |
|---|---|
| **Files** | `src/lib/credit-score.ts` |
| **Problem** | `scoreTimeliness` uses payment dates only. Principal waiver reduces outstanding for paydown without payment behavior — policy unclear. |
| **Fix (in plan Task 6)** | Document: waivers excluded from timeliness; paydown uses ledger principal. |

### H8. `markedWrong` payment interaction

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` |
| **Problem** | Marking wrong reverses ledger. Waiver on overlapping amounts could double-count if not validated against current ledger balances. |
| **Fix (in plan Task 3)** | Waiver amount validated against ledger-derived total owed inside transaction. |

### H9. Property-based / fuzz tests lack waiver scenarios

| | |
|---|---|
| **Files** | `src/services/__integration__/fuzz-ledger.test.ts`, `src/lib/interest/__tests__/property-based.test.ts` |
| **Problem** | Invariants assume pay-only lifecycle. |
| **Fix (in plan Task 6)** | Extend fuzz with pay → waive sequences. |

### H10. Cypress coverage missing

| | |
|---|---|
| **Files** | `cypress/e2e/loan-balance-live.cy.ts`, AGENTS.md policy |
| **Problem** | No waiver UI test. Project requires Cypress for UI verification. |
| **Fix (in plan Task 6)** | `cypress/e2e/loan-waiver.cy.ts`. |

### H11. Types / actions / schema missing

| | |
|---|---|
| **Files** | `src/types/`, `src/actions/` |
| **Problem** | No `LoanWaiver` type, action, or collection. |
| **Fix (in plan Tasks 1, 4)** | Full type + action + collection stack. |

### H12. Email notification missing

| | |
|---|---|
| **Files** | `src/lib/email.ts`, `src/actions/payment.actions.ts` |
| **Problem** | Financial events notify admins. Write-off should too. |
| **Fix (in plan Task 4)** | Add `loan.waiver` event. |

---

## MEDIUM Findings (documented, not blocking v1)

| ID | Area | Files | Notes |
|----|------|-------|-------|
| M1 | Receipt generation | `src/services/receipt.service.ts` | Waivers are non-cash. Optional PDF via loan statement; no POS receipt needed v1. |
| M2 | Financial snapshots | `src/app/api/cron/month-end/route.ts` | Snapshots won't retro-update if waiver backdated. Document only. |
| M3 | Reconcile script | `scripts/reconcile-loan-balances.ts` | Add waiver sanity check note in Task 6. |
| M4 | P&L classification | `src/services/report.service.ts` | Auto-works via expense category once seeded. Cashflow needs explicit skip — in plan. |
| M5 | Simulator panel | `src/components/loans/simulator-panel.tsx` | No "simulate waiver" mode v1. Balances refresh post-waiver is sufficient. |
| M6 | Rate change interaction | `src/services/rate-change-request.service.ts` | Post-waiver reduced principal affects future accrual automatically. No block needed. |
| M7 | Transaction list label | Transaction UI | Nice-to-have: show "Loan waiver" for `referenceType === "loan_waiver"`. |
| M8 | Migration numbering | `drizzle/meta/_journal.json` | Must be **0027** (0026 taken). Confirmed in plan. |
| M9 | `loan_balances` trigger | `drizzle/0025_loan_balances_projection.sql` | No waiver table trigger needed — transaction INSERT suffices. `last_payment_date` column stale but app recomputes via `listLoanBalancesAction`. |
| M10 | PermissionInfo UI | `loan-info-cards.tsx` | Copy penalty waive pattern: `has("settings:update")` + `PermissionInfo`. |

---

## LOW Findings (deferred)

| ID | Item | Rationale |
|----|------|-----------|
| L1 | Dedicated `loan:waiver` permission | `settings:update` is sufficient and consistent with penalty waive |
| L2 | Simulator "waive" what-if mode | Admin-only nice-to-have |
| L3 | Waiver reversal / soft-delete UI | v1 is append-only; reversal only on loan delete |
| L4 | Sentry custom tags | Inherited from `withAction` |
| L5 | API route for waivers | Server actions sufficient (matches payments) |
| L6 | Electric sync schema | App uses TanStack Query collections; add Zod schema if collection added |

---

## What the Original Plan Got Right

1. **Ledger design** — `DR Loan Losses / CR Interest Earned` and `DR Loan Losses / CR Loans Receivable` is correct non-cash write-off accounting
2. **Admin permission** — `settings:update` matches existing `waivePenaltyAction` pattern
3. **Collateral settlement as precedent** — transaction structure, accrual reversal, audit log
4. **No cashflow impact** — explicit skip like `collateral_settlement`
5. **Projection table** — transaction trigger auto-refreshes `outstanding_balance`
6. **Reason required** — matches payment edit/delete pattern

---

## What the Original Plan Missed

| Category | Gap |
|----------|-----|
| **Derivative calculations** | Settlement date pipeline (C1) — the single biggest miss |
| **Loan types** | Server allocator is perpetual-only (C2, C7) |
| **Status transitions** | fixed_rate fully_paid bug (C3) |
| **Data integrity** | deleteLoan cleanup (C4), journal protection (C6) |
| **Accrual coordination** | reverseInterestAccrual ordering (C5) |
| **Client refresh** | Cache invalidation (H1) |
| **Seeding** | Production category defaults (H2) |
| **Reporting UX** | Statement, activity, email (H3, H4, H12) |
| **Testing** | Fuzz + Cypress (H9, H10) |
| **Policy** | Credit score behavior (H7) |

---

## Surfaces That Auto-Update (no code change needed)

Once ledger entries exist AND settlement date is fixed:

| Surface | Why it works |
|---------|--------------|
| Loans list principal balance | `getLoanBalancesFromLedger` |
| Loan detail info cards | `loanBalanceCollection` → `computeSingleLoanBalanceData` |
| Dashboard "Loans Outstanding" KPI | Aggregates Loans Receivable |
| Balance sheet | Nets Loans Receivable + expenses |
| Portfolio report | Per-loan ledger balance |
| Payment/waiver allocation caps | `computeSingleLoanBalanceData` total owed |
| Daily collections | Payment-only — waivers correctly excluded |

---

## Recommended Implementation Order (from review)

1. Schema + category seed + types (Task 1)
2. **Settlement date fix + loan-type allocation** (Task 2) — blocking for UI correctness
3. Waiver service + ledger + integration tests (Task 3)
4. Actions + collection + deleteLoan cleanup + email (Task 4)
5. UI dialog (Task 5)
6. Statement + activity + reports + fuzz + Cypress (Task 6)

---

## Review Loop Status

| Round | Outcome |
|-------|---------|
| Initial plan | Ledger + UI button + basic tests |
| Adversarial review (Round 1) | 7 critical, 12 high, 10 medium, 6 low findings |
| Revised plan | All Round 1 critical + high findings addressed in Tasks 1–6 |
| **Adversarial review (Round 2)** | **4 new critical, 9 new high, 20 medium** — see [260722-loan-waiver-REVIEW-2.md](./260722-loan-waiver-REVIEW-2.md) |
| **Adversarial review (Rounds 3–5)** | **2 new critical, 9 new high** — loop converged — see [260722-loan-waiver-REVIEW-3-FINAL.md](./260722-loan-waiver-REVIEW-3-FINAL.md) |
| Revised plan (Round 2) | Tasks 7–9 added for derivative calc / report gaps |
| Revised plan (Round 3–5) | Task 10 added for UI/stats/cron/copy gaps |
| **Adversarial review (Round 6)** | **1 critical, 2 high** — auth + settlement kind — see [REVIEW-6](./260722-loan-waiver-REVIEW-6.md) |
| **Adversarial review (Round 7)** | **2 critical, 4 high** — status transitions + accrual API — see [REVIEW-7](./260722-loan-waiver-REVIEW-7.md) |
| **Adversarial review (Round 8)** | **1 critical, 4 high** — R7 scope completion — see [REVIEW-8](./260722-loan-waiver-REVIEW-8.md) |
| **Adversarial review (Round 9)** | **2 critical, 4 high** — rollover trust, edit walks, privacy, cron race — see [REVIEW-9](./260722-loan-waiver-REVIEW-9.md) |
| **Adversarial review (Round 10 — FINAL)** | **1 critical, 2 high** — asOf ledger + dashboard perm pass — see [REVIEW-10-FINAL](./260722-loan-waiver-REVIEW-10-FINAL.md) |
| **Visibility alignment (2026-07-22)** | Plan patched for shipped `feat/rolled-over-loan-visibility` — see [VISIBILITY-ALIGNMENT](./260722-loan-waiver-VISIBILITY-ALIGNMENT.md) |
| **Adversarial review (Round 11)** | **2 critical, 6 high** — concurrency, status wording, revert path, reversal spec — see [REVIEW-11](./260722-loan-waiver-REVIEW-11.md) |
| **Adversarial review (Round 12 — FINAL)** | **0 critical, 3 high** — task order, lock spec, open product Q — see [REVIEW-12-FINAL](./260722-loan-waiver-REVIEW-12-FINAL.md) |
| **Adversarial review (Round 13 — FINAL)** | **0 critical, 1 high** — accrual re-fetch inside lock — see [REVIEW-13-FINAL](./260722-loan-waiver-REVIEW-13-FINAL.md) |
| **Implementation review (Round 14)** | **2 critical, 5 high** — tx isolation, fixed_rate waiver — see [REVIEW-14-IMPL](./260722-loan-waiver-REVIEW-14-IMPL.md) |
| **Implementation review (Round 15 — post-fix)** | **0 critical** — Tasks 1–3 converged — see [REVIEW-15-IMPL](./260722-loan-waiver-REVIEW-15-IMPL.md) |
| **Verdict** | **Tasks 1–3 implementation converged. Execute Task 4+.** |

---

## Visibility integration (post-ship)

`feat/rolled-over-loan-visibility` is implemented. Waiver execution **must**:

- Guard with `assertLoanOperational` (not raw `status === "active"`)
- Transition via `maybeUpdateLoanStatusAfterPayment` from `payment.service.ts`
- UI gate with existing `isLoanReadOnly` / `!readOnly && has("loan:waiver")`
- Subscribe `operational-loans.ts` to `loan_waivers` table changes
- Use migration **`0028_loan_waivers.sql`** (0027 = visibility index)

Full mapping: [260722-loan-waiver-VISIBILITY-ALIGNMENT.md](./260722-loan-waiver-VISIBILITY-ALIGNMENT.md)

---

## Open Questions for Product Owner

1. **Allocation rule:** Confirm interest-first (matches payments) vs admin chooses principal/interest split explicitly. Plan assumes interest-first.

2. **Waiver reversibility:** Plan v1 is append-only. Should admins be able to undo a waiver (with reason)? Deferred to v2.

3. **Credit score:** Should principal waiver improve paydown score at all, or be excluded entirely? Plan: reduces outstanding (ledger-derived) but excluded from timeliness.

4. **Backdating:** **Locked (decision #6):** No — waivers post at creation time (`waiverDate` server-set to now). No date picker, no `validateBackdating`.

5. **Partial waiver on non-operational loans:** Plan blocks via `assertLoanOperational` — only operational (`active`) loans. Confirm.

6. **Transaction report waiver amounts (R12-H3):** Should loan officers with `reports:read` see `loan_waiver` journal rows (Loan Losses amounts)? Plan default: redact unless viewer has `loan:waiver`. Confirm or override.
