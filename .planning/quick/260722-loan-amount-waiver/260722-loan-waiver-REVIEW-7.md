# Adversarial Review — Round 7

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-6](./260722-loan-waiver-REVIEW-6.md) (auth + settlement kind)  
**Plan state:** Tasks 1–10 updated for R6-C1/H1/H2, locked product decisions applied

Round 7 re-audits **status transitions**, **accrual segmentation API**, **deploy verification**, and **never-taskified Round 3–4 items** after the R6 plan edits.

---

## CRITICAL

### R7-C1 — `deletePayment` sets `fully_paid` on ledger principal only (ignores unpaid interest)

| | |
|---|---|
| **File** | `src/services/payment.service.ts` (~779–798) |
| **Issue** | After a **principal waiver** (ledger principal = 0, loan stays `active` because fixed_rate / accrual-engine interest remains), deleting an **interest-only** payment leaves ledger at zero and hits `postDeleteBalance.isZero() → status = "fully_paid"`. Same pre-existing bug, but waivers make the “principal zero + interest owed” state common. |
| **Fix** | Reuse loan-type-aware `loanFullyPaid` (principal = 0 **and** unpaid interest = 0 via `computeSingleLoanBalanceData`) for `deletePayment`, `markPaymentWrong`, and `unmarkPaymentWrong` status transitions — same rule as `waiveLoanAmount`. Add integration test: principal waiver → interest payment → delete payment → loan stays `active`. |

### R7-C2 — `computeSegmentedInterest` only segments on principal reductions

| | |
|---|---|
| **Files** | `src/lib/interest/engine.ts` (`computeSegmentedInterest`), `src/services/transaction.service.ts` (`accrueInterestForLoans` ~787) |
| **Issue** | Segment boundaries come **only** from `principalPayments`. **Interest-only waivers** (and interest-only payments) do not advance `segmentStart`. Month-end cron can compute `totalInterestAccrued` spanning forgiven periods and post new accruals because `target = accrued − ledger` stays positive. Task 7 mentions “interest settlement events” but the function API does not support them yet. |
| **Fix** | Extend `computeSegmentedInterest` (or wrapper) with `settlementEvents: { date: Date; kind: "payment" \| "waiver" }[]` that advance `segmentStart` without reducing balance. Feed payment dates + waiver dates from `accrueInterestForLoans`. Integration test: interest-only waiver → month-end cron → no new accrual for forgiven window. |

---

## HIGH

### R7-H1 — Fixed/reducing payment overpayment cap still uses `loan.principalAmount` (R3-M2, never taskified)

| | |
|---|---|
| **File** | `src/services/payment.service.ts` (~195–208) |
| **Issue** | `totalOwed` for `fixed_rate` computes monthly interest from **`loan.principalAmount`**, not ledger `principalBalanceBefore`. After principal waiver, cap is too high — officer can overpay vs true obligation. |
| **Fix** | Use `principalBalanceBefore` (ledger) for monthly interest base in fixed_rate cap; mirror in edit/unmark paths. Unit test with prior principal waiver. |

### R7-H2 — `db-verify-triggers.ts` won't catch missing waiver trigger (R3-M3, never taskified)

| | |
|---|---|
| **File** | `scripts/db-verify-triggers.ts` |
| **Issue** | Deploy script asserts payments/transactions triggers only. Migration 0027 adds `loan_waivers` trigger — if dropped externally, build passes and SQL `last_payment_date` drifts from accrual engine again. |
| **Fix** | Add `on_loan_waivers_change_for_loan_balance` + `trg_loan_waivers_loan_balance` to `EXPECTED_*` arrays. Task 1 migration must name functions consistently. |

### R7-H3 — Overdue cron must wire `getLastSettlementEvent`, not just extend `shouldResetPenaltyWaiver`

| | |
|---|---|
| **File** | `src/app/api/cron/overdue/route.ts` (~88) |
| **Issue** | Task 10 extends the helper signature but cron still loads payments only. Without per-loan `getLastSettlementEvent`, locked decision #3 fails at runtime even if the helper is correct. |
| **Fix** | In penalty-reset branch, call `getLastSettlementEvent(loan)` (batch-friendly variant OK) and pass `lastSettlementKind` into `shouldResetPenaltyWaiver`. Test: interest waiver zeros overdue → cron does **not** clear `penaltyWaived`. |

### R7-H4 — `notifyAdmin` / `NotificationEvent` incomplete for waiver email

| | |
|---|---|
| **File** | `src/lib/email.ts` (`NotificationEvent`, `SUBJECT_MAP`, `DIRECTION_MAP`) |
| **Issue** | Task 4 says “add event to email types” but union/maps have no `"loan.waiver"`. `notifyAdmin({ eventType: "loan.waiver" })` won’t compile. |
| **Fix** | Add `"loan.waiver"` with subject “Loan amount waived”, direction `"internal"`. Match audit action `loan.waiver`. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R7-M1** | Waiver validator allows date **before** `loan.startDate` — breaks accrual segments | Service + Zod: `waiverDate >= loan.startDate` |
| **R7-M2** | `permissions.test.ts` hardcoded `PERMISSIONS.length` breaks on `loan:waiver` (R6-M1) | Update expected catalog in Task 1/9 |
| **R7-M3** | `scorePaydown` on `fully_paid` uses settlement date — waiver-only closure scores as fast payoff (R6-M5) | Optional: pass last **payment** date into paydown branch |
| **R7-M4** | `query-keys.ts` lacks `loanWaivers` namespace (R4-L1) | Add with collection |
| **R7-M5** | `collections/index.ts` missing `loanWaiversCollection` export (R6-L3) | Export in Task 4 |
| **R7-M6** | `activity.service.test.ts` has no `loan.waiver` formatter case | Add in Task 6 |
| **R7-M7** | `invalidateLendingProjections` omits activities, `loanStatusCounts`, retained earnings | Extend in Task 8 (partially listed — make explicit) |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R7-L1** | `dashboard.service.ts` / `report.service.ts` import `getLastPaymentDate` unused | Remove or switch when Task 2 lands |
| **R7-L2** | Transaction list human label for `loan_waiver` (R2-M9) | Task 8 — confirm both list + export |
| **R7-L3** | Waiver history on loan detail leaks reasons to anyone with `loan:read` if rendered without `loan:waiver` gate | Render history table only when `has("loan:waiver")` |

---

## Re-verified — no new gaps

R6 auth fixes in plan · ledger posting pattern · `reverseInterestAccrual` before interest waiver · append-only waivers · `deleteLoan` reversal path · concurrent `FOR UPDATE` · Cypress policy · non-active loan blocked · collateral `settled_with_collateral` status blocks waiver (active-only) · cashflow skip · P&L net via Loan Losses category · location balances unaffected (non-cash)

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 6 | 1 | 2 | Auth + settlement kind |
| **7** | **2** | **4** | Status transitions + accrual API + deploy verify |

**Not converged.** Round 6 items are in the plan; Round 7 adds payment-delete `fully_paid` logic, `computeSegmentedInterest` settlement boundaries, and three never-taskified ops items (overpayment cap, db-verify-triggers, cron wiring).

**After plan absorbs R7-C1/C2, R7-H1–H4:** review should converge for implementation.
