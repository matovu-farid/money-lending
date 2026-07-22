# Adversarial Review — Round 13 (Final Confirmation Pass)

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-12-FINAL](./260722-loan-waiver-REVIEW-12-FINAL.md) (converged — 0 critical)  
**Plan state:** R12 patches verified in plan; 12 prior rounds complete

Round 13 re-traces **accrual cron internals**, **rollover trust**, **permission elevation**, **report/snapshot paths**, and **collection data sources** looking for gaps not closed in Rounds 1–12.

---

## CRITICAL

**None.** No new critical logic gaps found beyond Tasks 1–10.

Confirmed pre-implementation code still payment-only (`getLastPaymentDate`, ledger-principal `fully_paid`, accrual cron without waiver segments) — all covered by planned tasks.

---

## HIGH

### R13-H1 — Accrual cron should re-fetch balance inside lock (plan tightening)

| | |
|---|---|
| **Files** | `src/services/transaction.service.ts:727-793, 825+` |
| **Issue** | `accrueInterestForLoans` batch-fetches `computeLoanBalanceData` **before** the per-loan loop. Task 7 item 6 says re-read settlement events after `FOR UPDATE`, but not re-fetch `overdueInfo` / penalty context. A waiver mid-batch could leave stale `penaltyActive` and accrual target until next cron. |
| **Plan gap** | Item 6 partial — settlement events only. |
| **Fix** | Task 7 item 6: after `FOR UPDATE`, re-fetch **`computeSingleLoanBalanceData(loan.id, asOfDate, tx)`** (or equivalent) before `computeSegmentedInterest` target calc. |

### R13-H2 — Transaction report redaction (carry-forward, open product)

Unchanged from R12-H3 / R11-H5. Blocks Task 6 report wording only — not a logic bug. Plan default: redact `loan_waiver` rows unless viewer has `loan:waiver`.

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R13-M1** | `daily-collections.service.ts` imports `getLastPaymentDate` but uses `computeLoanBalanceData` for LPD (`145-159`) — dead import | Cleanup in Task 2 |
| **R13-M2** | `transaction.service.ts` imports `getLastPaymentDate` — unused | Cleanup in Task 2 |
| **R13-M3** | `dashboard.service.ts`, `loan.service.ts`, `report.service.ts` — same dead import pattern | Cleanup when settlement helpers land |
| **R13-M4** | `listLoanBalances()` calls `computeAllLoansBalanceData()` not SQL projection table (`loan.service.ts:1198-1204`) — comments in `loan-balances.ts` collection stale | No waiver impact; doc cleanup |
| **R13-M5** | `createLoan` rollover still trusts client `carriedPrincipal` / `carriedInterest` (`loan.service.ts:188-285`) | Task 7 item 4 — already planned |
| **R13-M6** | Elevated managing supervisor retains `settings:update` → can **Waive Penalty** but not **Waive Amount** (`loan:waiver` excluded) | Correct separation; Task 10 UI copy |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R13-L1** | `waivePenalty` already uses `assertLoanOperational` + `FOR UPDATE` (`loan.service.ts:1505-1513`) — good template for amount waiver | Reference in Task 3 |
| **R13-L2** | Month-end snapshot / P&L auto-picks up Loan Losses expense via category aggregation — no extra Task needed | Confirmed OK |
| **R13-L3** | Activity page role-filter hides admin actions from supervisors; dashboard feed is the privacy surface | Confirmed OK (R12-L3) |
| **R13-L4** | No SMS paths for loan events — waiver email only (Task 4) | Confirmed OK |

---

## R12 patch verification

| R12 patch | In plan? |
|-----------|----------|
| `previewWaiverAllocationAction` → Task 4 | ✓ |
| Accrual lock row `FOR UPDATE` only | ✓ |
| Batch `getWaiverPortionsFromLedger` | ✓ |
| Unmark + `interestAlreadyPaidInPeriod` | ✓ |
| `loan_waivers` in `resetDb` | ✓ |

---

## Exhaustive checklist — Round 13

| Domain | Result |
|--------|--------|
| Settlement date + SQL trigger | Task 1–2 |
| Allocator + economic fully_paid | Task 2, 7 |
| Waiver service + ledger + reversal | Task 3–4 |
| Visibility helpers | Design #9 |
| Concurrency (payment/collateral/accrual) | Tasks 3, 7 |
| Running balances + statement | Tasks 6, 8 |
| Dashboard + activity privacy | Task 8 |
| Rollover server validation | Task 7 item 4 |
| Permissions + elevation trap | Task 1 |
| Cypress + integration setup | Tasks 1, 6, 9 |
| Creditor / Electric / SMS | N/A or OK |

---

## Convergence status

| Round | Focus | New CRITICAL | Verdict |
|-------|-------|-------------|---------|
| 12 | Plan | 0 | Converged |
| 13 | Plan confirmation | 0 | **Stop plan loops** |
| **14** | **Implementation (Tasks 1–3)** | **2** | **[REVIEW-14-IMPL](./260722-loan-waiver-REVIEW-14-IMPL.md) — fix C1–C2, then Task 4+** |

**Recommendation (plan):** Plan review stopped at Round 13.  

**Recommendation (implementation):** See [REVIEW-14-IMPL](./260722-loan-waiver-REVIEW-14-IMPL.md). Critical: `isLoanEconomicallyFullyPaid` and `allocateLoanSettlementAmount` must use transaction-scoped reads inside `waiveLoanAmount` / payment txs. Integration tests require migration 0028.

---

## Plan patch applied

Task 7 item 6 — add explicit re-fetch of `computeSingleLoanBalanceData` inside locked per-loan accrual tx.
