# Adversarial Review — Round 9

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-8](./260722-loan-waiver-REVIEW-8.md) (R7 scope + allocator + test infra)  
**Plan state:** R8-C1 / R8-H1–H4 absorbed into Tasks 1–10

Round 9 audits **rollover trust**, **payment edit reconstruction after principal waiver**, **dashboard privacy vs `/activities`**, **accrual↔waiver concurrency**, **asOf-aware settlement**, and **cross-plan loan-visibility helpers**.

---

## CRITICAL

### R9-C1 — Rollover trusts client `carriedPrincipal` / `carriedInterest` (post-waiver inflation)

| | |
|---|---|
| **Files** | `src/services/loan.service.ts` (~151–221), `src/actions/loan.actions.ts` (~153–214) |
| **Issue** | After a principal (or interest) waiver, ledger outstanding can be lower than stale UI values. `createLoan` still posts whatever the client sends for rollover carry — no ledger re-check. Stale/malicious client can CR more Loans Receivable off the old loan than exists and DR the successor. |
| **Fix** | In `createLoan` rollover path (inside loan `FOR UPDATE`): recompute carry from `getLoanBalanceFromLedger` + unpaid interest (`computeSingleLoanBalanceData` / shared summary). Reject if client amounts exceed ledger by more than rounding tolerance (or ignore client and use server amounts). Integration test: waive principal → rollover → assert journals match ledger, not inflated client input. |
| **Plan gap** | Task 7 only updates `getCustomerActiveLoan` prefill — **not** server validation. |

### R9-C2 — `editPayment` / `unmarkPaymentWrong` principal walk ignores waiver principal

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` (~494–516 edit, ~1260–1280 unmark) |
| **Issue** | `principalBalanceBefore` = `loan.principalAmount` − **payment** principal portions only. After a principal waiver, edit/unmark overstates principal and can re-post excess CR Loans Receivable / wrong overpayment caps. Distinct from UI running-balance (R2-H1 / R8-H3) and fixed_rate rate base (R7-H1). |
| **Fix** | Reconstruct balance by subtracting prior payment **and** prior waiver principal portions (chronological). Shared helper e.g. `reconstructPrincipalBefore(loanId, asOfEvent, tx)`. Tests: waive principal → edit earlier payment → ledger principal correct. |

---

## HIGH

### R9-H1 — Cross-plan: waiver must use `loan-visibility.ts` helpers

| | |
|---|---|
| **Files** | `docs/superpowers/plans/2026-07-22-rolled-over-loan-visibility.md` (R11-2 ~961, ~990–994); waiver Task 3 (`status === "active"` only) |
| **Issue** | Visibility plan requires `assertLoanOperational` / `maybeUpdateLoanStatusAfterPayment` for all status transitions including waiver → `fully_paid`. Pending rate-change cancel on closure (visibility R7-5) not in waiver Tasks 1–10. REVIEW-6 “rolled-over alignment” was incomplete. |
| **Fix** | Task 3: depend on / co-ship `src/lib/loan-visibility.ts`; call `assertLoanOperational` at waiver entry; set status via `maybeUpdateLoanStatusAfterPayment` (or shared equivalent). Cancel pending rate-change requests when waiver closes loan (same as payment/settle). Document dependency on visibility Phase 1 helpers. |

### R9-H2 — Dashboard `getRecentActivity` leaks waiver amounts to non-admins

| | |
|---|---|
| **Files** | `src/services/dashboard.service.ts` (~181–211 — no role filter); contrast `src/services/activity.service.ts` (~141–167) |
| **Issue** | Supervisors have `dashboard:read` but not `loan:waiver`. Dashboard returns all `loan`/`payment` audit rows. Task 8 adds `loan.waiver` with amount/portions → write-down visibility leak. `/activities` hides higher-role actions; dashboard does not. |
| **Fix** | Task 8: either (a) omit `loan.waiver` from dashboard feed for viewers without `loan:waiver`, or (b) show generic “Admin action” without amount/reason. Prefer (a). Never put free-text reason in activity description (R9-L4). |

### R9-H3 — Accrual cron ↔ waiver TOCTOU

| | |
|---|---|
| **Files** | `src/services/transaction.service.ts` (`accrueInterestForLoans` ~686–778 — no loan lock); `src/app/api/cron/month-end/route.ts` |
| **Issue** | Cron reads balances/portions then posts. Concurrent waiver can reverse accruals and settle; cron still posts from stale snapshot → re-accrues forgiven interest. Loan `FOR UPDATE` in waiver does not serialize the cron. |
| **Fix** | Task 7: per-loan `SELECT … FOR UPDATE` (or advisory lock) before computing/posting accrual; re-read settlement events after lock. Integration test: concurrent waive + accrue (or sequential stress) leaves no re-accrual of forgiven window. |

### R9-H4 — Edit allocate uses global settlement date, not `asOf` payment date

| | |
|---|---|
| **Files** | `src/lib/interest/loanBalanceData.ts` (~87–99); `src/services/payment.service.ts` (`getLastPaymentDate` ~62–74; edit allocate ~552–556) |
| **Issue** | `editPayment` allocates with `asOf: paymentDate`, but `getLastPaymentDate` / planned `getLastSettlementDate` returns global MAX (including **later** waivers). Later interest waiver → editing an earlier payment can see ~0 unpaid interest / wrong split. Waivers make this common. |
| **Fix** | Task 2: `getLastSettlementDate(loan, { asOf })` = MAX of payment/waiver dates **≤ asOf** (fallback `startDate`). Balance/overdue “today” paths omit `asOf` (current behavior). Edit/unmark/repost use `asOf = paymentDate`. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R9-M1** | Waiver backdating skips `validateBackdating` / note (open Q from R1) | Task 4/5: apply `validateBackdating` on waive action (admins have `backdate:beyond-3-days`); require note when beyond 3 days |
| **R9-M2** | `interestAlreadyPaidInPeriod` ignores same-period interest waivers; param dead on edit path | Task 2/7: include waiver interest portions in period sum; pass into allocator |
| **R9-M3** | Waiver → `fully_paid` must cancel pending rate-change requests | Covered with R9-H1 |
| **R9-M4** | `getInterestEarnedFromLedger` includes waiver CR Interest Earned as “paid” | Document as intentional for min-interest floor + unpaid interest; no filter unless product wants cash-only |
| **R9-M5** | Cypress lacks shared waive helper / Loan Losses seed assumption | Task 6: `cy.waiveLoanAmount` or seed helper after promote-to-admin |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R9-L1** | `referenceType` is loose `string` — no union to extend | Task 3 `systemReferenceTypes` sufficient |
| **R9-L2** | Electric proxy absent; if restored, `loan_waivers` must be admin-only | Note in Task 9 schema comment |
| **R9-L3** | Print HTML “Last Payment” inherits settlement date; label kept (decision #5) | Confirm only |
| **R9-L4** | Activity description must not embed free-text waiver reason | Task 6 formatter: amount + portions only; reason stays in audit `afterValue` / admin history table |

---

## Re-verified — no new gaps

FOR UPDATE payment↔waiver serialization · SMS (none) · `getLoanBalanceSummary` math · Interest Receivable reverse pattern · financial snapshots · watchlist via settlement pipeline · Zod collection schema · PDF portfolio outstanding · cashflow skip · auth elevation trap (R6)

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 8 | 1 | 4 | Allocator + fully_paid scope |
| **9** | **2** | **4** | Rollover trust, edit walks, privacy, cron race, asOf settlement, visibility helpers |

**Not converged for implementation until R9-C1/C2 and R9-H1–H4 are in the plan.** After absorption: one optional smoke checklist; then execute.
