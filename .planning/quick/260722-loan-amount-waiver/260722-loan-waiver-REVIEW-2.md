# Adversarial Review — Round 2: Derivative Calculations & Reports

**Reviewed:** 2026-07-22  
**Scope:** Every surface that computes, displays, exports, or aggregates loan balances, interest, overdue, or financial data  
**Prior review:** [260722-loan-waiver-REVIEW.md](./260722-loan-waiver-REVIEW.md) (Round 1)

Round 2 searched the full codebase for derivative calculation paths **not fully covered** in Round 1. Findings below are additive.

---

## Executive Summary

Round 1 correctly identified the settlement-date pipeline as the biggest UI gap. Round 2 found **three additional CRITICAL paths** that post ledger entries but **won't stay consistent** without more work:

1. **`computeOverdue`** — uses accrual engine for overdue/unpaid but **overwrites `lastPaymentDate` from payments only**, breaking Excel export, active-loans report, and loan list "Last Paid" columns even after settlement-date fix in `loanBalanceData.ts`.
2. **Month-end accrual cron** (`accrueInterestForLoans`) — segments interest using **payment principal reductions only**; ignores waiver dates and principal waivers → can **re-accrue forgiven interest**.
3. **SQL `refresh_loan_balance` trigger** — `last_payment_date = MAX(payments.payment_date)` ignores waivers; Cypress/reconcile read this column.

Round 2 also found **reporting semantics issues**: dashboard `interestEarned` KPI **rises** on interest waiver (CR Interest Earned), and payment-table **running balance** ignores principal waivers.

---

## CRITICAL — New in Round 2

### R2-C1. `computeOverdue` discards settlement date from balance engine

| | |
|---|---|
| **First review** | PARTIAL (C1 fixed `getLastPaymentDate` in balance path only) |
| **Files** | `src/services/loan.service.ts` (`computeOverdue`, lines 1185–1204) |
| **Consumers** | `listActiveLoansWithOverdue`, `getLoansForExport`, Excel export (`exportLoansExcelAction`), active-loans report, loans list risk buckets |
| **Problem** | Reads `daysOverdue`/`unpaidInterest` from `computeLoanBalanceData` (OK after settlement fix) but sets `lastPaymentDate` from `loanPayments.at(-1)` — **payments only**. |
| **Fix** | `lastPaymentDate: balanceInfo.get(loan.id)?.lastPaymentDate ?? loan.startDate`. Rename export column to "Last Settlement" optionally. |

### R2-C2. Month-end accrual cron ignores waivers entirely

| | |
|---|---|
| **First review** | NO (M2 mentioned snapshots only) |
| **Files** | `src/services/transaction.service.ts` (`accrueInterestForLoans`, ~761–799), `src/lib/interest/engine.ts` (`computeSegmentedInterest`) |
| **Cron** | `src/app/api/cron/month-end/route.ts` → `accrueInterestForLoans` + `generateMonthlySnapshot` |
| **Problem** | Target accrual = `computeSegmentedInterest(principalPayments only) - totalInterestEarned`. Principal waivers don't reduce segments; interest waivers don't reset segment start. Cron can post **new accruals for already-forgiven interest**. |
| **Fix** | Extend `computeSegmentedInterest` (or wrapper) to accept settlement events: `{ date, principalReduction, interestSettlement }` from payments + waivers. Reset accrual segment on interest waiver date. Include waiver principal portions in balance walk. |

### R2-C3. SQL trigger `last_payment_date` is payment-only

| | |
|---|---|
| **First review** | PARTIAL (M9 noted column stale) |
| **Files** | `drizzle/0025_loan_balances_projection.sql` (line 33), `cypress.config.ts` (`db:neon:getLoanBalance`), `scripts/reconcile-loan-balances.ts` |
| **Problem** | `outstanding_balance` refreshes from transactions (OK). `last_payment_date = MAX(payments.payment_date)` stays wrong after interest waiver. |
| **Fix** | Migration `0027` or `0028`: update `refresh_loan_balance()` to `MAX(payment_date, waiver_date)` from non-deleted payments (non-wrong) + active waivers. Add `AFTER INSERT OR UPDATE OR DELETE ON loan_waivers` trigger calling `refresh_loan_balance(loan_id)`. |

### R2-C4. Reconcile script will false-alarm after waivers

| | |
|---|---|
| **First review** | PARTIAL (M3 "add note") |
| **Files** | `scripts/reconcile-loan-balances.ts` (~36–43, 74–80) |
| **Problem** | `expectedLpd = MAX(payments.payment_date)` only. Compares projection `unpaid_interest` to ledger Interest Earned net — **different semantics** from UI accrual engine; waivers amplify false positives. |
| **Fix** | Use `getLastSettlementDate`. Compare unpaid interest via `computeSingleLoanBalanceData`, not raw ledger Interest Earned. Add waiver journal sanity check (portions sum = waiver amount). |

---

## HIGH — New in Round 2

### R2-H1. Payment table running balance ignores principal waivers

| | |
|---|---|
| **Files** | `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` (~354–370), `payment-table.tsx` |
| **Problem** | `runningBalanceMap` walks payments subtracting principal portions from `loan.principalAmount`. Principal waivers don't reduce the column — historical balances overstated vs ledger. |
| **Fix** | Interleave waiver events chronologically (from `loanWaiversCollection` + `getWaiverPortionsFromLedger`) in the running-balance walk. |

### R2-H2. Collateral settlement accrued interest uses payment-only last date

| | |
|---|---|
| **Files** | `src/services/collateral-settlement.service.ts` (`computeAccruedInterest`, `settleWithCollateral`) |
| **Problem** | Server settlement computes accrued interest from last **payment** date, not last settlement. Post–interest-waiver, settlement can overstate accrued interest and post excess journals. UI dialog uses `computeSingleLoanBalanceData` (OK); **server path diverges**. |
| **Fix** | Replace payment-only date logic with `getLastSettlementDate` or use `computeSingleLoanBalanceData` total owed inside transaction. |

### R2-H3. Rollover prefill uses broken accrued-interest path

| | |
|---|---|
| **Files** | `src/services/collateral-settlement.service.ts` (`getCustomerActiveLoan`), `src/app/(app)/loans/new/page.tsx`, `RolloverBanner` |
| **Problem** | Rollover wizard carried interest/principal from `computeAccruedInterest` + payment history — not settlement-aware. Loan detail balances can be correct while rollover carries too much. |
| **Fix** | Use `computeSingleLoanBalanceData` or shared `getLoanBalanceSummary` for rollover prefill. |

### R2-H4. Dashboard `interestEarned` KPI misleading on interest waiver

| | |
|---|---|
| **Files** | `src/services/dashboard.service.ts` (`getDashboardKPIs`, lines 74–94), `src/app/(app)/dashboard/page.tsx` |
| **Problem** | KPI = net Interest Earned (CR − DR). Interest waiver posts **CR Interest Earned** → KPI **increases** while DR Loan Losses is not reflected in this KPI. |
| **Fix** | Option A: exclude `referenceType in ('loan_waiver','loan_waiver_reversal')` from Interest Earned KPI aggregation. Option B: replace with net lending margin KPI (interest earned − loan losses). Update info-popover copy. |

### R2-H5. Dashboard recent activity duplicates activity.service gap

| | |
|---|---|
| **Files** | `src/services/dashboard.service.ts` (`getRecentActivity`, ~245–385) |
| **Problem** | Parses audit log independently. No `loan.waiver` case → generic description, no amount/portions. |
| **Fix** | Add branch mirroring planned `activity.service.ts` formatter. |

### R2-H6. Cache invalidation incomplete for waiver mutations

| | |
|---|---|
| **Files** | `src/lib/cache-invalidation.ts`, `src/collections/reports.ts` |
| **Problem** | `invalidateLendingProjections` covers KPIs, P&L, balance sheet, portfolio, loan balances. Misses: **retained earnings**, **cashflow**, **activities**, **active loans report** (via loan list refresh), **daily collections**. |
| **Fix** | Waiver collection calls `invalidateLendingProjections` + `invalidateQueries` for activities, retained earnings, daily collections, active-loans. Consider adding `invalidateAllReports(qc)` helper. |

### R2-H7. Delegated managing supervisor can waive (broader than "admin-only")

| | |
|---|---|
| **Files** | `src/lib/permissions.ts` (`MANAGING_SUPERVISOR_ELEVATED`), `src/lib/action-utils.ts` |
| **Problem** | `settings:update` is in `MANAGING_SUPERVISOR_ELEVATED`. Elevated supervisors get waiver permission — same as penalty waive today, but may exceed "admin-only" product intent. |
| **Fix** | Product decision: accept (consistent with penalty waive) OR add dedicated `loan:waiver` excluded from elevation OR check `ROLE_LEVELS >= admin` in action directly. |

### R2-H8. Loan statement simulation incomplete (beyond event kind)

| | |
|---|---|
| **Files** | `src/lib/loan-statement.ts` |
| **Problem** | Round 1 planned adding `kind: "waiver"` event. Round 2: day-walk loop must also reduce `balance`, bump `cumulativePaid` on interest waiver, reset accrual cycle — or `finalState.totalDue` / `netUnpaidInterest` stay wrong. |
| **Fix** | Full chronological interleaving of waivers in simulation loop, not just event list append. |

### R2-H9. `markPaymentWrong` reallocation uses payment-only last date

| | |
|---|---|
| **Files** | `src/services/payment.service.ts` (~1288–1302) |
| **Problem** | Reallocation path calls `getLastPaymentDate`, not settlement date. Wrong overdue context when marking wrong near a waiver. |
| **Fix** | Switch to `getLastSettlementDate` (same Task 2 as balance engine). |

---

## MEDIUM — New in Round 2

| ID | Area | Files | Issue | Fix |
|----|------|-------|-------|-----|
| R2-M1 | Quick Record Dialog | `QuickRecordDialog.tsx` | Sorts recent loans by projection `lastPaymentDate` | Use settlement date from balance join |
| R2-M2 | Excel export | `excel.service.ts`, `loan.actions.ts` | "Last Payment" from `computeOverdue` | Fix upstream `computeOverdue`; optional rename |
| R2-M3 | Active loans report | `reports/active-loans/` | Via `listActiveLoansWithOverdue` → `computeOverdue` | Same fix as R2-C1 |
| R2-M4 | Portfolio report | `report.service.ts` `getPortfolioData` | Uses `computeSingleLoanBalanceData` — **OK after settlement fix** | Verify only; no code change |
| R2-M5 | P&L report | `getPnlData` | Auto-includes Loan Losses expense + Interest Earned credit — **net P&L correct** | Document; add integration test |
| R2-M6 | Balance sheet | `getBalanceSheetData` | Loans Receivable CR reduces assets; Loan Losses DR increases expenses — **OK** | Verify Interest Receivable after accrual reversal (C5) |
| R2-M7 | Retained earnings | `getRetainedEarningsData` | Aggregates all revenue/expense — waiver flows through correctly | Invalidate cache on waiver (R2-H6) |
| R2-M8 | Financial snapshots | `generateMonthlySnapshot` | Point-in-time; backdated waivers won't retro-edit | Document; accrual cron fix (R2-C2) prevents post-waiver drift before snapshot |
| R2-M9 | Transaction log / exports | `TransactionLogClient.tsx`, `pdf.service.ts`, `excel.service.ts` | Two ledger legs per waiver; no grouped label | Add `referenceType` label map |
| R2-M10 | Collection wire schema | `lib/schemas/collections.ts` | No `loanWaiverSchema` | Add via `createSelectSchema(loanWaivers)` |
| R2-M11 | Customer search filter | `customer.service.ts` | Uses `computeSingleLoanBalanceData` for overdue filter — **OK after settlement fix** | Verify only |
| R2-M12 | Customer detail page | `customers/[id]/page.tsx` | Joins loan balances via collections — **OK after settlement fix** | Verify only |
| R2-M13 | Daily collections | `daily-collections.service.ts` | `getLoansDueToday` uses `computeLoanBalanceData` — **OK**; `lastPaymentDate` from info — fixed by settlement date | Verify |
| R2-M14 | Credit score badge | `credit-score-badge.tsx` | Principal waiver improves paydown; timeliness unchanged | Document in popover |
| R2-M15 | Simulator panel | `simulator-panel.tsx` | Baseline uses payment-only history | Drive from props; document "doesn't model waivers" |
| R2-M16 | Audit script | `scripts/audit-amounts.ts` | No waiver amount validation | Add check |
| R2-M17 | Property/stateful tests | `property-based.test.ts`, `stateful-model.test.ts` | "waiver" tests are penalty-only | Add amount-waiver scenarios |
| R2-M18 | Cypress | `loan-balance-live.cy.ts`, `cypress.config.ts` | Asserts trigger table directly; LPD won't move on interest waiver | Update for waiver scenarios |
| R2-M19 | `loan-views.ts` | `useLoansWithBalances`, etc. | Fallback `lastPaymentDate` from projection | Fixed by R2-C3 trigger update |
| R2-M20 | Email | `lib/email.ts` | No `loan.waiver` event | Already in plan Task 4 |

---

## LOW — New in Round 2

| ID | Item | Notes |
|----|------|-------|
| R2-L1 | Dashboard KPI copy | Info-popovers don't mention write-downs |
| R2-L2 | Income/expense pages | `manualOnly: true` — waivers correctly excluded |
| R2-L3 | Fund transfers | No loan coupling |
| R2-L4 | Rate change dialogs | Accrual picks up new rate on reduced principal automatically |
| R2-L5 | Receipt/POS | Non-cash; no waiver receipt v1 |
| R2-L6 | Sentry tags | Optional `source: "loan.waiver"` |
| R2-L7 | `effective-rate-client.ts` | Uses projected outstanding balance — OK after principal waiver |

---

## Complete Surface Matrix (Both Rounds)

Legend: ✅ auto-OK after ledger + settlement fix | ⚠️ needs explicit code | ❌ broken without fix | ➖ not applicable

| Surface | Principal waiver | Interest waiver | Round 2 status |
|---------|-----------------|-----------------|----------------|
| Loans list — principal balance | ✅ ledger | ✅ ledger | OK |
| Loans list — unpaid interest / overdue | ⚠️ settlement date | ❌ settlement date | R2-C1, R1-C1 |
| Loans list — last paid column | ❌ computeOverdue | ❌ computeOverdue | R2-C1 |
| Loan detail — info cards | ✅ | ⚠️ settlement date | R1-C1 |
| Loan detail — payment running balance | ❌ payment-only walk | ➖ | R2-H1 |
| Loan detail — simulator | ⚠️ props refresh | ⚠️ no waiver model | R2-M15 |
| Loan detail — statement | ❌ simulation gap | ❌ simulation gap | R2-H8 |
| Record payment / quick record | ✅ caps on total owed | ✅ | OK after settlement |
| Collateral settlement (server) | ⚠️ ledger OK | ❌ accrued interest path | R2-H2 |
| Rollover wizard | ⚠️ ledger OK | ❌ carried interest | R2-H3 |
| Dashboard — loans outstanding KPI | ✅ | ✅ | OK |
| Dashboard — interest earned KPI | ➖ | ❌ CR inflates KPI | R2-H4 |
| Dashboard — overdue count | ⚠️ | ⚠️ settlement date | R1-C1 |
| Dashboard — activity feed | ❌ missing case | ❌ | R2-H5 |
| P&L report | ✅ Loan Losses line | ✅ net correct | R2-M5 verify |
| Balance sheet | ✅ | ✅ | R2-M6 verify |
| Cashflow report | ➖ non-cash skip | ➖ | OK (plan Task 6) |
| Retained earnings | ✅ net flows | ✅ | R2-H6 cache |
| Portfolio report | ✅ | ⚠️ settlement date | R2-M4 verify |
| Active loans report | ✅ balance | ❌ last paid + overdue | R2-C1, R2-M3 |
| Excel loan export | ✅ balance | ❌ last paid | R2-M2 |
| Excel/PDF transaction export | ⚠️ raw legs | ⚠️ raw legs | R2-M9 |
| Daily collections | ✅ | ⚠️ settlement date | R2-M13 |
| Customer overdue filter | ✅ | ⚠️ settlement date | R2-M11 |
| Credit score | ✅ paydown | ➖ timeliness unchanged | R2-M14 |
| Month-end accrual cron | ❌ segments | ❌ re-accrues forgiven | R2-C2 |
| Overdue cron | ⚠️ | ⚠️ settlement date | R1-C1 |
| Financial snapshots | ✅ at capture time | ⚠️ pre-fix accrual drift | R2-C2, R2-M8 |
| `loan_balances` trigger — balance | ✅ | ✅ | OK |
| `loan_balances` trigger — LPD | ❌ | ❌ | R2-C3 |
| Reconcile script | ⚠️ | ❌ false positives | R2-C4 |
| deleteLoan cleanup | ❌ | ❌ | R1-C4 |
| Transaction delete protection | ❌ | ❌ | R1-C6 |
| Cypress balance-live | ⚠️ | ❌ LPD assertion | R2-M18 |

---

## Round 1 Items — Additional Detail from Round 2

| Round 1 ID | Round 2 detail |
|------------|----------------|
| C1 settlement date | Must propagate to: `computeOverdue`, SQL trigger, reconcile, `markPaymentWrong`, `computeAccruedInterest`, accrual cron segmentation — **not just `loanBalanceData.ts`** |
| Dashboard KPIs | `loansOutstanding`/`overdueCount` OK; **`interestEarned` KPI broken semantics** on interest waiver |
| Balance sheet / P&L | Category aggregation auto-correct; net retained earnings OK |
| Portfolio / active loans | Balance OK; **Last Payment columns broken** |
| Daily collections | Cash totals payment-only (correct); overdue list OK after settlement fix |
| Rollover | Detail balances OK; **prefill path separate and broken** |
| Financial snapshots | Accrual cron can re-accrue post-waiver **before** snapshot if R2-C2 not fixed |
| Reconcile script | Needs **code changes**, not documentation note |
| Cache invalidation | Must include retained earnings, activities, daily collections |
| `loan_balances` trigger | Balance OK; **LPD column needs SQL fix** |

---

## Confirmed OK (No Action)

- Income/expense pages (manual only)
- Fund transfers
- Creditor flows
- Cashflow (non-cash skip)
- Payment receipts / POS (cash events)
- Rate change approval workflow (no separate balance recompute)
- Portfolio `outstandingBalance` and `interestAccrued` columns (after settlement fix)
- Customer search overdue filter (uses `computeSingleLoanBalanceData`)
- P&L net profit (Loan Losses + Interest Earned net correctly)
- Balance sheet asset totals (Loans Receivable CR)

---

## Revised Implementation Priority (After Round 2)

| Priority | Work item | Blocks |
|----------|-----------|--------|
| P0 | `getLastSettlementDate` everywhere | UI overdue, exports, cron inputs |
| P0 | Fix `computeOverdue` lastPaymentDate | Active loans report, Excel, list columns |
| P0 | Accrual cron waiver-aware segmentation | Month-end re-accrual of forgiven interest |
| P0 | SQL trigger LPD + waiver trigger | Projection column, Cypress, reconcile |
| P1 | Waiver service + ledger + deleteLoan reversal | Core feature |
| P1 | Running balance + statement simulation | Loan detail accuracy |
| P1 | Collateral settlement + rollover alignment | Settlement/rollover correctness |
| P2 | Dashboard KPI semantics + activity feed | Reporting UX |
| P2 | Cache invalidation completeness | Stale report pages |
| P2 | Transaction log labels + exports | Audit readability |
| P3 | Tests (fuzz, property, Cypress, reconcile) | Regression safety |
| P3 | Permission elevation decision | Access control policy |

---

## Open Product Decisions (Round 2 Additions)

1. **Dashboard interest KPI:** Exclude waiver CR legs, or show net margin (interest − loan losses)?
2. **Elevated supervisor:** Can delegated managing supervisors waive (via `settings:update`), or strict admin-only?
3. **Export column naming:** Rename "Last Payment" → "Last Settlement" across Excel/active-loans report?
4. **Running balance column:** Recalculate with waivers interleaved, or hide column when waivers exist?

---

## Review Loop Status

| Round | Findings | Plan updated |
|-------|----------|--------------|
| Round 1 | 7 critical, 12 high | Yes — Tasks 1–6 |
| Round 2 | 4 new critical, 9 new high, 20 medium | Yes — Tasks 7–9 added to PLAN |
