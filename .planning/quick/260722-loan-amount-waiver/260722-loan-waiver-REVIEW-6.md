# Adversarial Review — Round 6

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-3-FINAL](./260722-loan-waiver-REVIEW-3-FINAL.md) (Rounds 1–5 converged on data paths)  
**Locked decisions:** Net margin KPI · `loan:waiver` admin-only · No penalty reset on interest waiver · No customer history · No column rename

Round 6 re-checks implementation traps from locked decisions and auth hardening. **Not fully converged** — 1 CRITICAL, 2 HIGH, 5 MEDIUM, 5 LOW (all fixable in plan Tasks 1–10).

---

## CRITICAL

### R6-C1 — `loan:waiver` in `adminExtras` auto-grants to elevated supervisors

| | |
|---|---|
| **File** | `src/lib/permissions.ts` (`adminExtras` → `adminSet` → `MANAGING_SUPERVISOR_ELEVATED`) |
| **Issue** | `MANAGING_SUPERVISOR_ELEVATED = [...adminSet].filter(exclude creditor/role/delegation/ip)`. Anything added to `adminExtras` is **included** in elevation unless explicitly excluded. Adding `loan:waiver` to `adminExtras` alone **violates locked decision #2**. |
| **Fix** | Add `loan:waiver` to `adminExtras` (admin + superAdmin get it) **and** add `p !== "loan:waiver"` (or `!p.startsWith("loan:waiver")`) to the `MANAGING_SUPERVISOR_ELEVATED` filter — same pattern as `creditor:*`. Test: `expect(MANAGING_SUPERVISOR_ELEVATED.has("loan:waiver")).toBe(false)`. |

---

## HIGH

### R6-H1 — `listLoanWaiversAction` must not use `loan:read`

| | |
|---|---|
| **File** | Planned Task 4 (`permission: "loan:read"`) |
| **Issue** | Loan officers / supervisors / elevated supervisors can call the list action directly and read waiver amounts + reasons even if UI is gated. |
| **Fix** | Gate **all** waiver read paths (`listLoanWaiversAction`, loan-detail waiver history query) on `loan:waiver`. |

### R6-H2 — Penalty reset needs settlement **kind**, not just date

| | |
|---|---|
| **Files** | `src/app/api/cron/overdue/route.ts`, Task 2, Task 10 |
| **Issue** | Locked #3: reset only when borrower catches up via **payment**. `getLastSettlementDate = MAX(dates)` fails when: (a) last event is waiver, (b) payment and waiver share the same date (tie). |
| **Fix** | Add `getLastSettlementEvent(loan) → { kind: "payment" \| "waiver"; date: Date }`. On tie at same timestamp, **payment wins**. Extend `shouldResetPenaltyWaiver(daysOverdue, penaltyWaived, lastSettlementKind)`. Tests in `overdue.test.ts` + `route.test.ts`. |

---

## MEDIUM

| ID | Finding | Fix |
|----|---------|-----|
| **R6-M1** | `permissions.test.ts` hardcoded catalog + length assertion breaks when adding `loan:waiver` | Update in Task 1/9 |
| **R6-M2** | No test that `MANAGING_SUPERVISOR_ELEVATED` excludes `loan:waiver` | Add to `permissions.test.ts` + auth integration test |
| **R6-M3** | `previewWaiverAllocationAction` (Task 10) permission unspecified | Require `loan:waiver` |
| **R6-M4** | `dashboard.ts` / `daily-collections.ts` missing `subscribeToTableChanges` for `loan_waivers` / `transactions` | Defense-in-depth alongside mutation invalidation (Task 8) |
| **R6-M5** | Credit score `scorePaydown` on `fully_paid` uses `lastPaymentDate` — after settlement fix, waiver-only closure looks like fast payoff | Document in Task 6; optionally use last **payment** date for paydown branch, not settlement date |

---

## LOW

| ID | Finding | Fix |
|----|---------|-----|
| **R6-L1** | `ActivityFeedItem.type` union lacks waiver variant | Add in Task 8 |
| **R6-L2** | Net margin still exposed as field name `interestEarned` in `DashboardKPIs` | Rename to `netInterestMargin` or document mapping (Task 8) |
| **R6-L3** | `collections/index.ts` won't export new collection | Add export |
| **R6-L4** | Side-by-side “Waive Penalty” (`settings:update`, elevated OK) vs “Waive Amount” (`loan:waiver`, admin only) | Tooltip / `PermissionInfo` copy on loan detail |
| **R6-L5** | Integration `seedCategories()` missing Loan Losses | Extend `setup.ts` (Task 1) |

---

## Revisions from locked decisions (applied to plan)

| Item | Revision |
|------|----------|
| Dashboard KPI | Net margin = Interest Earned − Loan Losses; add **Loan Losses** to `getDashboardKPIs` category query (currently only Loans Receivable, Interest Earned, Cash) |
| Admin-only | `loan:waiver` + **exclude from MANAGING_SUPERVISOR_ELEVATED** (R6-C1) |
| Penalty reset | Requires `getLastSettlementEvent`, not date-only |
| Customer history | Removed from scope |
| Column rename | Removed from scope; date value still fixed via settlement pipeline |

---

## Verified — no new gaps

Ledger posting · settlement date pipeline · accrual cron · running balances · statement · reports · `% repaid` · deleteLoan reversal · concurrent `FOR UPDATE` · migration 0027 · Cypress policy · waiver on non-active blocked · rate change / fund / issuance fee unaffected · rolled-over visibility alignment · `postJournalEntry` journal groups · activities `entityType: "loan"` for audit

---

## Convergence status

| Round | New CRITICAL | New HIGH | Verdict |
|-------|-------------|----------|---------|
| 1–5 | 13 total | 30 total | Data paths covered |
| **6** | **1** | **2** | Auth + settlement-kind semantics |

**After Task 1 adds MANAGING_SUPERVISOR_ELEVATED exclusion + Task 4 fixes list permission + Task 2/10 add settlement event kind:** review should converge for implementation.
