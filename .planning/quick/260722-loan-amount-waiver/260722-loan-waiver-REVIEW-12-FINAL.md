# Adversarial Review — Round 12 (Convergence Smoke Pass)

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-11](./260722-loan-waiver-REVIEW-11.md) (concurrency, status wording, revert paths — absorbed into plan)  
**Plan state:** R11 patches verified in `260722-loan-waiver-PLAN.md`

Round 12 is a **smoke pass** after R11 absorption: verify no new CRITICAL logic gaps, confirm execution-order traps, and check areas R11 did not explicitly close.

---

## R11 absorption verified

| R11 ID | Plan location | Status |
|--------|---------------|--------|
| C1 collateral lock | Task 7 item 2 | ✓ |
| C2 conditional fully_paid | Task 3 step 8 | ✓ |
| H1 markPaymentWrong revert | Task 2 §4b, Task 7 item 7 | ✓ |
| H2 interestAlreadyPaidInPeriod | Task 2 item 3 | ✓ |
| H3 deleteLoan reversal legs | Task 4 item 4 | ✓ |
| H4 loanWaivers cache | Task 4 item 3 | ✓ |
| H5 transaction report amounts | Task 6 item 3 (open decision) | ⚠ pending product |
| H6 assertLoanOperational collateral | Task 7 item 2 | ✓ |
| M1 computeOverdue LPD return | Task 2 item 2 | ✓ |

Code trace confirms `recordPayment` / `editPayment` / `deletePayment` still use ledger-principal-only `fully_paid` today — expected pre-implementation; plan Task 7 item 7 covers all six paths.

---

## CRITICAL

**None new.** R11 critical items are in the plan. Concurrent waiver + payment both use `FOR UPDATE` on the loan row (`payment.service.ts:177-181`); collateral settlement is the remaining race (Task 7).

---

## HIGH

### R12-H1 — Task execution order: preview action after dialog task

| | |
|---|---|
| **Files** | Plan Task 5 (`WaiveLoanDialog` uses `previewWaiverAllocationAction`); Task 10 item 3 defines preview action |
| **Issue** | Executor running tasks 1→10 sequentially will hit Task 5 verify (`tsc`) before preview action exists → compile failure or stub. |
| **Fix** | Move `previewWaiverAllocationAction` to **Task 4** (with other actions) or add explicit note: Task 5 runs after Task 10 item 3. |

### R12-H2 — Accrual cron lock must match waiver row lock

| | |
|---|---|
| **Files** | Plan Task 7 item 6; `src/services/transaction.service.ts:686+` |
| **Issue** | Task 7 allows "FOR UPDATE **or advisory lock**". Advisory lock ≠ loan row lock used by waiver/collateral → accrual can read stale settlement events between waiver journal post and status update, or deadlock ordering differs. |
| **Fix** | Task 7 item 6: **require** `SELECT … FOR UPDATE` on `loans` row inside accrual tx (same as waiver). Remove advisory-lock alternative. Re-read settlement events after lock. |

### R12-H3 — Transaction report write-down visibility (carry-forward)

| | |
|---|---|
| **Files** | `src/actions/report.actions.ts:45-46`; plan Task 6 item 3 |
| **Issue** | Unresolved from R11-H5. Loan officers with `reports:read` will see `loan_waiver` journal rows (Loan Losses amounts). Not a reason leak; may exceed admin-only waiver product intent. |
| **Fix** | **Product decision:** redact for non-`loan:waiver` viewers (plan default) or accept officer visibility. Blocks Task 6 item 3 implementation wording only — not a logic bug. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R12-M1** | `unmarkPaymentWrong` calls `allocateLoanPayment` without `interestAlreadyPaidInPeriod` (`payment.service.ts:1402-1406`) — same R11-H2 gap on unmark path | Task 2: explicitly include unmark in interestAlreadyPaidInPeriod + waiver portion sum |
| **R12-M2** | `getWaiverPortionsFromLedger` defined single-id only (Task 3); `PaymentsClient` interleaves many loans (R10-M5) | Task 3: add batch `getWaiverPortionsFromLedger(waiverIds[])` mirroring payment portions batch |
| **R12-M3** | `resetDb()` truncate list has no `loan_waivers` yet (`setup.ts:17-34`) | Task 1: add `loan_waivers` before `loans` in TRUNCATE (or rely on CASCADE with explicit listing) |
| **R12-M4** | SQL `refresh_loan_balance.unpaid_interest` = net Interest Earned ledger, not accrual unpaid interest (`0025_loan_balances_projection.sql:28-32`). App path uses `computeAllLoansBalanceData()` for collection — OK. SQL column can drift from accrual semantics after waiver | Task 1 comment: SQL `unpaid_interest` is ledger-derived; UI/collection uses accrual engine. Reconcile script uses compute path (Task 9). |
| **R12-M5** | `listLoanBalances` comment says "projection table" but implementation calls `computeAllLoansBalanceData()` (`loan.service.ts:1198-1204`) — stale comment only | Cleanup when touching file; waiver path unaffected |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R12-L1** | `AGENTS.md` documents Electric proxy; route removed (`14dc96e`) | Doc errata; waiver enforcement is action-layer `loan:waiver` |
| **R12-L2** | Cypress admin via `db:promoteUser` role `admin` — will pick up `loan:waiver` from `adminExtras` automatically after Task 1 | No seed change needed |
| **R12-L3** | Activity page role-filter hides admin waivers from supervisors (`activity.service.ts:148-151`) — dashboard feed is the privacy surface (Task 8) | Confirmed OK |

---

## Exhaustive checklist — no new gaps

| Domain | R12 result |
|--------|------------|
| Settlement date pipeline | Task 1–2 (pre-existing payment-only code) |
| Visibility helpers | Plan design #9, Tasks 3/5/7 |
| Waiver ↔ payment concurrency | Both `FOR UPDATE` — OK |
| Waiver ↔ collateral concurrency | Task 7 — planned |
| Waiver ↔ accrual cron | Task 7 items 1 + 6 — tighten lock (R12-H2) |
| Allocator unification | Task 2 — includes unmark (R12-M1) |
| Running balance batch portions | R12-M2 |
| Dashboard vs activity privacy | Task 8; activity page role-filter OK |
| Electric / sync layer | Server actions + `emitTableChange`; no shape leak |
| Creditor privacy | Unrelated |

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 11 | 2 | 6 | Not converged — absorbed into plan |
| **12** | **0** | **3** | **Converged for implementation** |

**Stop adversarial loops.** Remaining HIGH items are plan hygiene (task order, lock spec) and one **open product question** (transaction report redaction, R12-H3). No new CRITICAL logic gaps found beyond what Tasks 1–10 already address.

---

## Recommended plan patches (applied in PLAN.md)

1. Move `previewWaiverAllocationAction` from Task 10 → **Task 4**  
2. Task 7 item 6 — loan row `FOR UPDATE` only (drop advisory lock)  
3. Task 3 — batch `getWaiverPortionsFromLedger`  
4. Task 2 — explicit unmark path for `interestAlreadyPaidInPeriod`  
5. Task 1 — `loan_waivers` in `resetDb` TRUNCATE list

---

## Open product question (blocks Task 6 wording only)

**Transaction report:** Should loan officers with `reports:read` see Loan Losses / waiver **amounts** in the transaction report? Plan default: redact rows where `referenceType = loan_waiver` unless viewer has `loan:waiver`.
