# Adversarial Review — Rounds 3–5 (Final)

**Reviewed:** 2026-07-22  
**Prior:** [Round 1](./260722-loan-waiver-REVIEW.md) · [Round 2](./260722-loan-waiver-REVIEW-2.md)  
**Status:** Review loop **converged** — no new CRITICAL/HIGH findings after Round 5.

---

## Convergence Summary

| Round | New CRITICAL | New HIGH | New MEDIUM/LOW | Outcome |
|-------|-------------|----------|----------------|---------|
| 1 | 7 | 12 | 16 | Core ledger + settlement date identified |
| 2 | 4 | 9 | 20 | Reports, cron, computeOverdue, running balance |
| 3 | 2 | 7 | 6 | Repaid stats, penalty reset, dual semantics |
| 4 | 0 | 2 | 8 | Payment picker, global payments list, preview action |
| 5 | 0 | 0 | 0 | Exhaustive checklist — no new gaps |

**Total unique findings:** 7 CRITICAL · 20 HIGH · 34 MEDIUM/LOW (deduplicated across rounds).

---

## Round 3 — New Findings

### CRITICAL

**R3-C1 — Loan detail “% repaid” treats waivers as customer payments**  
- **File:** `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` (~329–333)  
- **Issue:** `totalPaid = principalNum - balanceNum` includes principal waivers as “repaid.” Progress bar lies.  
- **Fix:** Repaid = sum of payment principal portions from ledger. Show waivers as separate “Admin write-down” line.

**R3-C2 — Two `unpaid_interest` semantics (SQL projection vs accrual engine)**  
- **Files:** `drizzle/0025_loan_balances_projection.sql`, `listLoanBalances()` → `computeAllLoansBalanceData()`, `scripts/reconcile-loan-balances.ts`, `cypress.config.ts`  
- **Issue:** SQL stores net Interest Earned; UI collection runs accrual engine (despite comment saying “projection table”). Cypress/reconcile hit SQL; UI hits engine. Interest waiver widens divergence.  
- **Fix:** Document single source of truth. Reconcile/Cypress should use `computeSingleLoanBalanceData`, not SQL `unpaid_interest`. Consider renaming `loanBalanceCollection` comments.

### HIGH

**R3-H1 — Interest waiver can reset manual penalty waiver via cron**  
- **Files:** `src/app/api/cron/overdue/route.ts` (`shouldResetPenaltyWaiver`)  
- **Issue:** After interest waiver → `daysOverdue === 0` → cron clears `penaltyWaived` even though borrower didn’t pay.  
- **Fix:** Don’t reset penalty waiver when last settlement was a waiver (not a payment). Product rule required.

**R3-H2 — Term-loan schedule table ignores principal waivers**  
- **File:** `loan-detail-client.tsx` (~335–352) — `calculateSchedule` uses original `principalAmount`.  
- **Fix:** Rebuild from ledger balance or label “Original schedule.”

**R3-H3 — Collateral settlement server accrued interest (payment-only last date)**  
- **File:** `collateral-settlement.service.ts` — already in R2-H2; confirmed server/UI divergence.

**R3-H4 — Rollover prefill via `getCustomerActiveLoan` / `computeAccruedInterest`**  
- **Files:** `collateral-settlement.service.ts`, `loans/new/page.tsx` — confirmed R2-H3.

**R3-H5 — Dashboard `getRecentActivity` missing `loan.waiver` case**  
- **File:** `dashboard.service.ts` — duplicate formatter vs `activity.service.ts`.

**R3-H6 — Dashboard `interestEarned` KPI rises on interest waiver**  
- **File:** `dashboard.service.ts` — CR Interest Earned inflates KPI; Loan Losses not in this KPI.

**R3-H7 — `loanStatusCounts` not invalidated on waiver → `fully_paid`**  
- **Files:** `loan-status-counts.ts`, `cache-invalidation.ts`, dashboard distribution chart.

**R3-H8 — Loan statement simulation must interleave waivers in day-walk**  
- **File:** `loan-statement.ts` — event kind alone insufficient; balance/cumulativePaid must update.

### MEDIUM (Round 3)

| ID | Finding |
|----|---------|
| R3-M1 | `updateLoan` reposts payments but not waiver journals — block edit when waivers exist |
| R3-M2 | Fixed/reducing payment overpayment cap uses `loan.principalAmount` for term interest — use ledger balance |
| R3-M3 | `db-verify-triggers.ts` won’t catch missing waiver trigger |
| R3-M4 | Reconcile script header mislabels comparison target |
| R3-M5 | `loanStatusCounts` cache (see H7) |
| R3-M6 | Dashboard collection lacks `transactions` subscription — defense-in-depth |

---

## Round 4 — New Findings

### HIGH

**R4-H1 — Global payments list running balance ignores waivers**  
- **File:** `src/app/(app)/payments/PaymentsClient.tsx` (~313–343)  
- **Issue:** Same payment-only walk as loan detail; “Balance After” column wrong after principal waiver.  
- **Fix:** Interleave waiver principal reductions (same fix as R2-H1, second surface).

**R4-H2 — LoanSearchCombobox shows original principal as “Balance”**  
- **File:** `src/app/(app)/payments/LoanSearchCombobox.tsx` (~167)  
- **Issue:** `Balance: formatCurrency(loan.principalAmount)` — not `outstandingBalance`. Misleading before and after waiver.  
- **Fix:** Display `outstandingBalance` from `useLoansWithBalances`.

### MEDIUM

| ID | Finding | File |
|----|---------|------|
| R4-M1 | Waiver dialog allocation preview must use server action (not client `allocateLoanPayment`) | New `previewWaiverAllocationAction` |
| R4-M2 | `loan-detail.cy.ts` asserts “repaid” — will fail or pass incorrectly after waiver | Cypress |
| R4-M3 | Customer loan history expanded table shows payments only, no waivers | `customers/[id]/page.tsx` |
| R4-M4 | Loans print HTML column “Last Payment” / “No payments” | `loans/page.tsx` — rename after settlement fix |
| R4-M5 | Daily collections tab copy: “since last payment” | `DailyCollectionsTab.tsx` |
| R4-M6 | `loanBalanceData.ts` calls `getLastPaymentDate` twice (lines 98, 105) — both must become settlement date | Task 2 detail |
| R4-M7 | Credit score `scorePaydown` uses `lastPaymentDate` from loan entry | Inherits settlement fix |
| R4-M8 | Activities `/activities` page uses `formatActivityDescription` — needs `loan.waiver` case | `activity.service.ts` (R1, separate from dashboard duplicate) |

### LOW

| ID | Finding |
|----|---------|
| R4-L1 | `query-keys.ts` — add `loanWaivers` namespace |
| R4-L2 | Waiver collection should mirror payments optimistic + invalidation pattern |
| R4-L3 | Elevated supervisor + `settings:update` — product decision (R2-H7) |

---

## Round 5 — Exhaustive Checklist (No New Findings)

Areas searched with **no additional gaps** beyond Rounds 1–4:

| Area | Result |
|------|--------|
| Rolled-over visibility plan | **Errata (2026-07-22):** Visibility shipped — waiver **must** use `assertLoanOperational`, `maybeUpdateLoanStatusAfterPayment`, operational collection sync. See [VISIBILITY-ALIGNMENT](./260722-loan-waiver-VISIBILITY-ALIGNMENT.md) |
| All server balance actions | Covered |
| API routes (`/api/cron/*`, `/api/reports/*`) | Covered via cron/report findings |
| `listLoanBalancesAction` / `loan-views` hooks | Uses compute engine — OK after settlement fix |
| `getPaymentPortionsCollection` | Payment-only by design; waiver portions need separate helper (R1) |
| Record payment / quick record balance preview | Uses balance collection — OK |
| Risk buckets on `/loans` | Same `useLoansWithBalances` path |
| Watchlist | Same page as `/loans` — not separate |
| Rate change approval | Accrual baseline auto-adjusts; no new gap |
| Location balances | Cash-only — waivers don’t touch Cash |
| Fund transfers / income / expense pages | No loan coupling |
| Receipt / POS flows | Cash events only |
| `lib/stores/*` | No balance derivation |
| `hooks/*` | Daily collections inherits compute path |
| Property/temporal/clock-mock tests | Need waiver scenarios (R1/R2) — test gap, not prod gap |
| Sentry / instrumentation | Inherits `withAction` |
| Better-auth permissions | `settings:update` pattern documented |
| FK / soft-delete on `loan_waivers` | In plan Task 1 |
| Concurrent waiver + payment | `FOR UPDATE` on loan in payment/waiver services — OK if both use it |
| Multiple waivers same loan | Sequential validation against current balance — integration test |
| Waive on non-active status | Blocked in plan |
| `getActivities` filters | Will show `loan.waiver` once formatter added |

---

## Master Checklist — All Surfaces (Final)

| Surface | Impact | Finding ID(s) | In plan? |
|---------|--------|---------------|----------|
| Ledger principal | Auto ✅ | — | Task 3 |
| Ledger interest | Auto ✅ + accrual reversal | C5, R3-C2 | Task 3 |
| UI overdue / unpaid interest | Settlement date | C1, R2-C1 | Task 2 |
| Last settlement date columns | computeOverdue + trigger | R2-C1, R2-C3 | Tasks 1–2 |
| Month-end accrual cron | Re-accrual risk | R2-C2 | Task 7 |
| Overdue cron penalty reset | Penalty waiver undone | R3-H1 | Task 7 |
| Loan detail running balance | Payment-only walk | R2-H1 | Task 8 |
| Global payments running balance | Payment-only walk | R4-H1 | Task 8 |
| Loan detail % repaid | Waivers as payments | R3-C1 | Task 10 |
| Term schedule table | Original principal | R3-H2 | Task 10 |
| Loan statement | Simulation gap | R2-H8, R3-H8 | Task 6 |
| Collateral settlement server | Accrued interest path | R2-H2 | Task 7 |
| Rollover prefill | Carried amounts | R2-H3 | Task 7 |
| Dashboard loans outstanding KPI | Auto ✅ | — | — |
| Dashboard interest earned KPI | CR inflates | R2-H4, R3-H6 | Task 8 |
| Dashboard overdue count | Settlement date | C1 | Task 2 |
| Dashboard activity feed | Missing case | R2-H5, R3-H5 | Task 6/8 |
| Dashboard status chart | Cache | R3-H7 | Task 8 |
| P&L report | Auto ✅ (Loan Losses line) | R2-M5 | Task 6 verify |
| Balance sheet | Auto ✅ | R2-M6 | Task 6 verify |
| Cashflow | Skip non-cash | — | Task 6 |
| Retained earnings | Auto ✅ + cache | R2-H6 | Task 8 |
| Portfolio report | Auto ✅ | R2-M4 | — |
| Active loans report | Last paid column | R2-C1, R2-M3 | Task 2 |
| Excel / print export | Last paid column | R2-M2, R4-M4 | Task 2/8 |
| Daily collections | Settlement date + copy | R2-M13, R4-M5 | Task 2 |
| Customer overdue filter | Auto ✅ | R2-M11 | — |
| Customer loan history | No waiver rows | R4-M3 | Task 10 optional |
| Credit score paydown | Ledger + lastPaymentDate | R2-H7, R4-M7 | Task 6 |
| Credit score timeliness | Payments only (intended) | — | Document |
| Payment overpayment cap | Fixed_rate principal | R3-M2 | Task 7 |
| Payment edit/mark wrong | Settlement date | R2-H9, R4-M6 | Task 2 |
| Quick record / loan search | Balance + sort | R2-M1, R4-H2 | Task 8/10 |
| Simulator panel | No waiver model | R2-M15 | Document |
| Transaction log / exports | Raw legs | R2-M9 | Task 8 |
| deleteLoan cleanup | Orphan journals | C4 | Task 4 |
| updateLoan (disabled) | Waiver drift | R3-M1 | Task 10 |
| Journal delete protection | systemReferenceTypes | C6 | Task 3 |
| Cache invalidation | Incomplete fan-out | R2-H6, R3-H7 | Task 8 |
| Email notification | Missing event | R1-H12 | Task 4 |
| Activities page | Formatter | R4-M8 | Task 6 |
| Reconcile / verify scripts | False positives | R2-C4, R3-M3/M4 | Task 9 |
| Cypress E2E | Missing + stale tests | R1-H10, R2-M18, R4-M2 | Tasks 6/9/10 |
| Fuzz / property tests | No waiver ops | R1-H9 | Task 9 |
| Permission elevation | Supervisor can waive | R2-H7 | Task 9 |
| SQL trigger LPD | Payment-only | R2-C3 | Task 1 |
| Dual unpaid_interest semantics | SQL vs engine | R3-C2 | Task 9 |

---

## Recommended Plan Additions (Task 10)

1. Fix `% repaid` / progress bar on loan detail (R3-C1)  
2. Fix LoanSearchCombobox balance display (R4-H2)  
3. Add `previewWaiverAllocationAction` for waiver dialog (R4-M1)  
4. Term schedule labeling or rebuild (R3-H2)  
5. Penalty waiver reset guard in overdue cron (R3-H1)  
6. Block `updateLoan` when waivers exist (R3-M1)  
7. Optional: waiver rows on customer loan history (R4-M3)  
8. Cypress: `loan-detail.cy.ts` repaid + waiver scenario (R4-M2)  
9. Copy updates: “Last Settlement”, daily collections (R4-M4/M5)

---

## Open Product Decisions (All Rounds)

**Locked 2026-07-22** — see [260722-loan-waiver-PLAN.md](./260722-loan-waiver-PLAN.md) Product decisions section.

| # | Decision |
|---|----------|
| 1 | Dashboard KPI → **net margin** (Interest Earned − Loan Losses) |
| 2 | **Admin-only** via `loan:waiver` (not `settings:update` / not elevated supervisors) |
| 3 | **Do not** auto-reset penalty waiver on interest waiver; reset only after payment catches up |
| 4 | **No** waiver rows on customer loan history |
| 5 | **No** rename to "Last Settlement" |

---

## Review Loop Status

```
Round 1 → Round 2 → Round 3 → Round 4 → Round 5 (converged)
  7C       4C        2C        0C        0C
 12H       9H        7H        2H        0H
```

**Conclusion:** The waiver feature touches **~45 distinct code paths**. The plan (Tasks 1–10) now covers all identified CRITICAL and HIGH gaps. Remaining MEDIUM/LOW items are copy, tests, optional UX, and product policy — not silent data corruption paths.
