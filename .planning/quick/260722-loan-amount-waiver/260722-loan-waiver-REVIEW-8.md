# Adversarial Review — Round 8

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-7](./260722-loan-waiver-REVIEW-7.md) (status transitions + accrual API)  
**Plan state:** R7-C1/C2 and R7-H1–H4 absorbed into Tasks 1–10

Round 8 audits **R7 fix completeness** (did the plan actually cover every `fully_paid` path?), **allocator unification**, and **integration-test infrastructure**. No new product surfaces or report paths found.

---

## CRITICAL

### R8-C1 — R7-C1 scope incomplete: `recordPayment` / `editPayment` still ledger-principal-only

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` (~289–293 record, ~625–629 edit) |
| **Issue** | R7-C1 lists `deletePayment`, `markPaymentWrong`, `unmarkPaymentWrong` only. **`recordPayment` and `editPayment` also set `fully_paid` when `getLoanBalanceFromLedger().isZero()`**, ignoring unpaid interest on fixed_rate / reducing_balance. Principal waiver → interest payment → record path can still mis-close. |
| **Fix** | Task 7 item 5 must explicitly include **`recordPayment` and `editPayment`**. Extract shared `isLoanEconomicallyFullyPaid(loanId, asOf, tx)` (ledger principal = 0 AND accrual-engine unpaid interest = 0) and use in all six status-transition sites. |

---

## HIGH

### R8-H1 — Payment and waiver allocators will diverge unless unified

| | |
|---|---|
| **Files** | `src/lib/interest/engine-server.ts`, Task 2 `allocateLoanSettlementAmount` |
| **Issue** | Plan adds `allocateLoanSettlementAmount` for waivers but leaves `allocateLoanPaymentServerSide` as perpetual-style interest-first with `loanFullyPaid: principalBalanceAfter.isZero()`. Waivers use loan-type rules; payments do not — inconsistent splits and `fully_paid` semantics on the same loan. |
| **Fix** | Task 2: refactor `allocateLoanPaymentServerSide` to call shared `allocateLoanSettlementAmount` (or thin wrapper around `engine.ts` `allocatePayment` + balance info). Waiver service and payment service must share one code path. |

### R8-H2 — Integration `setup.ts` not ready for waiver tests

| | |
|---|---|
| **File** | `src/services/__integration__/setup.ts` |
| **Issue** | `resetDb()` TRUNCATE list omits `loan_waivers` (and `loan_balances` if present). `seedCategories()` lacks **Loan Losses**, **Loans Receivable**, **Cash** — waiver integration tests will fail or hit `getOrCreateCategory` mid-transaction. |
| **Fix** | Task 1: add `loan_waivers` to TRUNCATE; extend `seedCategories()` with categories waiver/auto-post needs (mirror production migration seed). |

### R8-H3 — `PaymentsClient` running balance seeds from original principal

| | |
|---|---|
| **File** | `src/app/(app)/payments/PaymentsClient.tsx` (~314–334) |
| **Issue** | `balanceAfterMap` initializes `bal` from `loan.principalAmount`, not ledger outstanding. After principal waiver, “Balance After” column is wrong even if payment portions are correct. Task 8 mentions interleaving waivers but not the **starting balance**. |
| **Fix** | Task 8: seed each loan walk from ledger balance (or `outstandingBalance` on list entry); subtract payment + waiver principal portions chronologically. |

### R8-H4 — No test that manual delete blocks `loan_waiver` journals

| | |
|---|---|
| **File** | `src/services/__tests__/transaction.service.test.ts` |
| **Issue** | Task 3 adds `loan_waiver` to `systemReferenceTypes` but existing tests cover `payment`, `creditor_repayment`, etc. only. Regression risk if list edit drops new types. |
| **Fix** | Task 3 or 9: add `deleteTransaction: blocks loan_waiver` test (mirror payment guard test). |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R8-M1** | Overdue cron N+1 if it calls `getLastSettlementEvent(loan)` per loan in a loop | Task 2: add batch `getLastSettlementEventsForLoans(loanIds)`; cron uses map lookup |
| **R8-M2** | `unmarkPaymentWrong` sets `fully_paid` via `allocation.loanFullyPaid` from broken engine-server helper | Fixed by R8-H1 + R8-C1 shared helper |
| **R8-M3** | `stateful-model.test.ts` has no `WaiveAmount` command — waiver+payment sequences untested at property level | Task 9 item 6 — add command |
| **R8-M4** | Task 10 `updateLoan` guard blocks principal edit only; sufficient today (repost is principal-only) but document that rate/startDate edits with waivers are unsupported v1 | Comment in service + plan note |
| **R8-M5** | `deleteTransaction` list should include `loan_waiver_reversal` alongside `loan_waiver` | Task 3 — both types in `systemReferenceTypes` |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R8-L1** | `engine.ts` `allocateFixedRatePayment` returns `loanFullyPaid: principalBalanceAfter.isZero()` — pre-existing; shared helper in R8-C1 supersedes for status transitions | Document; optional engine fix out of waiver scope |
| **R8-L2** | Dashboard `getRecentActivity` duplicate of activity.service — both need `loan.waiver` (Task 8 covers dashboard) | Verify both in Task 6 + 8 |

---

## Re-verified — no new gaps (Rounds 1–7 domains)

Auth · settlement date · accrual cron settlementEvents · deleteLoan reversal · running balance on loan detail · statement · reports/cashflow · dashboard net margin · penalty cron kind · cache/subscribers · Cypress policy · collateral/rollover paths · `% repaid` · pickers · permissions trap · email event type · db-verify-triggers · preview action permission

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 7 | 2 | 4 | Accrual API + payment delete |
| **8** | **1** | **4** | R7 scope completion + test infra |

**Near converged.** Round 8 found **no new business surfaces** — only gaps in R7 fix coverage (record/edit fully_paid), allocator unification, and integration setup. After plan absorbs R8-C1 and R8-H1–H4, the review loop is **ready for implementation**.
