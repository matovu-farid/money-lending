# Adversarial Review — Round 10 (Final Checklist)

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-9](./260722-loan-waiver-REVIEW-9.md) (rollover trust, edit walks, privacy, cron race)  
**Plan state:** R9-C1/C2 and R9-H1–H4 absorbed into Tasks 1–10

> **Superseded (product decision #6, 2026-07-22):** R10-H1 (backdate note UI) and R9-M1 (`validateBackdating`) withdrawn — waivers post at creation time only; no client `waiverDate`. R10-C1 `asOf` ledger remains for payment edit paths, not waiver backdating.

Round 10 is an **exhaustive smoke pass** over R9 plan completeness and historical `asOf` correctness. No new report surfaces or auth paths found.

---

## CRITICAL

### R10-C1 — `computeLoanBalanceData` ignores `asOf` for ledger / interest queries

| | |
|---|---|
| **Files** | `src/lib/interest/loanBalanceData.ts` (~57, ~85–98); `src/services/ledger-queries.service.ts` (`getInterestEarnedFromLedger` ~85 — no `asOf`) |
| **Issue** | `computeSingleLoanBalanceData(loanId, asOf)` passes `asOf` into `computeLoanOverdueInfo` for day math, but **`getLoanBalancesFromLedger(loanIds)` is always called without `asOf`**. `getInterestEarnedFromLedger` also has no `asOf` filter. Backdated waiver (R9-M1 `validateBackdating`) or `previewWaiverAllocationAction` at `waiverDate` can validate/allocation against **today’s** ledger and interest totals while settlement date is historical — wrong cap, wrong split, can over-waive vs obligation at that date. |
| **Fix** | Task 2: thread `asOf` through `computeLoanBalanceData` → `getLoanBalancesFromLedger(loanIds, asOf)`, `getRemainingPrincipalFromLedger(..., asOf)`, `getInterestEarnedFromLedger(..., asOf)` (add param). Waiver service + preview action use `asOf = endOfDay(waiverDate)`. Settlement helpers filter waivers with `waiver_date <= asOf`. Test: payment on day 30 → backdated waiver on day 15 → amount capped to day-15 obligation. |
| **Plan gap** | R9-H4 fixes settlement **date** only; not ledger point-in-time. |

---

## HIGH

### R10-H1 — `WaiveLoanDialog` missing backdate note UI

| | |
|---|---|
| **Files** | Task 5 dialog; `src/lib/action-utils.ts` `validateBackdating`; loan create pattern in `loan-details-step.tsx` |
| **Issue** | Task 4 applies `validateBackdating` on waive action but Task 5 dialog has no `backdateNote` field. Waivers >3 days ago will fail at action with no UI to supply note. |
| **Fix** | Task 5: when `waiverDate` older than 3 days, show required backdate reason (mirror loan create). Pass through action input. |

### R10-H2 — Dashboard activity redaction needs viewer permissions in service call

| | |
|---|---|
| **Files** | `src/actions/dashboard.actions.ts` (~35–37); `src/services/dashboard.service.ts` `getRecentActivity` |
| **Issue** | R9-H2 says redact `loan.waiver` for viewers without `loan:waiver`, but `getRecentActivityAction` calls service with **no session permissions**. Formatter-only fix insufficient — service must receive `viewerPermissions` or `canWaiverRead` flag. |
| **Fix** | Task 8: extend `getRecentActivity(page, pageSize, { canReadWaivers })` from action via `getSessionPermissions(session)`. Skip or redact `loan.waiver` rows when false. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R10-M1** | Task 3 / preview must document `asOf = endOfDay(waiverDate)` for allocator (ties to R10-C1) | Explicit in Task 3 step 4 + Task 10 preview action |
| **R10-M2** | `editPayment` loads `computeSingleLoanBalanceData(loan.id, new Date())` for penalty (~518) while allocating at payment date | Task 2: use `newPaymentDate` for overdue/penalty context in edit path |
| **R10-M3** | Plan frontmatter `depends_on: []` — visibility `loan-visibility.ts` is soft “when exists” | Add note: co-ship `src/lib/loan-visibility.ts` with Task 3 or hard dependency on visibility Phase 1 |
| **R10-M4** | Transaction log label for `loan_waiver_reversal` not listed (Task 8 has `loan_waiver` only) | Task 8 item 6: both types |
| **R10-M5** | `getWaiverPortionsFromLedger` batch variant for `PaymentsClient` interleaving | Task 8: batch fetch waivers + portions per loan set |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R10-L1** | REVIEW-3-FINAL still says “no interaction” with visibility — stale vs R9-H1 | Add errata note in REVIEW-3 header or ignore at implement time |
| **R10-L2** | `isLoanEconomicallyFullyPaid` after backdated waiver should use post-posting state at txn time, not historical asOf | Document in Task 3: status check uses current balances after journals written |

---

## Exhaustive checklist — confirmed OK (Rounds 1–9 + plan)

| Domain | Status |
|--------|--------|
| Ledger DR Loan Losses / CR Interest Earned + principal | Task 3 |
| `reverseInterestAccrual` before interest waiver | Task 3 |
| Settlement date + event kind + penalty reset | Tasks 2, 10 |
| Accrual cron segments + lock | Task 7 |
| All six payment `fully_paid` paths + shared helper | Tasks 2, 7 |
| Unified allocator | Task 2 |
| Rollover server validate | Task 7 |
| Edit/unmark principal + waiver walk | Task 2 |
| Auth `loan:waiver` + elevation exclusion | Task 1 |
| List action privacy | Task 4 |
| deleteLoan reversal | Task 4 |
| Running balances (detail + payments list seed) | Task 8 |
| Statement / activity / cashflow / net margin | Tasks 6, 8 |
| `% repaid` / pickers / Cypress | Tasks 10, 6 |
| Integration setup TRUNCATE + categories | Task 1 |
| db-verify-triggers + reconcile | Task 9 |
| Collateral / rollover prefill | Task 7 |
| updateLoan blocked with waivers | Task 10 |
| loan-visibility helpers | Task 3 |
| No SMS; location balances non-cash | OK |
| Creditor privacy unrelated | OK |

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 9 | 2 | 4 | Rollover, edit, privacy, cron |
| **10** | **1** | **2** | Historical `asOf` ledger + UI backdate + dashboard perm pass |

**Review loop converged for implementation** after absorbing R10-C1, R10-H1, R10-H2 into the plan. Remaining items are MEDIUM/LOW polish. **Stop adversarial loops** — execute Tasks 1–10.

---

## Recommended execution order

1. Task 1 (schema, permissions, setup)  
2. Task 2 (settlement, allocator, asOf ledger, economic fully_paid) — **blocks Task 3**  
3. Co-ship or import `loan-visibility.ts` → Task 3  
4. Tasks 4–5 (actions, UI + backdate note)  
5. Tasks 7–8 (cron, rollover validate, dashboard perm pass)  
6. Tasks 6, 9, 10 (integrations, scripts, polish)  
7. Full verification block in PLAN.md
