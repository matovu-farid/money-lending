# Adversarial Review — Round 11 (Post-Visibility Alignment)

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-10-FINAL](./260722-loan-waiver-REVIEW-10-FINAL.md), [VISIBILITY-ALIGNMENT](./260722-loan-waiver-VISIBILITY-ALIGNMENT.md)  
**Plan state:** Visibility helpers integrated in plan; Electric removed from codebase (`14dc96e`)

Round 11 re-traces **concurrency**, **status-transition wording**, **payment revert paths**, **cache wiring**, and **privacy surfaces** after visibility alignment. Focus on gaps **not** explicitly closed in Rounds 1–10.

---

## CRITICAL

### R11-C1 — Collateral settlement vs waiver: no loan row lock

| | |
|---|---|
| **Files** | `src/services/collateral-settlement.service.ts:111-126`; plan Task 3 step 1 (waiver uses `FOR UPDATE`) |
| **Issue** | `waiveLoanAmount` locks the loan row. `settleWithCollateral` reads the loan **outside** the transaction, then opens `db.transaction` **without** `SELECT … FOR UPDATE`. Concurrent waiver + collateral settlement can post from stale balances — e.g. settlement accrues interest a waiver just forgave, or waiver caps against pre-settlement obligation. |
| **Plan gap** | Task 7 item 6 locks accrual cron only; Task 7 item 2 fixes balance **math** only. |
| **Fix** | Task 7 addendum: `SELECT … FOR UPDATE` on loan inside `settleWithCollateral` tx; re-read ledger + `computeSingleLoanBalanceData` after lock. Integration test: waive interest then settle (or parallel stress). |

### R11-C2 — Task 3 step 8 can mis-close on partial waiver

| | |
|---|---|
| **Files** | Plan Task 3 step 8; `src/services/payment.service.ts:77-99` |
| **Issue** | Task 3 reads as **always** calling `maybeUpdateLoanStatusAfterPayment(tx, loan, "fully_paid", …)`. That helper performs **no economic check** — it only skips terminal statuses. A literal implementer could flip `active → fully_paid` after a partial waiver. |
| **Plan gap** | Integration tests imply conditional behavior; step 8 never says **`if (await isLoanEconomicallyFullyPaid(...))`**. |
| **Fix** | Task 3 step 8: call `maybeUpdateLoanStatusAfterPayment(..., "fully_paid")` **only when** `isLoanEconomicallyFullyPaid` is true after journals; otherwise leave `active`. |

---

## HIGH

### R11-H1 — `markPaymentWrong` revert still ledger-principal-only

| | |
|---|---|
| **Files** | `src/services/payment.service.ts:1257-1268` |
| **Issue** | Revert `fully_paid → active` only when `ledgerBalance > 0`. Task 7 item 7 lists `markPaymentWrong` for economic fully_paid on **promote** paths; **revert** path untested. Fixed-rate loan at `fully_paid` with ledger `= 0` but unpaid term interest (existing bug at recordPayment; amplified by principal waivers) stays `fully_paid` when an interest payment is marked wrong. |
| **Fix** | Task 2/7: `if (loan.status === "fully_paid" && !(await isLoanEconomicallyFullyPaid(...))) → active`. Test: principal waiver → interest payment → mis-close → mark wrong → reverts to `active`. |

### R11-H2 — `interestAlreadyPaidInPeriod` dead in server allocator

| | |
|---|---|
| **Files** | `src/lib/interest/engine-server.ts:13-15`; `src/services/payment.service.ts:587-611` |
| **Issue** | Param declared on `allocateLoanPaymentServerSide` but never destructured/used. `editPayment` computes `interestAlreadyPaidInPeriod` but calls `allocateLoanPayment` **without** passing it. Task 2 item 10 adds waiver interest into the sum — if shared allocator still ignores the param, same-period **payment + waiver + edit** mis-allocates min-period interest. |
| **Fix** | Task 2: honor `interestAlreadyPaidInPeriod` in `allocateLoanSettlementAmount`; pass from `editPayment` / `unmarkPaymentWrong`; include waiver ledger portions in the sum. |

### R11-H3 — `deleteLoan` waiver reversal lacks journal leg spec

| | |
|---|---|
| **Files** | Plan Task 4; `src/services/loan.service.ts:949-1171` |
| **Issue** | Task 4 says post `loan_waiver_reversal` journals but not DR/CR mapping. Original waiver: interest `DR Loan Losses / CR Interest Earned`; principal `DR Loan Losses / CR Loans Receivable`. Payment reversal in `deleteLoan` uses Cash legs — **wrong template** for non-cash waivers. |
| **Fix** | Task 4: reverse exact opposite legs per portion via `getWaiverPortionsFromLedger`; integration test delete loan with mixed waivers. |

### R11-H4 — Task 4 cache: `loanWaivers` query not invalidated on mutate

| | |
|---|---|
| **Files** | Plan Task 4 item 6; `src/collections/payments.ts` pattern |
| **Issue** | Plan adds `queryKeys.loanWaivers` but does not require `qc.invalidateQueries({ queryKey: queryKeys.loanWaivers.all })` after waive. Admin waiver history table stays stale until `staleTime` (30s). |
| **Fix** | Task 4 item 3: after successful waive, invalidate `loanWaivers` + call `invalidateLendingProjections`. Document: no global collection bootstrap (creditor pattern). |

### R11-H5 — Transaction report exposes write-down **amounts** to loan officers

| | |
|---|---|
| **Files** | `src/actions/report.actions.ts:45-46` (`reports:read`); plan Task 6 item 3 |
| **Issue** | `loan_waiver` journal rows (Loan Losses expense) visible to anyone with `reports:read` (loan officers, supervisors). Not a `reason` leak (reason is not on transactions), but **write-down amounts** may exceed “admin-only waiver” product intent. Plan skips cashflow only. |
| **Fix** | Product decision or Task 6/8: redact/filter `loan_waiver` rows in transaction report for viewers without `loan:waiver`; OR document as accepted (officers see amounts, not reasons). |

### R11-H6 — Collateral settlement missing `assertLoanOperational`

| | |
|---|---|
| **Files** | `src/services/collateral-settlement.service.ts:118-124` vs `src/lib/loan-visibility.ts` |
| **Issue** | Raw `loan.status !== "active"`. Waiver standardizes on `assertLoanOperational`. Inconsistent guards if operational definition evolves. |
| **Fix** | Task 7 item 2: replace with `assertLoanOperational(loan)` (with C1 lock). |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R11-M1** | `computeOverdue` return field `lastPaymentDate` still payment-sourced (`loan.service.ts:1390-1421`) while overdue inputs use `balanceInfo` — Excel/export “Last Payment” wrong after interest waiver even when badge fixed | Task 2: `lastPaymentDate: info?.lastPaymentDate ?? null`; drop payment-array branch (R2-C1 trap) |
| **R11-M2** | `autoPostLoanWaiver*` easy to copy payment auto-post with Cash leg | Task 3: mirror `autoPostPrincipalRecovery` (non-cash, no `depositLocation`) |
| **R11-M3** | `getLastSettlementEventsForLoans` scoped to cron only; `computeLoanBalanceData` will N+1 per loan | Task 2: batch-fetch settlement events before per-loan loop |
| **R11-M4** | `loan-detail-client.tsx` Record Payment / Simulator use `status === "active"` not `!readOnly` (L735, L828) — visibility inconsistency | Task 5 or 10: align to `!readOnly` while touching detail page |
| **R11-M5** | `payment-table.tsx` mutations gated on `loanStatus === "active"` not `isLoanReadOnly` | Task 5: use operational/readOnly gate |
| **R11-M6** | `AGENTS.md` still documents live Electric proxy; route removed | Doc fix outside plan; implementers must not assume shape sync |
| **R11-M7** | `emitTableChange` invalidates **mutating user's tab only** — cross-user stale until staleTime | Document in Task 4; acceptable for v1 |
| **R11-M8** | Activity formatter must not dump audit `reason` from `afterValue` for `loan.waiver` | Task 6: explicit formatter case; test with reason in audit payload |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R11-L1** | Dead `getLastPaymentDate` imports in `dashboard.service.ts`, `report.service.ts`, `loan.service.ts`, `transaction.service.ts` | Cleanup when settlement helpers land |
| **R11-L2** | If Electric restored, `loan_waivers` must be `ADMIN_ONLY_TABLES` (contains `reason`) | Task 9 comment or AGENTS.md errata |

---

## Confirmed OK (no new gap)

| Domain | Status |
|--------|--------|
| Settlement date + trigger (Task 1–2) | Planned; pre-existing code payment-only |
| Penalty cron `lastSettlementKind` (Task 10) | Planned |
| Visibility helpers in waiver service/UI | Planned post-R10 alignment |
| `listLoanWaiversAction` on `loan:waiver` | Correct creditor-style pattern |
| Activity API does not expose raw `beforeValue`/`afterValue` | Formatter-only leak risk (R11-M8) |
| Creditor privacy unrelated | OK |
| No waiver implementation yet | Expected |

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 10 | 1 | 2 | Converged (post R10 patches) |
| **11** | **2** | **6** | **Not converged** — concurrency + status wording + revert path + cache/reversal spec |

**Stop condition:** Absorb R11-C1, R11-C2, R11-H1–H4, R11-M1–M2 into plan → one more smoke pass (Round 12) or execute if Round 12 finds ≤1 HIGH.

---

## Recommended plan patches (applied in PLAN.md)

1. Task 3 step 8 — conditional `isLoanEconomicallyFullyPaid` before status transition  
2. Task 3 — auto-post template note (non-cash, no Cash leg)  
3. Task 4 — reversal leg spec + `loanWaivers` query invalidation  
4. Task 7 — collateral `FOR UPDATE` + `assertLoanOperational`  
5. Task 2 — `markPaymentWrong` revert + `interestAlreadyPaidInPeriod` wiring + explicit `computeOverdue` LPD return field  
6. Task 6 — transaction report redaction note (pending product decision on H5)
