# Adversarial Review — Round 14 (Post-Implementation, Tasks 1–3)

**Reviewed:** 2026-07-22  
**Scope:** Implemented code for Tasks 1–3 only (schema, settlement/allocation, waiver service)  
**Prior:** [REVIEW-13-FINAL](./260722-loan-waiver-REVIEW-13-FINAL.md) (plan converged — stop plan loops)  
**Method:** Trace implemented paths against plan must-haves, concurrency, loan-type edge cases, and remaining Tasks 4–10 gaps.

This is an **implementation** review, not a plan review. Findings below are against **shipped code**, not the plan document.

---

## Executive summary

Tasks 1–3 land the core schema, settlement-date pipeline, shared allocator, and waiver service skeleton correctly in broad strokes. **Two critical transaction-isolation bugs** will prevent reliable `fully_paid` transitions and make payment status checks flaky. **Fixed-rate waiver allocation** likely mis-splits amounts. Tasks 4–10 are largely unimplemented (expected). **Fix C1–C2 before calling Tasks 1–3 done**; integration tests have not been verified against a migrated DB.

| Severity | Count | Block ship? |
|----------|-------|-------------|
| CRITICAL | 2 | Yes |
| HIGH | 5 | Before UI (Task 5) |
| MEDIUM | 8 | Tasks 4–10 / polish |
| LOW | 4 | Backlog |

---

## CRITICAL

### R14-C1 — `isLoanEconomicallyFullyPaid` cannot see same-transaction journals

| | |
|---|---|
| **Files** | `src/services/payment.service.ts:113-122`, `src/services/loan-waiver.service.ts:111-117`, `src/lib/interest/loanBalanceData.ts` |
| **Issue** | `isLoanEconomicallyFullyPaid` passes `tx` to `getLoanBalanceFromLedger` but calls `computeSingleLoanBalanceData(loanId, asOf)` on the **global `db` pool**, not `tx`. Inside `waiveLoanAmount` / `recordPayment` / `editPayment` / `deletePayment` / `markPaymentWrong`, journal rows written on `tx` are invisible to the accrual path until commit. |
| **Symptom** | Full waiver (principal + interest) posts correct journals but **loan stays `active`** because `unpaidInterest` is read stale while principal reads correctly via `tx`. Same bug affects payment paths refactored to use `isLoanEconomicallyFullyPaid`. |
| **Plan ref** | Task 3 step 8 (R11-C2): status check after journals. |
| **Fix** | Thread `queryDb?: Pick<typeof db, "select">` through `computeSingleLoanBalanceData` → `computeLoanBalanceData` and all ledger/settlement fetches; pass `tx` from every in-transaction caller. **Or** after posting, use `allocation.loanFullyPaid` (already computed pre-post) when journals match allocation portions — document that choice. Add integration test: full waiver → `fully_paid` in same transaction. |

### R14-C2 — `allocateLoanSettlementAmount` reads outside waiver transaction

| | |
|---|---|
| **Files** | `src/lib/interest/engine-server.ts:45-80`, `src/services/loan-waiver.service.ts:48-52` |
| **Issue** | Called inside `db.transaction` after `FOR UPDATE`, but uses global `db` for loan load, `computeSingleLoanBalanceData`, `getRemainingPrincipalFromLedger`, `getLastSettlementDate`, and payment count. Not isolated to `tx`; concurrent commits between lock acquisition and allocation can produce **stale `totalOwed` / wrong split** under load (two admins, payment + waiver race). |
| **Fix** | Add optional `queryDb` param to `allocateLoanSettlementAmount`; pass `tx` from `waiveLoanAmount`, `recordPayment`, `editPayment`, `unmarkPaymentWrong`. Re-validate `amount ≤ totalOwed` after lock using tx-scoped reads. |

---

## HIGH

### R14-H1 — Fixed-rate waiver uses installment `paymentNumber`, not waiver semantics

| | |
|---|---|
| **Files** | `src/lib/interest/engine-server.ts:66-79`, `src/lib/interest/engine.ts` (`allocateFixedRatePayment`) |
| **Issue** | Waiver path sets `paymentNumber = activePayments.length + 1`. Waivers are write-downs, not scheduled installments. On `fixed_rate` loans mid-term, allocator uses **schedule interest** (one month / early-payoff term bucket) while `computeLoanOverdueInfo` may report different **accrued overdue** interest. Split can mis-assign principal vs interest vs plan's economic fully-paid check. |
| **Plan ref** | Task 2 item 3 — same rules as `allocatePayment` (ambiguous for waivers). |
| **Fix** | For waiver-only calls: cap `interestPortion` at `info.unpaidInterest`, or pass `paymentNumber` derived from schedule context explicitly; add integration test on `fixed_rate`: partial interest waiver + principal-only zero must **not** `fully_paid`. |

### R14-H2 — Overpayment validation vs allocation source mismatch

| | |
|---|---|
| **Files** | `src/services/loan-waiver.service.ts:54-64`, `src/lib/interest/engine-server.ts` |
| **Issue** | Cap uses `allocation.remainingPrincipalAmount + allocation.unpaidInterest` (accrual path) but split uses `allocatePayment` (engine path). When the two diverge, a waiver can pass validation yet post **interest journals exceeding true unpaid interest** (perpetual + penalty edge cases). |
| **Fix** | After allocation, assert `interestPortion ≤ info.unpaidInterest` and `principalPortion ≤ principalBalanceBefore`; reject or clamp before posting. |

### R14-H3 — `unmarkPaymentWrong` still promotes via `allocation.loanFullyPaid` only

| | |
|---|---|
| **Files** | `src/services/payment.service.ts:1366-1373` |
| **Issue** | `editPayment` / `recordPayment` / `markPaymentWrong` revert use `isLoanEconomicallyFullyPaid`; **unmark** promote still uses `allocation.loanFullyPaid` (principal-only semantics on fixed_rate). Plan Task 2 item 4b / Task 7 require shared economic check on **all** status transitions. |
| **Fix** | Replace with `isLoanEconomicallyFullyPaid` (after C1 fix) or `allocation.loanFullyPaid` consistently everywhere once economic check is tx-safe. |

### R14-H4 — `deleteLoan` does not reverse waiver journals (C4 still open)

| | |
|---|---|
| **Files** | `src/services/loan.service.ts` (`deleteLoan`) |
| **Issue** | No `loan_waiver` / `loan_waiver_reversal` handling. Deleting a loan that had waivers leaves Loan Losses + Interest Earned + Loans Receivable permanently wrong. |
| **Plan ref** | Task 4 — planned, not implemented. |
| **Block** | Before production use of waivers. |

### R14-H5 — No action layer / permission gate on service yet

| | |
|---|---|
| **Files** | Missing `src/actions/loan-waiver.actions.ts`, `src/collections/loan-waivers.ts` |
| **Issue** | `waiveLoanAmount` is callable directly with no `withAction({ permission: "loan:waiver" })`. Validators (`validateWaiveLoanAmountInput`) not invoked in service. Task 4 not started — **expected**, but blocks any UI wiring. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R14-M1** | Integration tests written but **not verified** — `loan_waivers` table requires migration 0028; plan verify step not green | Run `npx drizzle-kit migrate` + `vitest --config vitest.integration.config.ts` |
| **R14-M2** | `collateral-settlement.service.ts` still uses payment-only `computeAccruedInterest` (no waiver in last-date) | Task 7 — `getLastSettlementDate` or `computeSingleLoanBalanceData` |
| **R14-M3** | Accrual cron still batch-fetches balances before per-loan lock (R13-H1 carry-forward) | Task 7 item 6 — re-fetch inside `FOR UPDATE` |
| **R14-M4** | Penalty cron / `shouldResetPenaltyWaiver` + `getLastSettlementEventsForLoans` not wired | Task 10 |
| **R14-M5** | No UI, Cypress, dashboard net-margin label, activity/report/statement integration | Tasks 5–10 |
| **R14-M6** | `previewWaiverAllocationAction` missing (Task 4) — blocks Task 5 dialog preview | Task 4 before Task 5 |
| **R14-M7** | `operational-loans.ts` not subscribed to `loan_waivers` table changes | Task 4 |
| **R14-M8** | Waiver error shapes inconsistent: `assertLoanOperational` throws `ValidationError` class; over-amount throws plain `{ _tag: "ValidationError" }`; `LoanNotFound` plain object | Normalize when adding actions (Effect/catch pattern) |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R14-L1** | `refresh_loan_balance()` SQL sets `unpaid_interest` from Interest Earned ledger net — diverges from accrual engine; waivers CR Interest Earned amplify drift | Document; reconcile script Task 9 |
| **R14-L2** | `listLoanWaiversForLoan` uses `.orderBy(loanWaivers.waiverDate)` without explicit `asc()` | Use `asc(loanWaivers.waiverDate)` |
| **R14-L3** | `getLastPaymentDate` dead export on `payment.service.ts` — only re-export, no remaining callers | Optional cleanup |
| **R14-L4** | Transaction report redaction for `loan_waiver` rows (R13-H2 product Q) still open | Task 6 |

---

## Task completion checklist (implemented vs plan)

| Task | Status | Notes |
|------|--------|-------|
| **1** Schema, migration, permissions | ✅ Mostly complete | 0028 + schema + `loan:waiver` + tests. Migration must be applied in envs. |
| **2** Settlement + allocation | ⚠️ Partial | Core helpers + shared allocator done. **C1/C2 tx threading missing.** `unmark` promote inconsistent (H3). |
| **3** Waiver service + ledger | ⚠️ Partial | Service + auto-post + journal guards done. **Full waiver → fully_paid broken (C1).** Integration tests unverified (M1). |
| **4–10** | ❌ Not started | Actions, UI, cron, reports, Cypress, deleteLoan reversal, etc. |

---

## What landed correctly (no action)

- `getLastSettlementDate` / batch events / payment-wins tie-break in `settlement.service.ts`
- Point-in-time `asOf` on ledger reads in `computeLoanBalanceData`
- `reconstructPrincipalBalanceBefore` + `sumInterestAlreadyPaidInPeriod` include waivers
- `autoPostLoanWaiverInterest` / `autoPostLoanWaiverPrincipal` — DR Loan Losses, no Cash leg
- `loan_waiver` + `loan_waiver_reversal` in `systemReferenceTypes`
- `loan:waiver` admin-only + excluded from `MANAGING_SUPERVISOR_ELEVATED`
- `assertLoanOperational` on waiver entry
- Dead `getLastPaymentDate` imports removed from dashboard/report/daily-collections/transaction

---

## Recommended fix order (before Task 4)

1. **R14-C1** — Thread `tx` through balance/accrual reads OR use post-allocation `loanFullyPaid` with tests  
2. **R14-C2** — Thread `tx` through `allocateLoanSettlementAmount`  
3. **R14-H3** — Align `unmarkPaymentWrong` promote path  
4. **R14-H1/H2** — Fixed-rate waiver tests + interest cap  
5. **R14-M1** — Migrate + run integration suite  

Then proceed Task 4 → 5 (actions before UI).

---

## Convergence status

| Round | Focus | New CRITICAL | Verdict |
|-------|-------|-------------|---------|
| 13 | Plan | 0 | Stop plan loops |
| **14** | **Implementation (Tasks 1–3)** | **2** | **Fix C1–C2, then continue Tasks 4–10** |

**Do not** run Round 15 plan review. **Do** fix C1–C2 and re-run integration tests, then resume execution at Task 4.
