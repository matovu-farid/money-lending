# Rolled-Over Loan Visibility & Calculation Audit

## Problem Statement

When a new loan is issued with rollover (merging an existing loan's balance into a new loan), the system correctly:

- Closes the old loan as `rolled_over`
- Creates a new `active` loan with `rolledOverFrom` pointing to the predecessor
- Transfers principal/interest on the ledger

But **operational surfaces still show both loans**, because list queries only filter `deletedAt IS NULL`, not loan lifecycle status. Rolled-over loans land in the "early" bucket (`daysOverdue = 0`) and inflate counts, exports, and print totals.

**Goal:** Treat rolled-over loans as **historical records**, not live portfolio loans. Show only the current loan on operational pages; expose predecessor history from the successor loan detail page.

---

## Terminology

| User term | Codebase term | DB signal |
|-----------|---------------|-----------|
| Merge into new loan | **Rollover** | Old: `status = 'rolled_over'` |
| Latest / surviving loan | Successor loan | `status = 'active'`, `rolledOverFrom = <old id>` |
| Merged / superseded loan | Predecessor loan | `status = 'rolled_over'` |

There is no separate `mergedInto` column today. Successor ID exists only in audit logs (`rolledIntoLoanId`). We should add a query helper rather than a migration unless we want a denormalized reverse FK.

---

## Current State (Verified)

### What Works

- Rollover logic in `createLoan` (`src/services/loan.service.ts`)
- Ledger transfer via `autoPostRolloverPrincipalTransfer` (zeros old loan receivable)
- Single-active-loan constraint
- Dashboard KPIs, portfolio report, overdue cron, interest accrual → already **`status = 'active'` only**
- Credit score intentionally scores `rolled_over` at 0.5 completion

### What's Broken / Inconsistent

| Surface | Issue |
|---------|-------|
| `/loans` page | `useLoansWithBalances()` returns **all** non-deleted loans |
| Loan export/print | `getLoansForExport()` → all loans, no status filter |
| `listLoans()` / `loanCollection` | Returns all statuses (feeds multiple UI surfaces) |
| `computeAllLoansBalanceData()` | Computes balances for every non-deleted loan |
| Loan detail (successor) | No link to predecessor chain despite `rolledOverFrom` being populated |
| Customer page | Shows all loans in "Loan History" (acceptable, but no rollover chain context) |

---

## Proposed Model

Introduce a single shared concept:

```typescript
// src/lib/loan-visibility.ts (new)
export const OPERATIONAL_LOAN_STATUS = "active" as const;

export function isOperationalLoan(status: LoanStatus): boolean {
  return status === "active";
}

export function isHistoricalLoan(status: LoanStatus): boolean {
  return status !== "active" && status !== "pending";
}
```

**Operational loans** (`active`): appear on watchlists, exports, aggregations, payment pickers.

**Historical loans** (`rolled_over`, `fully_paid`, `settled_with_collateral`): preserved for audit, credit score, statements, receipts; reachable via direct URL and history UI.

> Note: `fully_paid` and `settled_with_collateral` should also be excluded from the loans watchlist — same reasoning as rolled-over. The page is an overdue watchlist, not an archive.

---

## Implementation Plan

### Phase 1 — Shared Visibility Rules (Foundation)

**1.1** Add `src/lib/loan-visibility.ts` with helpers above.

**1.2** Add server-side query variants in `loan.service.ts`:

| Function | Change |
|----------|--------|
| `listLoans()` | Keep as-is (500-cap newest loans — **not** operational or historical source of truth) |
| `listOperationalLoans()` | New: uncapped SQL `status = 'active' AND deletedAt IS NULL`, **same `LoanWithCustomer` select + `orderBy(desc(createdAt))` as `listLoans` (R25-2/R25-4)** |
| `getLoansForExport()` | Switch to **`listOperationalLoans()`** (not `listLoans().filter`) |
| `listActiveLoansWithOverdue()` | Rewire to **`listOperationalLoans()`** — today calls capped `listLoans()` (R15-2) |

**1.3** Add predecessor/successor helpers:

```typescript
getLoanPredecessorChain(loanId): Loan[]   // walk rolledOverFrom backwards
getLoanSuccessor(loanId): Loan | null     // find loan WHERE rolledOverFrom = loanId
```

No schema migration required initially; query by `rolledOverFrom`.

**1.4** On-demand loan reads (fixes R13-1 — uncapped access outside `listLoans` sync window):

| Function | Purpose |
|----------|---------|
| `getLoanListEntryById(loanId)` | Single-loan server read + `computeOverdue([loan])` — no 500 cap |
| `getLoanWithBalanceAction` | Expose via `withAction` for client fallback |

Client pattern (mirror `loan-extras.ts` per-id collections — **with R25-3 bound caveat**):

- `useLoanWithBalance(loanId)`: join `loanCollection` as today; **after sync ready**, if loan missing → fetch via `getLoanWithBalanceAction` query collection
- Prevents `/loans/[id]` "Loan not found" redirect for historical predecessors outside the newest-500 sync
- **Do not** silently inherit `MAX_PER_ID_CACHED = 32` FIFO for history deep links: raise bound, use LRU, or avoid tearing down the *currently viewed* loan’s collection on eviction (R25-3)

---

### Phase 2 — Operational UI Filtering

**2.1 Loans page (`/loans`)**

- **Do not** rely on filtering `status === 'active'` from the 500-cap `loanCollection` alone (R15-1) — active loans outside the newest-500 window would still be invisible.
- Add `operationalLoanCollection` syncing via **`listOperationalLoansAction`** (uncapped active-only SQL with **server `customerName`/`customerContact`**), joined with `loanBalanceCollection` in `useOperationalLoansWithBalances()`.
- **Prefer server customer fields** — do **not** overwrite names from 500-cap `customerCollection` join (R25-2). Optional enrich only when customer is present in sync.
- Keep capped `loanCollection` for surfaces that tolerate partial sync; historical/on-demand paths use Phase 1.4 + 2.4.

Files:

- `src/collections/loans.ts` (or new `operational-loans.ts` collection)
- `src/collections/loan-views.ts`
- `src/app/(app)/loans/page.tsx`
- `src/services/loan.service.ts` (`getLoansForExport`, `listActiveLoansWithOverdue`)

**2.2 Other consumers of `useLoansWithBalances`**

| Consumer | Action |
|----------|--------|
| `customers/page.tsx` (overdue filter) | Switch to operational hook |
| `payments/PaymentsClient.tsx` | Audit usage; filter active if used for loan lookup |
| `payments/QuickRecordDialog.tsx` | Already filters active client-side → switch hook |
| `payments/LoanSearchCombobox.tsx` | Already filters active → switch hook |

**2.3 Customer detail page**

- Keep showing full loan history (credit score + audit need it)
- Visually de-emphasize non-active loans (badge already shows status)
- Optional: collapse historical loans under an accordion

**2.4 Customer loan history — uncapped source (R13-2)**

`useLoansForCustomer` today filters the global 500-cap `loanCollection`. Customers with many loans over time can **lose** older `rolled_over` rows from customer history and credit score.

- Add `getCustomerLoansCollection(customerId)` in `loan-extras.ts` wrapping existing **`getCustomerLoansWithOverdueAction`** (uncapped per customer, already implemented server-side)
- Replace `useLoansForCustomer` on customer detail + `CreditScoreBadge` with this collection-backed hook
- Operational watchlist surfaces still use `useOperationalLoansWithBalances()` — do not conflate

**2.5 Payments page — loan join survivability (R15-3)**

`PaymentsClient` inner-joins `paymentCollection` ⋈ `loanCollection`. Payments on loans outside the 500-cap sync **vanish from `/payments`** (not just wrong running balances — R3 B3).

- Change display join to **left join** on loans (keep payment rows always)
- For `loanId` missing from `loanCollection`, resolve customer/name via **`getLoanListEntryById` batch fallback** or payment row denormalization
- Running-balance principal map: operational loans only (R3 B3); payment rows INCLUDE all statuses

**2.6 Customers page — server search for loan filters (R19-2)**

When `loanStatus` or `daysRemainingFilter` is set, call **`searchCustomersAction`** (after R17-5 server `loanStatus` support). Do **not** filter `customerCollection` × capped `loanCollection` client-side for those modes.

---

### Phase 3 — Rollover History UI on Successor Loan Page

**3.1** On active loan detail (`loan-detail-client.tsx`), when `rolledOverFrom` is set:

- Show banner: "This loan includes balance rolled over from a previous loan"
- Add **"View loan history"** button → opens drawer/dialog or navigates to `/loans/[id]/history`

**3.2** History view (new component or section):

- Walk predecessor chain via `getLoanPredecessorChain`
- For each predecessor show: loan ID, dates, principal, status, carried amounts, link to read-only detail
- Display rollover audit entries from activity feed

**3.3** Predecessor loan detail page (`rolled_over`):

- Banner: "This loan was rolled into [successor link]"
- Use `getLoanSuccessor(predecessorId)` for reverse link
- Disable actions: record payment, settle, rate change, issue new loan from this loan

---

### Phase 4 — Calculation & Aggregation Audit

#### Already Safe (No Change Needed)

| Area | Why Safe |
|------|----------|
| Dashboard KPIs (`activeBorrowers`, `overdueCount`) | Active-only query |
| Portfolio report (`getPortfolioData`) | Active-only |
| Active loans report | Active-only |
| Daily collections due-today | Active-only |
| Interest accrual cron | Active-only |
| Overdue cron | Active-only |
| Payment search (`searchActiveLoans`) | Active-only |
| Collateral settlement | Requires active loan |
| Credit score | Should **include** rolled_over history |

#### Must Change

| Area | Change |
|------|--------|
| `/loans` page stat cards | Exclude non-active |
| `getLoansForExport()` | Operational-only |
| Print HTML builder on loans page | Same filter as table |
| `computeAllLoansBalanceData()` | **Zero non-active with early-return (R11-1 / R19-3)** — do **not** filter the balance feed to active-only (historical detail + payments joins need rows; R23) |
| `customers/page.tsx` overdue filter | Use operational loans only |

#### Verify (Ledger-Dependent, Likely OK)

| Area | Verification |
|------|--------------|
| Balance sheet `totalLoansOutstanding` | Ledger sum; rolled-over loan should be zero after transfer |
| Dashboard `loansOutstanding` | Same |
| P&L / cashflow | Historical payments on old loans are real events — keep |
| `loan_balances` DB projection | Can remain for all loans; add integrity check |

**4.1 Data integrity guard**

Add reconciliation check (script or test):

```
For each loan WHERE status = 'rolled_over':
  assert ledger balance ≈ 0
  assert successor exists WHERE rolledOverFrom = old.id
```

Flags rollover posting failures that would cause double-counting even after UI filtering.

---

### Phase 5 — Server Action Hardening

Block mutations on non-operational loans:

| Action | Guard |
|--------|-------|
| Record payment | Reject if `status !== 'active'` |
| Edit/delete payment / mark wrong | Reject if parent loan not operational (R4-3) |
| Settle with collateral | Already guarded |
| Rate change request | Reject if not operational (create, apply, approve); **auto-cancel pending on loan closure** (rollover, settle, fully_paid) |
| Penalty waive/adjust | Reject if not operational |
| Delete loan | **D1 default (R21-3 / R23):** **block** delete of rollover successors (`rolledOverFrom` set) and of `rolled_over` predecessors that still have a non-deleted successor. Do **not** preserve successor-delete reversal as the happy path. |

---

### Phase 6 — Tests

**Unit tests**

- `loan-visibility.ts` helpers
- `getLoanPredecessorChain` / `getLoanSuccessor`
- `getLoansForExport` excludes `rolled_over`
- `computeOverdue` behavior for non-active
- **`scorePaydown` for `rolled_over` with zero display balance** — must not inflate paydown to ~1.0 (R13-3)

**Integration tests**

- Rollover → old loan absent from `listOperationalLoans`
- Rollover → ledger balance on old loan = 0
- Multi-hop chain A→B→C resolves correctly

**Cypress E2E** (per project policy)

New spec: `cypress/e2e/rollover-loan-visibility.cy.ts`

1. Create customer + loan
2. Issue rollover loan
3. `/loans` shows **one** row for customer (the new loan)
4. Old loan **not** in list
5. New loan detail → "View loan history" → predecessor visible
6. Direct URL to old loan still works (read-only)
7. Export excludes rolled-over loan

Extend `collateral-settlement.cy.ts` / `perpetual-threshold-rollover.cy.ts` if needed.

---

## Adversarial Review — Round 1

Simulated reviewer challenges and responses:

| # | Challenge | Severity | Response / Plan Fix |
|---|-----------|----------|---------------------|
| 1 | **Ledger not zeroed** → hiding UI doesn't fix double-count on balance sheet | Critical | Add Phase 4.1 integrity check; fix rollover posting bugs if found |
| 2 | **Multi-hop rollover** (A→B→C): history UI only shows one level | High | `getLoanPredecessorChain` walks full chain recursively |
| 3 | **No reverse FK**: finding successor requires scan | Medium | Query `WHERE rolledOverFrom = :id`; add index if slow (likely fine at 500-loan scale) |
| 4 | **`fully_paid` still on loans page** — same UX bug, different cause | High | Filter all non-active, not just `rolled_over` |
| 5 | **Customer page still shows both** — user might still be confused | Medium | Keep history section but label clearly; optional collapse |
| 6 | **Credit score breaks** if we filter rolled_over globally | Critical | Never filter in `useLoansForCustomer`; only operational hooks |
| 7 | **Payment recorded on rolled_over loan** via direct API | High | Phase 5 server guards |
| 8 | **`computeAllLoansBalanceData` still runs for all** — perf + wrong overdue on collection | Medium | Filter in `listLoanBalances` action or skip non-active in projection feed |
| 9 | **Delete successor loan** — what happens to predecessor? | High | Audit `deleteLoan` reversal; ensure predecessor can't become "active" accidentally |
| 10 | **Backdated rollover** — predecessor dates vs successor | Low | History UI shows both dates; no calc change |
| 11 | **Activity feed / audit** must remain visible | Low | History view pulls audit entries |
| 12 | **Loan distribution chart** counts `rolled_over` separately | Low | Correct behavior — chart is status breakdown, not watchlist |
| 13 | **Export before fix deployed** — historical bad exports | Low | One-time; no migration |
| 14 | **Direct URL to rolled_over loan** must not 404 (unlike soft delete) | High | Explicit requirement: historical loans remain accessible |
| 15 | **Payments page** joins all loans for display names | Medium | Audit `PaymentsClient`; historical payments on old loans should still show loan link |
| 16 | **Rollover with zero carried principal** (interest-only carry) | Medium | History still shows link; ledger check still applies |
| 17 | **User says "merge" but code says "rollover"** | Low | UI copy: "Rolled over" / "Previous loan" — consider alias in history UI |
| 18 | **500 loan cap in listLoans** | ~~Low~~ **Critical (R13-1)** | Was "out of scope" — **reopened**: cap breaks SC #2 (direct URL) and Phase 3 predecessor links when older loans fall off sync; see Round 13 |
| 19 | **`pending` loans** — should they appear? | Low | Exclude from watchlist (not active) |
| 20 | **Soft delete vs rolled_over** — different semantics | High | Do not conflate; rolled_over ≠ deleted |

---

## Adversarial Review — Round 2 (After Fixes)

Re-reviewing the updated plan:

| Remaining Gap | Resolution |
|---------------|------------|
| Delete successor loan edge case | Add explicit test: verify predecessor stays `rolled_over`, document whether manual status revert is allowed |
| `listLoans` still feeds `loanCollection` with all statuses | ~~Filter at hook layer only~~ **Superseded by R15-1**: uncapped `operationalLoanCollection` for watchlist; keep capped `loanCollection` for partial cache / non-operational joins |
| Balance projection triggers on rolled_over loans | Acceptable for historical accuracy; add note in reconciliation script |
| Watchlist duplicate rows if customer has active + fully_paid | Resolved by active-only filter |
| Global search / command palette for loans | Grep for loan search surfaces during implementation |

**Verdict after 2 rounds:** Plan is complete for the stated scope. Implementation should follow Phases 1→6 in order.

---

## Adversarial Review — Round 3 (Deep Code Audit)

A third pass searched mutation entry points, collection sync paths, deep links, and delete/reversal flows not covered in Rounds 1–2.

### New findings (22 gaps)

#### A. Mutation paths still open on rolled-over loans

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| A1 | `/loans/[id]/payments/new` | **Critical** | Page only guards `deletedAt IS NULL`, not `status === 'active'`. Direct URL allows payment recording on predecessor — mirror `soft-deleted-loan-hidden.cy.ts`. |
| A2 | `recordPaymentWithTxid()` | **Critical** | No active-loan guard at service layer (Phase 5 mentioned but not wired to UI entry point). |
| A3 | `waivePenalty()` / `adjustPenaltyMultiplier()` | **High** | No status check. `loan-info-cards.tsx` gates on `penaltyActive`, not loan status. Collection `onUpdate` in `loans.ts` forwards to actions without status check. |
| A4 | Rate change create/apply/approve | **High** | `createRateChangeRequest()`, `applyRateChangeImmediately()`, and approval apply path in `rate-change-request.service.ts` accept any non-deleted loan. |
| A5 | `updateLoan()` service | **Medium** | UI disables edit on non-active, but service has no guard — callable via action if permission exists. |
| A6 | "Issue New Loan" on predecessor detail | **Medium** | `loan-detail-client.tsx` line ~561: link is **not** gated by `status === 'active'`. User can attempt new loan from rolled-over page (createLoan may reject if active exists, but UX is wrong). |

#### B. Operational surfaces not in file touch list

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| B1 | `/approvals` page | **High** | Loads full `loanCollection`; pending rate-change rows link to `/loans/[id]` even when loan is non-operational. |
| B2 | Customer "Rolled Over" filter | **Medium** | `customer-search-bar.tsx` exposes deliberate filter for `rolled_over` loans. Plan only addressed overdue filter on customers page — decide: audit tool (keep) vs operational surface (restrict). |
| B3 | `PaymentsClient` `allLoansRaw` | **Medium** | Raw `loanCollection` join used for running-balance math across **all** statuses; can corrupt balance display for payments on predecessor loans. |
| B4 | `loanBalanceCollection` sync | **Low** | `computeAllLoansBalanceData()` feeds balance rows for every non-deleted loan to every client. Acceptable for history, but wastes sync bandwidth. |
| A7 | `getCustomerLoansWithOverdueAction` | **Low** | Unguarded server action surface (no current UI caller, but exposed). |

#### C. Calculation / aggregation gaps

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| C1 | `computeOverdue()` non-active balances | **High** | Sets `daysOverdue = 0` for non-active but still returns `outstandingBalance` from ledger (or `principalAmount` fallback). Rolled-over loans with ledger bugs land in "early" bucket with non-zero balance — inflates stat cards even before hook filtering if any caller skips filter. |
| C2 | `computeOverdue()` fix scope | **Medium** | Plan should explicitly zero or omit `outstandingBalance` / `unpaidInterest` for historical statuses at the source, not rely on UI filtering alone. |

#### D. Delete / reversal edge cases

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| D1 | Delete successor loan | **Critical** | `deleteLoan()` reverses rollover ledger entries on the **successor** when `rolledOverFrom` is set, but **does not revert predecessor status** back to `active`. Predecessor stays `rolled_over` with no successor — orphaned chain. Round 2 noted this; code confirms no status revert. |
| D2 | Delete predecessor loan | **High** | No guard preventing soft-delete of a `rolled_over` loan that still has audit/history value. May break successor's `rolledOverFrom` FK (`onDelete: set null`). |
| D3 | Orphan detection | **High** | Reconciliation should assert: every `rolled_over` loan has a live successor (`WHERE rolledOverFrom = id`), and every successor's `rolledOverFrom` points to an existing non-deleted predecessor. |

#### E. Navigation / deep links

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| E1 | Activity feed | **Medium** | `getActivityHref()` always links to `/loans/[id]` — rollover audit entries point at predecessor with full mutation UI. |
| E2 | Dashboard recent activity | **Medium** | Same pattern via `getRecentActivity()`. |
| E3 | Admin email notifications | **Medium** | `resolveLoanContext()` / `notifyAdmin()` deep-link to `/loans/${loanId}` — payment on predecessor routes staff to mutable page. |
| E4 | Customer history links | **Low** | Links to predecessor detail (acceptable for history) but lands on mutable page, not read-only view. |

#### F. Testing gaps

| # | Surface | Severity | Detail |
|---|---------|----------|--------|
| F1 | Cypress soft-delete pattern | **High** | Extend `soft-deleted-loan-hidden.cy.ts` pattern: `/loans/[id]/payments/new` must fail-closed for `rolled_over`. |
| F2 | Existing rollover E2E | **Medium** | `collateral-settlement.cy.ts` asserts `/loans` list renders post-rollover — may assert wrong row count after fix. |
| F3 | Approvals E2E | **Low** | No test for stale rate-change request on rolled-over loan. |

### Round 3 resolutions (plan amendments)

#### Phase 3 additions (read-only historical loan UX)

- Introduce `isHistoricalLoanDetail(loan)` helper used by detail pages to enter **read-only mode**:
  - Hide: Record Payment, Issue New Loan, Settle, penalty waive/adjust, rate-change request, simulator mutations
  - Show: history banner, successor/predecessor links, statement (read-only), payment history, receipts
- Predecessor detail remains reachable but is not a mutation entry point.

#### Phase 5 extensions (mutation guards — complete table)

| Action | Guard |
|--------|-------|
| `recordPayment` / `recordPaymentWithTxid` | Reject if `status !== 'active'` |
| `editPayment` / `deletePayment` / `markPaymentWrong` / `unmarkPaymentWrong` | Reject if parent loan not operational (**R4-3, R5-2, R5-4**) |
| Payment status transitions | Never mutate status when `isTerminalLoanStatus` — fixes R5-5 |
| `/loans/[id]/payments/new` page | Fail-closed UI: show "Loan is not active" (like soft-delete) |
| `payment-table.tsx` edit/delete menu | Hide when loan not operational (**R5-3**) |
| `waivePenalty` / `adjustPenaltyMultiplier` | Reject if not operational |
| `createRateChangeRequest` / `applyRateChangeImmediately` / approve apply | Reject if not operational |
| `updateLoan` | Reject if not operational (except admin backdate fields if any) |
| `settleWithCollateral` | Already guarded |
| `deleteLoan` on `rolled_over` predecessor | **Block** or require successor deletion first |
| `deleteLoan` on successor with `rolledOverFrom` | **Revert predecessor to `active`** + restore ledger via inverse rollover postings (or block delete entirely — product decision) |

> **Product decision D1 — DEFAULT (R21-3):** When deleting a rollover successor, **(a) block deletion**. Also block deleting a `rolled_over` predecessor while a non-deleted successor exists. Option (b) full revert remains a future enhancement; option (c) orphaning is **rejected**. Cypress `db:softDeleteLoan` is test-only and must not be used on rollover successors in E2E that assert chain integrity.

#### Phase 2 additions

| Surface | Change |
|---------|--------|
| `src/app/(app)/approvals/page.tsx` | Filter out or flag pending requests whose loan is non-operational |
| `src/app/(app)/payments/PaymentsClient.tsx` | Scope `allLoansRaw` / balance maps to operational loans only for running-balance math; keep historical payment rows visible |
| Customer "Rolled Over" filter | **Keep** as intentional audit/search tool; document in plan |

#### Phase 4 additions

- Fix `computeOverdue()` at source: for non-operational loans, return `outstandingBalance: "0"`, `unpaidInterest: "0"`, `daysOverdue: 0` (or skip enrichment entirely)
- Reconciliation assertions (Phase 4.1 extended):
  ```
  rolled_over → ledger balance ≈ 0
  rolled_over → successor exists (rolledOverFrom chain intact)
  successor.rolledOverFrom → predecessor exists and status = rolled_over
  no orphaned rolled_over without successor (unless successor soft-deleted — then flag)
  at most one non-deleted successor per rolled_over predecessor (R9-8)
```

#### Phase 6 additions

- Cypress: payment-on-rolled-over fail-closed
- Cypress: delete successor → verify predecessor handling per product decision
- Integration: rate-change on rolled-over rejected
- Integration: penalty waive on rolled-over rejected
- Integration: pending rate change auto-cancelled on rollover; approve on stale request rejected (R7-1/R7-2)
- Integration: payment edit/delete/unmark on rolled_over rejected; status stays `rolled_over` (R9-1)

### Round 3 verdict

**Round 2 verdict was too optimistic.** Round 3 found:

- **2 critical bugs** already exploitable today (payment on rolled-over via direct URL; orphaned predecessor on successor delete)
- **6 high-severity gaps** in mutation guards and approvals
- **Hook-layer filtering alone is insufficient** — `computeOverdue()` and server guards must enforce at source

Plan is now complete after Round 3 amendments. Do **not** ship Phase 2 UI filtering without Phase 5 mutation guards.

---

## Adversarial Review — Round 4 (Derived Data: Interest, Reports, Exports)

Round 4 exhaustively audited every surface that **derives** values from loans — interest engines, financial reports, exports, projections, scripts, and cache invalidation — to verify nothing was missed beyond Rounds 1–3.

### Policy reference (INCLUDE vs EXCLUDE)

| Policy | Meaning | Examples |
|--------|---------|----------|
| **EXCLUDE** | Operational/watchlist only — show or count `active` loans | `/loans` list, loan Excel export, portfolio report, overdue cron, interest accrual |
| **INCLUDE (ledger truth)** | Sum ledger categories; rolled_over should contribute **≈0** after rollover postings | Balance sheet `totalLoansOutstanding`, dashboard `loansOutstanding` |
| **INCLUDE (historical)** | Preserve real past events and records | P&L, cashflow, transaction log, payments on predecessor loans, credit score, receipts, customer loan history |
| **INCLUDE (audit breakdown)** | Status histograms, not portfolio totals | Dashboard distribution chart, `getLoanStatusCounts` |
| **VERIFY** | No status filter, but depends on rollover ledger being correct | Reconciliation script must assert zero + chain integrity |

---

### Category audit matrix

#### 1. Interest & balance derivation

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Overdue engine | `src/lib/interest/overdue.ts` → `computeLoanOverdueInfo` | EXCLUDE non-active outputs | **partial** | Zero overdue/penalty when `status !== 'active'` |
| Balance projection | `src/lib/interest/loanBalanceData.ts` → `computeLoanBalanceData`, `computeAllLoansBalanceData` | EXCLUDE from operational sync; INCLUDE DB rows for history | **partial** | Zero non-active in projection feed OR filter `listLoanBalances` |
| List enrichment | `src/services/loan.service.ts` → `computeOverdue` | EXCLUDE | **partial** (C1) | Zero `outstandingBalance`/`unpaidInterest` for non-active |
| Client daily rate | `src/lib/interest/effective-rate-client.ts` | EXCLUDE (already returns `"0"`) | **yes** | None |
| Month-end accrual | `src/services/transaction.service.ts` → `accrueInterestForLoans` | EXCLUDE (`active` only) | **yes** | None |
| Overdue cron | `src/app/api/cron/overdue/route.ts` | EXCLUDE (`active` only) | **yes** | None |
| Payment allocation (server) | `src/lib/interest/engine-server.ts` → `allocateLoanPaymentServerSide` | EXCLUDE at record time | **partial** | Guard before allocate |
| Payment allocation (pure) | `src/lib/interest/engine.ts` | Caller responsibility | **partial** | Guard call sites (`recordPayment`, backfill script) |
| Payment balance summary | `src/services/payment.service.ts` → `getLoanBalanceSummary` | EXCLUDE for mutations | **no** (new) | Reject when loan not operational |
| Collateral settlement interest | `src/services/collateral-settlement.service.ts` | EXCLUDE (active only) | **yes** | None |
| Loan statement simulator | `src/lib/loan-statement.ts`, `simulator-panel.tsx` | INCLUDE read-only on historical detail | **partial** | Disable mutations in read-only mode |
| Rollover ledger transfer | `src/services/auto-post.service.ts` → `autoPostRolloverPrincipalTransfer` | Must zero predecessor | **yes** (verify 4.1) | Reconciliation assertion |
| Perpetual min threshold | `src/app/(app)/loans/new/page.tsx` (rollover-aware) | EXCLUDE predecessor from active check | **yes** | None |

#### 2. Financial reports

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Portfolio report | `src/services/report.service.ts` → `getPortfolioData` | EXCLUDE (`active` only) | **yes** | None |
| Active loans report | `listActiveLoansWithOverdue` + `/reports/active-loans` | EXCLUDE | **yes** | None |
| Balance sheet | `getBalanceSheetData` | INCLUDE ledger (≈0 rolled_over) | **yes** | Verify via 4.1 |
| P&L | `getPnlData` | INCLUDE historical revenue | **yes** | None |
| Retained earnings | `getRetainedEarningsData` | INCLUDE (derived from P&L) | **yes** | None |
| Cashflow | `getCashflowData` | INCLUDE (disbursements + payments on any loan) | **yes** | None |
| Location balances | `getLocationBalances` | Not loan-status scoped | **yes** | None |
| Monthly snapshot cron | `src/app/api/cron/month-end/route.ts` → `generateMonthlySnapshot` | Same as P&L/BS | **yes** | None |
| Transaction log | `listTransactions` + `/transactions` + export | INCLUDE loan-linked rows | **yes** | None |
| Report collections | `src/collections/reports.ts` | Caches above | **yes** | None |
| Cache invalidation | `src/lib/cache-invalidation.ts` | Invalidates ledger-backed reports on loan events | **yes** | No filter change needed |

#### 3. Exports & print

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Loans Excel | `getLoansForExport` → `generateLoansExcel` → `exportLoansExcelAction` | **EXCLUDE** non-active | **yes** | Switch to operational query |
| Loans print HTML | `src/app/(app)/loans/page.tsx` → `buildLoansPrintHtml` | **EXCLUDE** | **partial** | Filter before print (same as table) |
| Portfolio Excel/PDF | `generatePortfolioExcel` / `generatePortfolioPdf` + API routes | EXCLUDE | **yes** | None |
| P&L Excel/PDF | `generatePnlExcel` / `generatePnlPdf` | INCLUDE ledger | **yes** | None |
| Balance sheet Excel/PDF | `generateBalanceSheetExcel` / `generateBalanceSheetPdf` | INCLUDE ledger | **yes** | None |
| Transactions Excel/PDF | `generateTransactionsExcel` / `generateTransactionsPdf` | INCLUDE historical | **yes** | None |
| Active loans report UI | `ActiveLoansClient.tsx` | EXCLUDE (server data already active) | **yes** | None |
| Loan statement print | `loan-statement-dialog.tsx` | INCLUDE on historical detail (read-only) | **partial** | Read-only mode |

#### 4. Dashboard & aggregations

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| KPIs | `getDashboardKPIs` — overdue count, active borrowers | EXCLUDE | **yes** | None |
| KPIs — loans outstanding | `getDashboardKPIs` — ledger DR−CR | INCLUDE (≈0 rolled_over) | **yes** | Verify 4.1 |
| Collections chart (30d) | `CollectionsChart` | INCLUDE payments | **yes** | None |
| Status distribution | `LoanDistributionChart` + `getLoanStatusCounts` | INCLUDE `rolled_over` bucket | **yes** | None |
| Recent activity links | `getRecentActivity` | INCLUDE events; fix links | **partial** (E2) | Optional successor link |

#### 5. Daily collections

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Due today | `getLoansDueToday` | EXCLUDE (`active` only) | **yes** | None |
| Collections by date | `getDailyCollections` | INCLUDE (real cash on any loan) | **yes** | None |

#### 6. DB projections & scripts

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| `loan_balances` triggers | `drizzle/0025_loan_balances_projection.sql` | INCLUDE rows; operational UI must filter | **yes** | Integrity checks |
| Reconcile script | `scripts/reconcile-loan-balances.ts` | Assert rolled_over ≈0 + chain | **partial** | Extend per 4.1 |
| Payment allocation backfill | `scripts/db-backfill-payment-allocations.ts` | **EXCLUDE** non-active | **no** (new) | Add `eq(loans.status, 'active')` — comment says active but code scans all perpetual |
| Audit amounts | `scripts/audit-amounts.ts` | Checks `rollover_amount` sign | **no** | Optional orphan chain check |
| Trigger integration test | `src/lib/db/__integration__/loan-balances-trigger.test.ts` | N/A | **no** | Add rolled_over zero-balance case |

#### 7. Credit score & customer search

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Credit score | `src/lib/credit-score.ts` — `rolled_over` → 0.5 | **INCLUDE** | **yes** | Never filter globally |
| Customer loan history | `useLoansForCustomer` | **INCLUDE** | **yes** | None |
| Customer "Rolled Over" filter | `customer-search-bar.tsx` + `customers/page.tsx` | **INCLUDE** (intentional audit search) | **yes** (B2) | Keep; document |
| Customer days-overdue filter | `customers/page.tsx` | EXCLUDE (already filters `active`) | **partial** | Switch to operational hook for loan data load |
| Server customer search | `customer.service.ts` daysRemainingFilter | EXCLUDE (`active` only) | **yes** | None |

#### 8. Payments-derived surfaces

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Global payments list | `PaymentsClient.tsx` running balances | INCLUDE payment rows; fix balance math | **yes** (B3) | Scope `allLoansRaw` principal map |
| Quick record / loan search | Already filter `active` client-side | EXCLUDE | **partial** | Use operational hook |
| Recently collected | `getRecentlyCollectedLoans` | INCLUDE (may surface predecessor — OK for history) | **yes** | None |
| Payment edit/delete on rolled_over | `payment.service.ts` edit/delete paths | **Block** (new gap) | **no** (new) | Reject edit/delete when loan not operational |
| Payment table "Record Payment" CTA | `payment-table.tsx` | EXCLUDE (already gated `active`) | **yes** | None |
| Record payment form preview | `record-payment-form.tsx` → `allocateLoanPayment` | EXCLUDE | **partial** | Page-level fail-closed |

#### 9. Receipts, activity, email

| Surface | File | INCLUDE/EXCLUDE | Plan coverage | Action |
|---------|------|-----------------|---------------|--------|
| Disbursement receipt | `getLoanReceiptData` | INCLUDE historical | **yes** | None |
| Settlement receipt | `receipt.service.ts` | INCLUDE | **yes** | None |
| Payment receipts | POS receipt components | INCLUDE historical payments | **yes** | None |
| Activity feed | `activity.service.ts` | INCLUDE; fix links | **partial** | Optional |
| Admin email | `lib/email.ts` → `resolveLoanContext` | INCLUDE notify; fix deep links | **partial** | Optional |

---

### Round 4 — new gaps (not in Rounds 1–3)

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| R4-1 | `computeLoanOverdueInfo` not named in plan — root of balance/overdue inflation | **High** | Add status guard in `overdue.ts` or zero outputs in `computeLoanBalanceData` |
| R4-2 | `db-backfill-payment-allocations.ts` scans all perpetual loans regardless of status — can post reversals on rolled_over | **High** | Filter `status = 'active'` |
| R4-3 | Payment **edit/delete** on rolled_over predecessor not in Phase 5 guard table | **High** | Reject when parent loan not operational |
| R4-4 | `getLoanBalanceSummary` unguarded — feeds payment UI | **Medium** | Operational guard |
| R4-5 | No integration test proving rollover doesn't double-count in reports | **Medium** | Add to `fuzz-report.test.ts` or new integration test: rollover → portfolio count=1, BS loans outstanding unchanged |
| R4-6 | `loan-balances-trigger.test.ts` lacks rolled_over scenario | **Low** | Add test after rollover posting |
| R4-7 | Cypress `reports.cy.ts` / `report-details.cy.ts` don't cover post-rollover portfolio totals | **Low** | Add E2E: rollover then export portfolio → single active loan |
| R4-8 | `scripts/audit-amounts.ts` doesn't check orphan chains | **Low** | Optional extension |

---

### Report & export verification checklist (post-implementation)

Run after implementation to confirm derived data is correct:

- [ ] **Portfolio report** (`/reports/portfolio`): customer with rollover shows **one** row (successor only)
- [ ] **Active loans report** (`/reports/active-loans`): same
- [ ] **Balance sheet**: `totalLoansOutstanding` equals sum of active loan ledger balances (not 2× after rollover)
- [ ] **P&L**: interest earned includes rollover interest posting on successor creation; no duplicate accrual on predecessor
- [ ] **Cashflow**: disbursement shows fresh cash only on successor; no duplicate cash for carried amounts
- [ ] **Transaction log export**: rollover journal entries visible; predecessor loan-linked rows present as history
- [ ] **Loans Excel export**: excludes rolled_over, fully_paid, settled_with_collateral
- [ ] **Loans print**: totals match filtered table (no phantom "early" rows)
- [ ] **Dashboard KPIs**: `overdueCount` and `activeBorrowers` unchanged; `loansOutstanding` not doubled
- [ ] **Dashboard distribution chart**: still shows `rolled_over` slice (intentional)
- [ ] **Daily collections due-today**: excludes rolled_over
- [ ] **Daily collections by date**: still includes payments recorded on predecessor before rollover
- [ ] **Credit score**: still factors rolled_over at 0.5 completion
- [ ] **Reconcile script**: all `rolled_over` loans ≈0 balance + chain intact
- [ ] **Month-end cron**: accrual skips rolled_over (active-only query)

---

### Phase 4 extension (derived data source fixes)

Add to Phase 4 alongside `computeOverdue` fix:

**4.2 Interest engine status awareness (Path A — primary UI fix)**

```typescript
// In computeLoanBalanceData / computeLoanOverdueInfo path (Path A):
if (!isOperationalLoan(loan.status)) {
  return { daysOverdue: 0, unpaidInterest: "0", totalBalanceOwed: "0", ... };
}
```

**4.2b Path B — computeOverdue (exports / server lists)**

Same zeroing in `computeOverdue()` for `outstandingBalance` / `unpaidInterest` on non-active. Path B alone does **not** fix `/loans` watchlist — see R11-1.

**4.3 Report integration test**

Add `src/services/__integration__/rollover-report.test.ts`:

1. Create loan A, accrue interest, rollover to loan B
2. Assert `getPortfolioData()` returns 1 entry for customer
3. Assert predecessor ledger balance ≈ 0
4. Assert `getBalanceSheetData().totalLoansOutstanding` ≈ successor balance only

**4.4 Script hardening**

- `scripts/db-backfill-payment-allocations.ts`: add `eq(loans.status, 'active')`
- `scripts/reconcile-loan-balances.ts`: chain integrity + zero-balance assertions

---

### Round 4 verdict

| Area | Status after Round 4 |
|------|---------------------|
| Financial reports (portfolio, P&L, BS, cashflow, RE) | **Accounted for** — ledger-backed reports rely on rollover posting correctness; add integration test |
| Dashboard KPIs & charts | **Accounted for** |
| Loan watchlist exports/print | **Accounted for** — needs `computeOverdue` + print filter |
| Interest accrual / overdue cron | **Already safe** |
| Balance projection sync | **Partial** — needs source zeroing + reconcile |
| Scripts | **Gap found** — backfill script must filter active |
| Payment edit/delete on historical loans | **New gap** — add to Phase 5 |
| Credit score / customer audit filters | **Accounted for** (intentional INCLUDE) |

**Overall:** The plan covers the major report/export surfaces. Round 4 adds **4 actionable gaps** (R4-1 through R4-4) and a **post-implementation verification checklist**. Combined with Rounds 1–3, the plan is now comprehensive for all loan-derived data paths.

**Do not mark plan complete until:** integration test R4-5 exists and backfill script R4-2 is fixed.

---

## Adversarial Review — Round 5 (UI Layers, Payment Mutations, Data Integrity)

Round 5 targeted gaps outside the report/export matrix: UI mutation entry points, payment status corruption, search API parity, and history chain queries.

### New findings

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| R5-1 | `searchCustomers()` **ignores `loanStatus` param** — only the customers page client filter applies it | Medium | Either implement server-side `loanStatus` filter in `customer.service.ts` or document as client-only (prefer server parity) |
| R5-2 | `markPaymentWrong` / `unmarkPaymentWrong` not in Phase 5 guard table | **High** | Reject when parent loan not operational |
| R5-3 | `payment-table.tsx` Edit/Delete dropdown **always visible** — only "Record Payment" CTA is gated on `active` | **High** | Hide edit/delete in read-only mode (same as R4-3 UI layer) |
| R5-4 | `PaymentsClient.tsx` allows edit + mark-wrong on payments linked to rolled_over loans | **High** | Server guard on edit/delete/mark-wrong; optionally disable UI when loan non-operational |
| R5-5 | **`deletePayment` can set `rolled_over` → `fully_paid`** when ledger hits zero after delete (`payment.service.ts` ~785–790) — status transition logic only excludes `fully_paid`, not terminal statuses | **Critical** | Guard all payment mutations at entry; status transitions must skip `rolled_over`, `settled_with_collateral` |
| R5-6 | `editPayment` / `unmarkPaymentWrong` can corrupt rolled_over ledger (re-post journals) without entry guard | **Critical** | Same operational guard at service entry |
| R5-7 | Soft-delete successor via `db:softDeleteLoan` (Cypress/production) leaves predecessor `rolled_over` with no visible successor — same orphan class as D1 | High | Document; block soft-delete of rollover successor or revert predecessor |
| R5-8 | `rolledOverFrom` FK is `ON DELETE SET NULL` — hard-deleting predecessor breaks history chain | Medium | Never hard-delete loans; history queries must tolerate null chain |
| R5-9 | `getLoanPredecessorChain` must fetch predecessors via **direct DB reads that can include soft-deleted rows** — **not** `listLoans` / `loanCollection`, and **not** plain `getLoan()` (which filters `deletedAt IS NULL`). Use `getLoanRowById(id, { includeDeleted: true })` (R23-3) | **High** | Implement chain walker with include-deleted reader for audit |
| R5-10 | `deleteLoanAction` / `updateLoanAction` are disabled in UI — D1 orphan risk is mainly service-layer / test-helper paths | Low | Keep service guards if those code paths are ever re-enabled |
| R5-11 | Read-only historical detail still shows **operational balance/overdue cards** without "historical snapshot" labeling | Low | Phase 3 UX: banner + de-emphasize live metrics |
| R5-12 | `loan-detail.cy.ts` still tests Edit/Delete **loan** buttons — those dialogs are no longer wired in `loan-detail-client.tsx` (stale spec) | Low | Update or remove stale tests during Phase 6 |
| R5-13 | `collateral-settlement.cy.ts` verifies rollover status badge but **not** `/loans` list hiding predecessor | Medium | Add assertion: one row per customer after rollover |
| R5-14 | `loan-balance-live.cy.ts` uses `useLoansWithBalances` — may break when switching to operational hook | Medium | Update E2E after Phase 2 |

### Phase 5 extension (terminal status protection)

Add shared helper:

```typescript
export function isTerminalLoanStatus(status: LoanStatus): boolean {
  return status === "rolled_over"
    || status === "fully_paid"
    || status === "settled_with_collateral";
}

export function assertLoanOperational(loan: { status: LoanStatus }): void {
  if (!isOperationalLoan(loan.status)) {
    throw new Error("Loan is not active");
  }
}
```

Apply `assertLoanOperational` at the **start** of:

- `recordPaymentWithTxid`
- `editPayment` / `deletePayment`
- `markPaymentWrong` / `unmarkPaymentWrong`
- `waivePenalty` / `adjustPenaltyMultiplier`
- Rate change create / apply / approve paths

Fix **all six** status-transition sites in `payment.service.ts` to **never mutate status** when `isTerminalLoanStatus(loan.status)` (see R9-1 for full inventory).

---

## Adversarial Review — Round 6 (Final Sweep — Closure)

Round 6 re-scanned remaining surfaces not covered in Rounds 1–5:

| Surface | Result |
|---------|--------|
| Command palette (`command-palette.tsx`) | Navigation only — no loan search/list |
| Electric sync API | Not present in codebase (HTTP polling via collections) |
| In-app notifications (`notifications.cy.ts`) | UI stub only — no loan-derived data path today |
| Sidebar / top bar | No loan counts or rolled_over references |
| Fund transfers, income, expenses | No loan status dependency |
| Creditors module | Unrelated to loan visibility |
| Active loans report page | Already uses `listActiveLoansWithOverdue` — safe |
| Permissions (`loan:rollover`) | Correctly limited to supervisor+ |
| Transaction log + exports | INCLUDE historical — correct |
| Retained earnings / cashflow reports | Ledger-derived — correct |
| Chat feature | Not implemented in `src/` |
| `getLoanPaymentContextAction` | Defined but unused in UI — no live path |
| Admin / settings backdate | No loan list aggregation |
| Unit tests for rollover create | Exist in `loan.service.test.ts` — extend for visibility |
| FK cascades on hard delete | Document as forbidden for production loans |

### Round 6 verdict (superseded by Round 7)

No material new gaps beyond Round 5 at the time. **Round 7 reopened the loop** — see below.

The plan now covers:

1. Operational visibility (lists, exports, print)
2. Interest/balance source fixes (`computeOverdue`, `computeLoanOverdueInfo`, projections)
3. Financial reports & ledger verification
4. Mutation guards (payments, penalty, rate change, settle)
5. **Terminal status corruption** via payment edit/delete (R5-5/R5-6 — newly critical)
6. History UI + read-only mode + chain queries
7. Scripts, integration tests, Cypress, post-implementation checklist

---

## Adversarial Review — Round 7 (Async Workflows: Rate-Change Lifecycle)

Round 7 targeted **in-flight approval workflows** that survive loan closure — a class of bugs not covered by payment/penalty guards alone.

### New findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R7-1 | **Pending rate-change requests survive rollover** | **Critical** | `createLoan` rollover branch sets predecessor to `rolled_over` but **does not cancel/reject** pending `rate_change_requests` on that loan. Supervisor can still approve from `/approvals` after rollover. |
| R7-2 | **`reviewRequest` applies rate to non-operational loans** | **Critical** | Approval path updates `interestRateOverride` and calls `autoPostRateChangeAdjustment` with **no loan status check** — mutates `rolled_over` / `fully_paid` / `settled_with_collateral` loans and posts ledger adjustments. |
| R7-3 | **`applyRateChangeImmediately` unguarded** | **High** | Same as R7-2 for immediate-apply path (rates ≥10% or approver self-apply). |
| R7-4 | **`createRateChangeRequest` / `createPendingRateChangeRequest` unguarded** | **High** | Only checks loan exists (not even `deletedAt`); no `status === 'active'` requirement. |
| R7-5 | **Terminal closure doesn't cancel pending requests** | **High** | `settleWithCollateral` and payment-driven `fully_paid` transitions also leave pending requests open — same stale-approval class as rollover. |
| R7-6 | **Stale badge on historical loan detail** | **Medium** | `loan-info-cards.tsx` shows "Pending: X%" badge without gating on `loan.status === 'active'` (lines 172–175) — misleading on rolled-over predecessor. |
| R7-7 | **`listAllRequests` includes soft-deleted loans** | **Medium** | Joins `loans` without `deletedAt IS NULL` — approvals can surface requests for soft-deleted loans. |
| R7-8 | **`countPendingRequests` counts stale requests** | **Low** | Counts all pending rows regardless of loan status; harmless today (sidebar has no badge) but wrong if surfaced later. |

### Round 7 resolutions (plan amendments)

#### New helper (Phase 1 or Phase 5)

```typescript
// src/services/rate-change-request.service.ts
cancelPendingRateChangeRequestsForLoan(
  tx,
  loanId,
  reason: "loan_closed" | "rolled_over" | "settled" | "fully_paid",
  actorId,
): Promise<number>  // count cancelled
```

Auto-reject (status → `rejected`, reviewNote explains closure) inside the **same transaction** as loan status change.

#### Call sites (must cancel pending requests)

| Event | File | When |
|-------|------|------|
| Rollover closes predecessor | `loan.service.ts` → `createLoan` rollover branch | After `status = 'rolled_over'` |
| Collateral settlement | `collateral-settlement.service.ts` | After `status = 'settled_with_collateral'` |
| Payment marks fully paid | `payment.service.ts` | After `status = 'fully_paid'` transition |

#### Phase 5 extensions (defense in depth)

| Action | Guard |
|--------|-------|
| `createRateChangeRequest` / `createPendingRateChangeRequest` | `assertLoanOperational` |
| `applyRateChangeImmediately` | `assertLoanOperational` |
| `reviewRequest` (approve path) | Load loan + `assertLoanOperational` before apply |

#### Phase 2 / Phase 3 UI

| Surface | Change |
|---------|--------|
| `loan-info-cards.tsx` | Gate pending badge: only show when `loan.status === 'active'`; on historical loans show "Request cancelled (loan closed)" if rejected-by-closure |
| `approvals/page.tsx` | Filter out pending requests whose loan is non-operational **or** auto-cancelled; disable Approve button with tooltip |

#### Phase 6 tests

- Integration: create pending rate change → rollover → assert request auto-rejected; manual approve attempt fails
- Integration: approve on `rolled_over` rejected even if stale request somehow remains
- Cypress: extend `rate-change-approval.cy.ts` or `rollover-loan-visibility.cy.ts` — pending request does not survive rollover on `/approvals`

### Round 7 verdict

**Round 6 closure was premature.** Rate-change lifecycle is a **real exploitable path today** (R7-1/R7-2). Plan must ship request cancellation at loan closure **and** operational guards on all rate-change service entry points.

---

## Adversarial Review — Round 8 (Final Sweep — Re-closure)

Round 8 re-scanned all surfaces after Round 7 amendments, focusing on areas not re-audited since Round 6:

| Surface | Result |
|---------|--------|
| Command palette | Navigation only — no loan list |
| Simulator panel | Gated `loan.status === 'active'` in `loan-detail-client.tsx` — safe |
| Sidebar approvals link | No pending count badge — R7-8 low impact today |
| Customer detail loan history | Uses `useLoansForCustomer` — INCLUDE all statuses (correct) |
| `searchActiveLoans` | Active-only — safe |
| `getRecentlyCollectedLoans` | Historical payments — INCLUDE (correct) |
| Daily collections | Active-only due-today — safe |
| Other approval workflows | Rate change only — R7 covers the class |
| Payment status corruption | Covered R5-5/R5-6 |
| Financial reports / exports | Covered Round 4 |
| Collateral settlement guards | Active-only at entry — safe; add R7-5 cancel on close |
| Permissions / Electric / notifications | No new paths |
| `getCustomerLoansWithOverdue` | Full history for customer — INCLUDE (correct) |
| Cypress `rate-change-approval.cy.ts` | No post-rollover stale-request test — add in Phase 6 |

### Round 8 verdict (superseded by Round 9)

No material new gaps beyond Round 7 at the time. **Round 9 reopened the loop** — see below.

---

## Adversarial Review — Round 9 (Payment Status Transitions — Complete Inventory)

Round 9 re-audited **every** `loans.status` mutation in `payment.service.ts`. R5-5 called out `deletePayment` but the same bug class exists in **five other paths**.

### New findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R9-1 | **R5-5 incomplete — six status mutation sites** | **Critical** | All paths below set `fully_paid` or `active` when `loan.status !== "fully_paid"` **without** checking `isTerminalLoanStatus`. A `rolled_over` loan (ledger ≈ 0) can be flipped to `fully_paid` or corrupted back to `active`. |
| R9-2 | **`unmarkPaymentWrong` → `fully_paid`** | **Critical** | Lines ~1355–1360: `allocation.loanFullyPaid && loan.status !== "fully_paid"` — `rolled_over` satisfies this; unmarking a wrong payment on a predecessor can reclassify it as `fully_paid`. |
| R9-3 | **`editPayment` → `fully_paid`** | **Critical** | Lines ~625–629: `postEditBalance.isZero()` → `fully_paid` with no terminal guard. Editing a historical payment on a `rolled_over` loan can flip status. |
| R9-4 | **`recordPayment` → `fully_paid`** | **Critical** | Lines ~289–293: same zero-balance → `fully_paid` path (exploitable via direct `/payments/new` URL on predecessor). |
| R9-5 | **`deletePayment` → `fully_paid`** | **Critical** | Lines ~785–790 (R5-5): `postDeleteBalance.isZero() && loan.status !== "fully_paid"`. |
| R9-6 | **`markPaymentWrong` ledger corruption** | **High** | Reverses interest/principal journals on `rolled_over` loans without operational guard — can restore non-zero ledger on a loan that should stay at ≈0. |
| R9-7 | **`editPayment` / `unmarkPaymentWrong` → `active`** | **Medium** | Lines ~630–634 and ~791–797 revert `fully_paid` → `active` when balance > 0; safe for `rolled_over` today but must be wrapped in terminal guard alongside R9-1 fixes. |
| R9-8 | **No duplicate-successor constraint** | **Medium** | Schema has no unique index on reverse FK; reconciliation should assert `COUNT(*) WHERE rolled_over_from = :id AND deleted_at IS NULL <= 1`. |
| R9-9 | **`/payments/new` renders form for non-active** | **High** | Page guards only `deletedAt IS NULL`; `RecordPaymentForm` mounts with no status check (A1 UI layer — add explicit fail-closed banner + disable submit). |

#### Complete status-mutation inventory (`payment.service.ts`)

| Function | Line (approx) | Transition | Terminal-safe today? |
|----------|---------------|------------|----------------------|
| `recordPaymentWithTxid` | ~289–293 | → `fully_paid` if ledger zero | **No** |
| `editPayment` | ~625–629 | → `fully_paid` if ledger zero | **No** |
| `editPayment` | ~630–634 | `fully_paid` → `active` if ledger > 0 | Partial |
| `deletePayment` | ~785–790 | → `fully_paid` if ledger zero | **No** |
| `deletePayment` | ~791–797 | `fully_paid` → `active` if ledger > 0 | Partial |
| `markPaymentWrong` | ~1180–1188 | `fully_paid` → `active` if ledger > 0 | Partial |
| `unmarkPaymentWrong` | ~1355–1360 | → `fully_paid` if allocation says paid | **No** |

### Round 9 resolutions

**Phase 5 — shared helper for status writes:**

```typescript
/** Skip automatic status transitions on terminal loans; never flip rolled_over → fully_paid/active. */
function maybeUpdateLoanStatusAfterPayment(
  tx,
  loan: { id: string; status: LoanStatus },
  next: "fully_paid" | "active",
): Promise<void> {
  if (isTerminalLoanStatus(loan.status)) return;
  // existing transition logic…
}
```

Replace all six inline `tx.update(loans).set({ status: … })` blocks in payment mutations with this helper **after** `assertLoanOperational` at function entry (defense in depth — entry guard blocks the mutation entirely; status helper blocks corruption if guard is bypassed).

**Phase 4.1 — reconciliation extension:**

```
For each rolled_over loan:
  assert at most one non-deleted successor (rolledOverFrom = id)
```

**Phase 6 — integration tests:**

- Rollover → edit/delete/unmark payment on predecessor → assert status stays `rolled_over`
- Rollover → record payment attempt rejected; status unchanged

### Round 9 verdict

**Round 8 closure was premature.** R5-5 listed the bug class but only cited `deletePayment`. Implementation must fix **all six** transition sites, not just one.

---

## Adversarial Review — Round 10 (Final Sweep — Re-closure)

Round 10 re-scanned after R9 amendments:

| Surface | Result |
|---------|--------|
| Rate-change lifecycle (R7) | Covered — cancel on close + operational guards |
| Payment status transitions (R9) | Complete inventory — no additional `set({ status })` sites outside `payment.service.ts` loan closure paths |
| `createLoan` / `settleWithCollateral` / `deleteLoan` status writes | Intentional lifecycle transitions — not payment corruption |
| Collection mutation paths | Route to server actions — guarded once Phase 5 lands |
| Reports / exports / cron | Covered Rounds 4–6 |
| Command palette, simulator, sidebar | Safe |
| `getRecentlyCollectedLoans` | No UI consumer today — historical INCLUDE if used later |
| Customer search `loanStatus` filter | Client-only (R5-1) — no new gap |
| Schema / FK / indexes | R9-8 duplicate-successor check added to reconciliation |
| Cypress coverage | Gaps documented in Phases 6 |

### Round 10 verdict (superseded by Round 11)

No material new gaps beyond Round 9 at the time. **Round 11 reopened the loop** — see below.

---

## Adversarial Review — Round 11 (Dual Data Path Architecture)

Round 11 traced **which code path actually feeds the `/loans` watchlist UI** — a distinction earlier rounds implied but did not state explicitly.

### Critical architecture finding

The `/loans` page uses `useLoansWithBalances()` → joins `loanCollection` + **`loanBalanceCollection`**.

| Path | Source | Used by |
|------|--------|---------|
| **A — Balance collection** | `listLoanBalances()` → `computeAllLoansBalanceData()` → `computeLoanBalanceData()` | `/loans` page, `useLoanWithBalance`, `useLoansForCustomer`, QuickRecordDialog balance join, payment/new balance preview |
| **B — computeOverdue** | `computeOverdue()` in `loan.service.ts` | `getLoansForExport()`, `listActiveLoansWithOverdue()`, `getCustomerLoansWithOverdue()` |

**Fixing Path B alone does not fix the watchlist.** Phase 4 `computeOverdue` changes and Phase 2 operational hook address different layers — **both are required**, and Path A zeroing in `computeLoanBalanceData` is the source fix for balance collection sync.

### New findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R11-1 | **Watchlist fed by Path A, not Path B** | **Critical** | Plan Phase 4 emphasized `computeOverdue` (Path B) but the primary UI reads `loanBalanceCollection` (Path A). Must zero non-active outputs in `computeLoanBalanceData` / `computeLoanOverdueInfo` **and** add operational hook filter. |
| R11-2 | **Cross-plan: in-flight loan amount waiver** | **High** | `.planning/quick/260722-loan-amount-waiver/` adds `waiveLoanAmount`, `fully_paid` transitions, settlement-date changes, trigger updates. Waiver REVIEW-3 says "no interaction" — **incorrect**. Waiver must import shared helpers from `loan-visibility.ts` (`assertLoanOperational`, `isTerminalLoanStatus`, `maybeUpdateLoanStatusAfterPayment`). Ship visibility Phase 1+5 helpers **before** or **with** waiver Task 3. |
| R11-3 | **Rollover activity links target predecessor** | **Medium** | `loan.rollover` audit entries store `afterValue.rolledIntoLoanId` (successor) but `getActivityHref` / dashboard recent activity use `entityId` (predecessor) → staff land on mutable historical detail. Link to successor or history view. |
| R11-4 | **`useLoansForCustomer` must stay on Path A with all statuses** | **Medium** | Operational hook replaces `useLoansWithBalances` on watchlist surfaces only; customer detail + credit score keep full status set via `useLoansForCustomer`. Zeroing in Path A must not break credit score completion factors (rolled_over = 0.5 regardless of zeroed display balance). |
| R11-5 | **`listLoansAction` returns raw loans (no enrichment)** | **Low** | `loanCollection` syncs all statuses; enrichment is entirely from Path A join in `loan-views.ts`. Document in plan so implementers don't patch `listLoans()` expecting watchlist fix. |

### Round 11 resolutions

#### Phase 4 amendment — dual path fix (both required)

```typescript
// Path A (PRIMARY for UI): src/lib/interest/loanBalanceData.ts
// R19-3: short-circuit BEFORE per-loan payment/ledger queries
if (!isOperationalLoan(loan.status)) {
  return { daysOverdue: 0, unpaidInterest: "0", totalBalanceOwed: "0", dailyRate: "0", ... };
}

// Path B (exports/reports): src/services/loan.service.ts → computeOverdue
// Same zeroing for outstandingBalance / unpaidInterest on non-active
```

#### Phase 2 amendment — operational hook scope

| Hook | Replace `useLoansWithBalances` | Keep full history |
|------|-------------------------------|-------------------|
| `/loans` page | ✅ | |
| `customers/page.tsx` overdue filter | ✅ | |
| QuickRecordDialog / LoanSearchCombobox | ✅ | |
| `PaymentsClient` running-balance principal map | ✅ (operational only for math) | payment rows INCLUDE all |
| Customer detail / credit score | | ✅ `useLoansForCustomer` |

#### Cross-plan coordination (loan waiver)

Add to plan Related Docs:

- `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-PLAN.md` — waiver service must use `loan-visibility.ts` helpers; waiver `fully_paid` transition must call `maybeUpdateLoanStatusAfterPayment`

#### Phase 3 / activity (R11-3)

- `activity.service.ts` → `getActivityHref`: for `loan.rollover`, prefer `afterValue.rolledIntoLoanId` over `entityId`
- `dashboard.service.ts` → recent activity: same for rollover entries

### Round 11 verdict

**Round 10 closure was premature.** The dual data path (Path A vs B) is easy to miss during implementation — fixing `computeOverdue` alone leaves the watchlist broken. Cross-plan waiver coordination prevents a second class of status/ledger bugs.

---

## Adversarial Review — Round 12 (Final Sweep — Re-closure)

Round 12 re-scanned after R11 amendments:

| Surface | Result |
|---------|--------|
| Path A (`loanBalanceCollection` / `computeAllLoansBalanceData`) | R11-1 — fix documented |
| Path B (`computeOverdue`) | Covered; distinct from Path A |
| Payment status transitions (R9) | Complete six-site inventory |
| Rate-change lifecycle (R7) | Covered |
| Loan waiver (in-flight plan) | R11-2 cross-plan coordination documented |
| Activity/dashboard rollover links | R11-3 — use `rolledIntoLoanId` |
| Mutation guards / read-only mode | Covered Phases 3+5 |
| Reports / cron / exports | Covered Round 4 |
| `useLoansForCustomer` / credit score | R11-4 — keep full status set |
| Command palette, simulator, receipts | Safe (historical INCLUDE OK) |
| `deleteLoan` on rolled_over predecessor | D2 — block in Phase 5 |
| Reconciliation script | Chain + zero-balance + duplicate successor |
| Cypress gaps | Documented Phase 6 |

### Round 12 verdict (superseded by Round 13)

No material new gaps beyond Round 11 at the time. **Round 13 reopened the loop** — see below.

---

## Adversarial Review — Round 13 (500-Cap Sync vs Historical Access)

Round 13 traced **collection sync limits** against success criteria that require historical loans to remain reachable after rollover.

### Critical finding: `listLoans` 500 cap vs historical deep links

`loanCollection` syncs via `listLoans()` → **newest 500 non-deleted loans** (`loan.service.ts` `.limit(500)`). All loan view hooks (`useLoanWithBalance`, `useLoansForCustomer`, `useLoansWithBalances`) start from this collection.

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R13-1 | **500-cap sync breaks historical deep links** | **Critical** | Round 1 #18 was marked "out of scope" but **contradicts SC #2**, Phase 3 predecessor links, and Cypress #6. `/loans/[id]/page.tsx` uses `useLoanWithBalance` → if predecessor is outside the newest-500 window, page shows skeleton then redirects "Loan not found". Rollover makes predecessors **older** → more likely to fall off cap. |
| R13-2 | **Customer history / credit score missing loans outside cap** | **High** | `useLoansForCustomer` filters the same 500-cap collection. `getCustomerLoansWithOverdue()` is **uncapped per customer** but has **zero UI callers** (only tests). Long-tenure customers lose older `rolled_over` loans from history list and credit score loan-count factor. |
| R13-3 | **Path A zeroing inflates credit score paydown for `rolled_over`** | **Medium** | R11-4 guarded `scoreCompletion` (0.5 for `rolled_over`) but `scorePaydown` still uses display `outstandingBalance`. After Path A zeroing, `paidRatio ≈ 1.0` while completion stays 0.5 — inconsistent scoring. Fix in `credit-score.ts`, not just display layer. |
| R13-4 | **Execution order omits Path A explicitly** | **Low** | Step 4 said "`computeOverdue` source fix" only — easy to ship Path B without `loanBalanceData.ts` (R11-1 regression). |
| R13-5 | **Waiver REVIEW-3 stale vs R11-2** | **Low** | `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-REVIEW-3-FINAL.md` still says "no interaction"; R11-2 requires shared `loan-visibility.ts` helpers. Update waiver plan when either ships. |

### Round 13 resolutions

**Phase 1.4** — on-demand single-loan fetch + `useLoanWithBalance` fallback (see Phase 1 above).

**Phase 2.4** — wire `getCustomerLoansWithOverdueAction` via per-customer query collection; replace `useLoansForCustomer` on customer detail + credit score.

**Phase 6 / `src/lib/credit-score.ts`** — extend `scorePaydown`:

```typescript
if (loan.status === "rolled_over" || loan.status === "settled_with_collateral") {
  return 0.5; // align with scoreCompletion; do not use zeroed display balance
}
```

**Recommended execution order step 4** — rename to: **Phase 4 (Path A `computeLoanBalanceData` + Path B `computeOverdue`)**.

### Round 13 verdict

**Round 12 closure was premature.** The 500-cap sync is a pre-existing constraint that **becomes a rollover visibility bug** once predecessors must stay reachable and customer history must stay complete.

---

## Adversarial Review — Round 14 (Final Sweep — Re-closure)

Round 14 re-scanned after R13 amendments:

| Surface | Result |
|---------|--------|
| `listLoanBalances` / `computeAllLoansBalanceData` | Uncapped on server — balance rows can exist for loans missing from 500-cap `loanCollection`; R13-1 fallback fixes join source |
| `loan-extras.ts` per-id pattern | Existing pattern for `getLoanCollateralCollection` — reuse for R13-1/R13-2 |
| Phase 3 `getLoanPredecessorChain` | Server-side DB walk OK; predecessor **detail links** still need R13-1 on-demand fetch |
| Path A zeroing + credit score | R13-3 — `scorePaydown` terminal-status guard required |
| Path A / Path B / operational hooks | R11 — still required; R13 does not replace |
| Payment mutations / rate-change lifecycle | R7/R9 — covered |
| Waiver cross-plan | R13-5 doc note; R11-2 implementation requirement unchanged |
| Reports / cron / exports | Covered Rounds 4–6 |
| Mutation guards / read-only mode | Covered Phases 3+5 |
| Reconciliation + Cypress | Covered Phase 6; add E2E for predecessor outside 500-cap if test DB can seed ordering |

### Round 14 verdict (superseded by Round 15)

No material new gaps beyond Round 13 at the time. **Round 15 reopened the loop** — see below.

---

## Adversarial Review — Round 15 (500-Cap Operational Surfaces)

Round 15 traced the **500-cap `listLoans()` sync** through **operational** paths (not only historical deep links from R13).

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R15-1 | **Operational watchlist still capped if hook-only filter** | **Critical** | Phase 2 Option A (`useOperationalLoansWithBalances` filtering `status === 'active'` from `loanCollection`) **does not fix missing active loans** when portfolio >500 and an active loan is outside the newest-500 window. Same cap class as R13, but affects **live portfolio visibility**, not just history. |
| R15-2 | **Server reports/exports still call capped `listLoans()`** | **High** | `listActiveLoansWithOverdue()` and `getLoansForExport()` both do `Effect.runPromise(listLoans())` then filter. Plan Phase 1.2 marked `listActiveLoansWithOverdue` "already correct" — **incorrect at scale**. Active loans report can silently omit active loans. |
| R15-3 | **Payments page inner join drops orphan payments** | **High** | `PaymentsClient` uses `inner join` on `loanCollection`. Payments on loans outside 500-cap sync **disappear from `/payments`**, not merely show wrong balances (R3 B3 scope issue). |
| R15-4 | **`/payments/new` bypasses R13-1 fallback path** | **Medium** | `payments/new/page.tsx` reads raw `loanCollection`, not `useLoanWithBalance` fallback or uncapped `getLoanPaymentContext()`. Outside-cap loan → "Loan not found" before fail-closed inactive guard (Phase 5 / SC #8). |
| R15-5 | **Credit score penalties factor cleared by Path A zeroing** | **Medium** | R13-3 fixed `scorePaydown` only. `calculateCreditScore` penalties factor uses `isPenaltyActive(l.daysOverdue, …)` — zeroed `daysOverdue` on `rolled_over` erases pre-rollover penalty history. |

### Round 15 resolutions

**Phase 1.2 amendment** — rewire server list helpers:

```typescript
// listActiveLoansWithOverdue + getLoansForExport must use:
const activeLoans = await listOperationalLoans(); // uncapped SQL, not listLoans().filter
return computeOverdue(activeLoans);
```

**Phase 2.1 amendment** — `operationalLoanCollection` synced from `listOperationalLoansAction` (uncapped active-only); `useOperationalLoansWithBalances()` joins that collection + `loanBalanceCollection`.

**Phase 2.5** — PaymentsClient left join + on-demand loan metadata for missing `loanId`s.

**Phase 5 / payments/new** — use `getLoanPaymentContext()` (uncapped) + `assertLoanOperational`; do not rely on capped collection alone.

**Phase 6 / credit-score.ts** — penalties factor: for terminal statuses (`rolled_over`, `fully_paid`, `settled_with_collateral`), derive penalty state from **payment history / stored penalty flags**, not zeroed display `daysOverdue`.

### Round 15 verdict

**Round 14 closure was premature.** R13 addressed historical deep links and customer history, but the same 500-cap sync still breaks **operational completeness** (watchlist, active-loans report, export) and **payments list survivability** unless `listOperationalLoans()` becomes the uncapped source for all operational surfaces.

---

## Adversarial Review — Round 16 (Final Sweep — Re-closure)

Round 16 re-scanned after R15 amendments:

| Surface | Result |
|---------|--------|
| Operational watchlist (`/loans`) | R15-1 — uncapped `operationalLoanCollection` required |
| Active loans report + Excel export | R15-2 — rewire to `listOperationalLoans()` |
| `/payments` list + running balances | R15-3 + R3 B3 — left join + operational balance map |
| `/payments/new` deep link | R15-4 — `getLoanPaymentContext` + operational guard |
| Credit score paydown | R13-3 — covered |
| Credit score penalties | R15-5 — terminal-status guard required |
| Historical deep links + customer history | R13-1/R13-2 — on-demand + per-customer collection |
| Path A / Path B zeroing | R11 — still required |
| Payment status corruption / rate-change lifecycle | R7/R9 — covered |
| Delete successor orphan (D1) | Documented — product decision still open |
| Waiver cross-plan | R11-2/R13-5 — unchanged |
| Dashboard KPIs / portfolio / cron | Direct SQL active-only — safe (distinct from capped `listLoans` helpers) |
| Loan statement / receipts on historical detail | Client-built from payments — OK once R13-1 detail load works |
| Cypress | Extend Phase 6: payments on rolled_over predecessor still visible on `/payments` |

### Round 16 verdict (superseded by Round 17)

No material new gaps beyond Round 15 at the time. **Round 17 reopened the loop** — see below.

---

## Adversarial Review — Round 17 (Payment Cap + Incomplete Fallbacks)

Round 17 traced **implementation completeness of R13/R15 fixes** and the **parallel 2000-row payment sync cap**.

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R17-1 | **`getLoanPaymentContext` has no `status` field** | **Critical** | R15-4 says use uncapped `getLoanPaymentContext()` for `/payments/new` fail-closed. Current return type is `{ loanId, customerId, customerName, loanReference, startDate }` only — **no status**. Fallbacks that load context still cannot render the inactive banner or call `assertLoanOperational` client-side without a second fetch. Extend context (and action) to include `status` (+ optional `deletedAt` null check already in query). |
| R17-2 | **Credit score payments still use 2000-cap global `paymentCollection`** | **High** | R13-2 uncapped customer **loans** still leaves `CreditScoreBadge` filtering `paymentCollection` (`listAllPayments` `.limit(2000)`). Payments on older `rolled_over` predecessors fall off sync → **timeliness factor under-counts history**. Pair per-customer loans with per-customer (or per-loan-id-set) payments query. |
| R17-3 | **Loan detail payment table uses same 2000-cap collection** | **High** | `loan-detail-client.tsx` filters `paymentCollection` by `loanId`. Predecessor history UI (Phase 3) and direct URL to old loan can show **empty payment history** even when DB has rows. Use existing `listActivePaymentsByLoan` / per-loan payment collection (mirror `getPaymentPortionsCollection`) when global collection misses rows or always for detail pages. |
| R17-4 | **`operationalLoanCollection` not wired into create/rollover optimistic path** | **Medium** | `insertLoanWithInput` only inserts into capped `loanCollection`. After rollover, operational collection still shows predecessor as active and misses successor until staleTime refetch — watchlist flickers wrong. Invalidate `listOperationalLoansAction` query key (and optionally remove predecessor / insert successor) in `loans.ts` `onInsert` success path. |
| R17-5 | **Customer `loanStatus` filter ignores server + uses capped loans** | **Medium** | `CustomerSearchParams.loanStatus` is applied **client-side only** in `customers/page.tsx` against `useLoansWithBalances()` (500-cap). `searchCustomers()` never reads `loanStatus`. Filter for `rolled_over` / `fully_paid` silently misses customers whose matching loans are outside the newest 500. Server-side `EXISTS` subquery (or uncapped status query) required; overdue filter must use operational collection (already planned) — do not conflate. |

### Round 17 resolutions

**Phase 5 / R15-4 amendment:**

```typescript
export interface LoanPaymentContext {
  // …existing fields
  status: LoanStatus; // REQUIRED for fail-closed UI
}
```

**Phase 2.4 / credit score amendment (R17-2):**

- Add `listPaymentsForCustomer(customerId)` or `listPaymentsForLoanIds(ids)` (uncapped, soft-delete filtered)
- `CreditScoreBadge` + customer detail payment sections consume that collection, not global `paymentCollection`

**Phase 3 / loan detail (R17-3):**

- Prefer per-loan payment source for detail + history panel; keep global collection for `/payments` list only

**Phase 2.1 (R17-4):**

- On successful `createLoanAction` (including rollover): `invalidateQueries(operationalLoans)` (and `loanBalances`)
- Document that dual collections must stay coherent after lifecycle events

**Phase 2 / customers page (R17-5):**

- Implement server-side `loanStatus` in `searchCustomers` **or** dedicated uncapped “customers-by-loan-status” action
- Overdue / days filter: `useOperationalLoansWithBalances()` only
- Historical status filter: must not use capped `loanCollection`

### Round 17 verdict

**Round 16 closure was premature.** R15 fixed *which loan list* operational surfaces read, but left (1) an **incomplete payment-context API** for fail-closed, (2) a **second sync cap on payments** that breaks credit score + historical detail, and (3) **collection coherence / customer filter** gaps after introducing `operationalLoanCollection`.

---

## Adversarial Review — Round 18 (Final Sweep — Re-closure)

Round 18 re-scanned after R17 amendments:

| Surface | Result |
|---------|--------|
| `/payments/new` fail-closed | R17-1 — extend `LoanPaymentContext.status`; then R15-4 works |
| Credit score loans | R13-2 uncapped customer loans |
| Credit score payments | R17-2 — per-customer/loan-ids payments required |
| Loan detail / history payment rows | R17-3 — per-loan payments |
| Operational watchlist + reports | R15-1/R15-2 — uncapped `listOperationalLoans()` |
| Dual collection after rollover | R17-4 — invalidate operational query on create |
| Customer loanStatus / overdue filters | R17-5 + Phase 2 operational hook |
| Path A / Path B / payment status / rate-change | R7/R9/R11 — covered |
| Approvals enrichment via capped `loanCollection` | Acceptable residual once R7 cancels pending on close; active loans outside newest-500 still rare but operational collection does not feed approvals — **flag Low**: enrich approvals via direct loan fetch if loan missing from cap (optional, not blocking) |
| D1 delete successor | Still open product decision |
| Waiver cross-plan | R11-2 unchanged |
| Dashboard / portfolio / cron | Direct SQL — safe |
| Payment list 2000-cap itself | Pre-existing list pagination concern; R15-3 left join fixes loan-join drops within synced window — full uncapped `/payments` out of scope unless product requires |

### Round 18 verdict (superseded by Round 19)

No material new gaps beyond Round 17 at the time. **Round 19 reopened the loop** — see below.

---

## Adversarial Review — Round 19 (Cross-Plan Drift + Implementation Pitfalls)

Round 19 checked whether **prior resolutions are actually executable** (waiver PLAN.md, customers page wiring, Path A early-return cost).

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R19-1 | **Waiver PLAN.md still has no `loan-visibility` dependency** | **High** | Visibility R11-2 / waiver REVIEW-9 (R9-H1) require shared helpers, but `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-PLAN.md` Task 3 still says raw `status === "active"` and direct `status = "fully_paid"` — **zero** mentions of `assertLoanOperational`, `maybeUpdateLoanStatusAfterPayment`, or `cancelPendingRateChangeRequestsForLoan`. Related Docs on the visibility plan is advisory only. Without a **required artifact** (patch waiver PLAN Task 3 + `depends_on` visibility Phase 1), the next agent will re-implement divergent guards. |
| R19-2 | **R17-5 incomplete without customers page rewire** | **High** | Adding `loanStatus` to `searchCustomers` alone does nothing: `customers/page.tsx` filters **client-side** from `customerCollection` (also **500-capped** via `listCustomers`) + `useLoansWithBalances`. Must switch loan-based filters to **`searchCustomersAction`** (or dedicated action) and stop using capped client joins for those modes. |
| R19-3 | **Path A zeroing must short-circuit before per-loan payment/ledger IO** | **Medium** | Plan snippet zeros outputs in `computeLoanBalanceData`, but current code fetches payments + ledger **per loan** first. Naïve status guard after IO leaves `listLoanBalances` / `computeAllLoansBalanceData` as O(all historical loans × payments). Early-return **before** `db.select(payments)` / ledger maps for non-operational loans (or split operational-only balance sync + on-demand historical). |
| R19-4 | **No DB index on `rolled_over_from`** | **Low** | Schema indexes `customer_id` / `status` only. Phase 3 `getLoanSuccessor` / reconciliation duplicate-successor scans are unindexed. Add `idx_loans_rolled_over_from` (and optional unique partial on non-deleted) when shipping chain helpers. |
| R19-5 | **Stale Round 2 guidance still says “prefer hook-layer filter”** | **Low** | Round 2 / Phase 2 prose still implies filtering `loanCollection` is enough — **contradicts R15-1**. Implementers skimming early sections will ship the wrong fix. Strike/annotate Round 2 preference. |

### Round 19 resolutions

**Cross-plan (R19-1) — required artifact, not a note:**

1. Patch waiver PLAN Task 3: import `loan-visibility.ts`; `assertLoanOperational`; `maybeUpdateLoanStatusAfterPayment` for `fully_paid`; cancel pending rate requests on full waiver close.
2. Set waiver plan `depends_on: [visibility Phase 1 helpers]` (or co-ship in same PR).
3. Visibility Related Docs: mark waiver PLAN patch as **blocking** for closing R11-2 / SC #24.

**Phase 2 / customers (R19-2):**

```text
When loanStatus or daysRemainingFilter is set:
  → call searchCustomersAction (server), do not filter customerCollection × loanCollection
When no loan-based filters:
  → existing customerCollection list OK (acknowledge 500-cap as pre-existing list limit)
```

**Phase 4 Path A (R19-3):**

```typescript
// Inside computeLoanBalanceData per-loan loop — FIRST lines:
if (!isOperationalLoan(loan.status)) {
  results.set(loan.id, zeroBalanceInfo(loan.id, loan.startDate));
  continue; // do NOT query payments / re-enter heavy overdue path
}
```

**Phase 1.3 (R19-4):** migration or drizzle index on `loans.rolled_over_from`.

**Docs (R19-5):** annotate Round 2 “prefer hook layer” as **superseded by R15-1 operationalLoanCollection**.

### Round 19 verdict

**Round 18 closure was premature.** Prior rounds named the waiver dependency and customer filter gaps, but left them **non-actionable** (PLAN.md unchanged; customers page still client-only). Path A IO short-circuit is an easy-to-miss scale bug during Phase 4.

---

## Adversarial Review — Round 20 (Final Sweep — Re-closure)

Round 20 re-scanned after R19 amendments:

| Surface | Result |
|---------|--------|
| Waiver PLAN.md ↔ visibility helpers | R19-1 — blocking cross-plan patch required |
| Customers loanStatus / overdue UX | R19-2 — server search wiring required |
| Path A compute cost | R19-3 — early-return before IO |
| `rolled_over_from` index | R19-4 — add with chain helpers |
| Stale Round 2 hook-layer text | R19-5 — annotate superseded |
| Payment context status / payment caps | R17 — covered |
| Operational collection + reports | R15 — covered |
| Dual path / payment status / rate-change | R7/R9/R11 — covered |
| `getRecentlyCollectedLoans` (no UI consumer) | Still INCLUDE-or-filter-later; no new gap |
| D1 delete successor | Product decision still open — SC #11 |
| Dashboard / cron / portfolio SQL | Safe |
| Cypress softDelete helper orphan (R5-7) | Documented; same class as D1 |

### Round 20 verdict (superseded by Round 21)

No material new gaps beyond Round 19 at the time. **Round 21 reopened the loop** — see below.

---

## Adversarial Review — Round 21 (Cache Invalidation + D1 Default)

Round 21 traced **what actually refreshes after lifecycle events** once `operationalLoanCollection` exists, and whether open product decisions still block Phase 5.

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R21-1 | **Operational collection invalidation not wired into shared cache helpers** | **High** | R17-4 says “invalidate operational on create,” but `queryKeys` has **no** `loans.operational` key, and `invalidateLendingProjections()` only clears `loanBalances` / reports / KPIs — **not** an operational list. Settle (`loans.ts` onUpdate), payment→`fully_paid` (`payments.ts`), and waiver→`fully_paid` all call `invalidateLendingProjections` / partial keys today — watchlist would keep showing loans that just left `active` until staleTime. Fix: add `queryKeys.loans.operational`, subscribe via `subscribeToTableChanges("loans"|"payments", …)`, and include it in `invalidateLendingProjections`. |
| R21-2 | **`activeLoanCheck` cache never invalidates on loan writes** | **Medium** | `getActiveLoanCheckCollection` uses `queryKeys.loans.activeLoanCheck(customerId)` and is **not** registered in `subscribeToTableChanges("loans", …)`. After rollover, `/loans/new?customerId=` can keep showing the **predecessor** as the active loan (wrong carried amounts / wrong fromLoanId) until remount/staleTime. Invalidate `["active-loan-check"]` prefix (or per-customer key) on loan create/settle/status transitions. |
| R21-3 | **D1 still open after 20 rounds — Phase 5 delete path underspecified** | **Medium** | SC #11 / D1 still “product decision.” Without a default, implementers either skip the guard or ship orphaning. **Default now: (a) block** `deleteLoan` (and document Cypress `db:softDeleteLoan` as test-only exception) when `rolledOverFrom` is set **or** when a non-deleted successor exists for a `rolled_over` loan. Product may later upgrade to (b) full revert. |
| R21-4 | **`getLoanBalanceSummary` lacks deleted/operational guards** | **Low** | Used as balance source of truth for payment UX; no `deletedAt` / status check. After Path A zeroing, terminal loans return zeros (safe-ish), but soft-deleted loans still resolve. Phase 5: reject deleted; for non-operational return zeros **or** throw — align with `assertLoanOperational` at mutation boundary (summary itself may stay readable for history). |

### Round 21 resolutions

**Cache keys (R21-1 / R21-2):**

```typescript
// query-keys.ts
loans: {
  all: ["loans"] as const,
  operational: ["loans", "operational"] as const, // NEW
  activeLoanCheck: (customerId: string) => ["active-loan-check", customerId] as const,
  // …
}

// cache-invalidation.ts → invalidateLendingProjections
qc.invalidateQueries({ queryKey: queryKeys.loans.operational })
qc.invalidateQueries({ queryKey: ["active-loan-check"] }) // prefix: all customers

// operational-loans.ts module scope
subscribeToTableChanges("loans", qc, [queryKeys.loans.operational])
subscribeToTableChanges("payments", qc, [queryKeys.loans.operational]) // fully_paid via payment
```

**D1 default (R21-3):**

```typescript
// deleteLoan Phase 5
if (loan.rolledOverFrom) throw new ValidationError({ message: "Cannot delete a rollover successor; reverse via support process." });
const successor = await getLoanSuccessor(loan.id);
if (loan.status === "rolled_over" && successor) throw new ValidationError({ message: "Cannot delete a rolled-over predecessor while successor exists." });
```

**Phase 5 (R21-4):** Guard `getLoanBalanceSummary` for `deletedAt`; document interaction with Path A zeros.

### Round 21 verdict

**Round 20 closure was premature.** Introducing `operationalLoanCollection` without first-class query keys + shared invalidation recreates the “stale watchlist after status change” bug class. `activeLoanCheck` is the same class for the new-loan wizard. D1 needs a **shippable default**.

---

## Adversarial Review — Round 22 (Final Sweep — Re-closure)

Round 22 re-scanned after R21 amendments:

| Surface | Result |
|---------|--------|
| `queryKeys` + `invalidateLendingProjections` + table-events | R21-1 — operational key required |
| `activeLoanCheck` after rollover | R21-2 — prefix invalidation required |
| D1 / deleteLoan / Cypress soft-delete | R21-3 — default **block** |
| `getLoanBalanceSummary` | R21-4 — deleted guard; Path A zeros cover display |
| Waiver PLAN patch / customers server search / Path A IO | R19 — covered |
| Payment caps / payment context status | R17 — covered |
| Dual path / rate-change / six status sites | R7/R9/R11 — covered |
| Dashboard `/loans?filter=overdue` URL | Pre-existing; loans page ignores query param — **out of scope** |
| Accrual / portfolio / cron | Active-only SQL — safe |
| Credit score / history deep links | R13–R15 — covered |

### Round 22 verdict (superseded by Round 23)

No material new gaps beyond Round 21 at the time. **Round 23 reopened the loop** — see below.

---

## Adversarial Review — Round 23 (Stale `loanCollection` + Plan Contradictions)

Round 23 verified R21 invalidation claims against **actual** `invalidateQueries` / `subscribeToTableChanges` wiring, and hunted **internal plan contradictions** that would ship the wrong fix.

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R23-1 | **`loanCollection` / `queryKeys.loans.all` never invalidated** | **Critical** | Grep: **zero** `invalidateQueries` on `loans.all`. `emitTableChange("loans")` subscribers are dashboard/reports/status-counts/daily-collections/location-balances — **not** `loanCollection`. After rollover, optimistic insert adds successor as `active` but **never** flips predecessor `status → rolled_over` in-collection → dual-`active` for up to `staleTime` 30s. Payments join, approvals enrichment, `useLoanWithBalance` primary path, customer “Record Payment” CTA can target the predecessor. R21 only added `operational` + `active-loan-check`. |
| R23-2 | **R13-1 fallback races detail-page redirect** | **High** | `/loans/[id]/page.tsx` redirects when `!loanLoading && !loanEntry && !hasSeenEntry`. Plan says “sync ready → fallback fetch” but does **not** fold fallback `isLoading` into that guard → redirect can fire **before** `getLoanWithBalanceAction` returns → SC #2 / Cypress #6 fail with R13-1 “done.” |
| R23-3 | **R5-9 / SC #17 contradict `getLoan` soft-delete filter** | **High** | R5-9 says walk chain via `getLoan(id)` *and* include soft-deleted. `getLoan` uses `isNull(deletedAt)` — soft-deleted predecessors are invisible. Need `getLoanIncludingDeleted` (or raw select) for chain audit. |
| R23-4 | **`searchCustomers` overdue path omits `deletedAt`** | **High** | `daysRemainingFilter` selects `status = 'active'` **without** `isNull(deletedAt)`. Soft-deleted loans keep `status = 'active'`. R19-2 makes this the production path for customer loan filters. |
| R23-5 | **Phase 5 table still says “preserve reversal” vs D1 block** | **Medium** | Early Phase 5 row contradicted R21-3 / SC #11. **Amended** (this round) to block-delete default. |
| R23-6 | **Phase 4 “filter active-only balance feed” vs history** | **Medium** | “Either filter active-only **or** zero” treated as equivalent; active-only filter breaks historical detail / payments joins. **Amended** to zero-only path (R19-3). |
| R23-7 | **Per-customer/per-loan collections missing from R21 invalidation** | **Medium** | R13-2 / R17-2 / R17-3 collections not in `invalidateLendingProjections` / table-events → customer history + credit-score payments + detail payment tables stay stale after rollover/settle/`fully_paid`. |

### Round 23 resolutions

**Invalidation (R23-1 / R23-7 / extends R21):**

```typescript
// invalidateLendingProjections — also:
qc.invalidateQueries({ queryKey: queryKeys.loans.all })
qc.invalidateQueries({ queryKey: queryKeys.loans.operational })
qc.invalidateQueries({ queryKey: ["active-loan-check"] })
qc.invalidateQueries({ queryKey: ["customer-loans"] })      // R13-2 collections
qc.invalidateQueries({ queryKey: ["customer-payments"] })   // R17-2
qc.invalidateQueries({ queryKey: ["loan-payments"] })       // R17-3 per-loan

// After rollover insert — REQUIRED optimistic patch (R25-1), not optional:
loanCollection.update(predecessorId, (d) => { d.status = "rolled_over" })
operationalLoanCollection.delete(predecessorId)
// plus invalidateLendingProjections (loans.all, operational, …) for refetch coherence
```

**Detail page (R23-2):**

```typescript
// Redirect only when collection ready AND fallback settled AND still missing
if (!loanLoading && !fallbackLoading && !loanEntry && !hasSeenEntry.current) {
  toast.error("Loan not found");
  router.replace("/loans");
}
```

**Chain helpers (R23-3):**

```typescript
// NOT getLoan() — bypass deletedAt filter for audit chain
async function getLoanRowById(id: string, { includeDeleted = false } = {})
```

**Customers search (R23-4):**

```typescript
.where(and(
  inArray(loans.customerId, customerIds),
  eq(loans.status, "active"),
  isNull(loans.deletedAt), // REQUIRED
))
```

**Cypress additions:** dual-active absent after rollover on payments/approvals; R13-1 deep link outside cap without redirect race; soft-delete 404 vs rolled_over read-only; customer overdue filter excludes soft-deleted.

### Round 23 verdict

**Round 22 closure was premature.** R21 fixed *new* collection keys but left the **canonical capped `loanCollection` stale after rollover** — the most common client data source. Plan contradictions (R5-9 vs `getLoan`, Phase 4/5 prose) would have shipped wrong helpers.

---

## Adversarial Review — Round 24 (Final Sweep — Re-closure)

Round 24 re-scanned after R23 amendments:

| Surface | Result |
|---------|--------|
| `loanCollection` / `loans.all` invalidation | R23-1 — required in shared helper + optional optimistic status patch |
| Detail redirect vs R13-1 fallback | R23-2 — fold fallback loading into guard |
| Predecessor chain + soft-delete | R23-3 — dedicated include-deleted reader |
| `searchCustomers` overdue | R23-4 — add `deletedAt IS NULL` |
| Phase 5 / Phase 4 prose | R23-5/R23-6 — amended in plan body |
| Per-customer/per-loan query keys | R23-7 — extend invalidation |
| Operational + activeLoanCheck | R21 — still required |
| Dual path / payments / rate-change / D1 block | Covered prior rounds |
| Waiver PLAN patch / Path A IO | R19 — covered |
| Accrual / portfolio / cron | Safe |

### Round 24 verdict (superseded by Round 25)

No material new gaps beyond Round 23 at the time. **Round 25 reopened the loop** — see below.

---

## Adversarial Review — Round 25 (Optimistic Dual-Active + Customer Name Cap)

Round 25 stress-tested R23’s “invalidate `loans.all` is enough” claim against the **async** create/rollover UI path, and traced **name enrichment** under uncapped operational loans.

### Findings

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| R25-1 | **Optimistic predecessor patch is required — invalidate is not synchronous** | **High** | `/loans/new` calls `insertLoanWithInput` then can navigate to successor while `createLoanAction` + `invalidateQueries` are in flight. Invalidation does **not** rewrite in-memory predecessor rows. Dual-`active` window is insert→refetch-complete, not merely staleTime. R23 listed local patch as optional *or* “rely on invalidation before UI reads” — **false** for this path. Require: on rollover metadata, immediately `loanCollection.update(fromLoanId, status=rolled_over)` and remove predecessor from `operationalLoanCollection` (insert successor). |
| R25-2 | **Uncapped operational loans × 500-cap `customerCollection` name join** | **High** | `useLoansWithBalances` overwrites `customerName` from `customerCollection` (`listCustomers` `.limit(500)`, **no orderBy**). Uncapping operational loans **widens** loans whose customers are missing → `"—"` / broken LoanSearchCombobox / print labels. `listOperationalLoans` must return `LoanWithCustomer`; hooks must **prefer server names**. |
| R25-3 | **`MAX_PER_ID_CACHED = 32` FIFO + `cleanup()` vs R13-1 multi-hop** | **Medium** | Phase 1.4 says mirror `loan-extras` per-id maps. Opening >32 distinct loan/customer keyed collections evicts oldest and tears down sync mid-session — breaks multi-hop history deep links (SC #2). Bound/policy must be explicit. |
| R25-4 | **`listOperationalLoans()` contract underspecified** | **Medium** | Phase 1.2 only listed status + deletedAt. Path B (`computeOverdue` / Excel) needs `LoanWithCustomer` select + deterministic `orderBy(desc(createdAt))` matching `listLoans`. |

### Round 25 resolutions

**Rollover optimistic path (R25-1) — required:**

```typescript
// insertLoanWithInput / loans.new submit when input.rollover:
loanCollection.update(input.rollover.fromLoanId, (d) => {
  d.status = "rolled_over";
});
operationalLoanCollection.delete(input.rollover.fromLoanId); // if present
// then insert successor as active into both collections as today
```

**Operational hook names (R25-2):**

```typescript
customerName: loan.customerName ?? cust?.fullName ?? "—",
// prefer fields from listOperationalLoans SQL join; never require customerCollection hit
```

**Per-id cache (R25-3):** raise bound (≥128) for loan/customer history collections, or pin current `loanId` against eviction; document FIFO vs LRU.

**Phase 1.2 (R25-4):** amended above — `LoanWithCustomer` + orderBy.

### Round 25 verdict

**Round 24 closure was premature.** R23 fixed *whether* capped loans invalidate; Round 25 shows invalidate alone still leaves a **user-visible dual-active race**, and uncapping operational loans exposes a **customer-name sync cap** the plan never addressed.

---

## Adversarial Review — Round 26 (Final Sweep — Re-closure)

Round 26 re-scanned after R25 amendments:

| Surface | Result |
|---------|--------|
| Rollover optimistic dual-active | R25-1 — required local predecessor patch |
| Operational watchlist customer names | R25-2 — server `LoanWithCustomer` fields |
| Per-id collection eviction | R25-3 — raise/pin policy |
| `listOperationalLoans` shape/order | R25-4 — match `listLoans` contract |
| `loans.all` invalidation (R23-1) | Still required **in addition to** optimistic patch |
| Detail redirect vs fallback (R23-2) | Covered |
| Chain include-deleted / searchCustomers deletedAt | R23-3/R23-4 — covered |
| Payment status / rate-change / D1 / Path A/B | Covered prior rounds |
| Electric loan shapes / cron / email list surfaces | N/A or already safe |
| Settle dialog optimistic `fully_paid` vs server `settled_with_collateral` | Pre-existing badge quirk; both non-operational — out of scope |

### Round 26 verdict: **Review loop closed (again)**

**No material new gaps beyond Round 25.** Round 25 closed the async optimistic race and the customer-name enrichment hole created by uncapping operational loans.

**Closure criterion met:** Two consecutive rounds (25 → 26) with Round 26 finding no new material gaps after R25 amendments are incorporated.

---

## File Touch List (Updated)

| File | Change |
|------|--------|
| `src/lib/loan-visibility.ts` | **New** — `isOperationalLoan`, `isTerminalLoanStatus`, `assertLoanOperational`, read-only helper |
| `src/services/payment.service.ts` | Operational guards; terminal status transitions; **`listPaymentsForCustomer` / `listPaymentsForLoanIds` (R17-2)**; **`getLoanBalanceSummary` deleted/status policy (R21-4)** |
| `src/app/(app)/loans/[loanId]/payment-table.tsx` | Hide edit/delete actions in read-only mode |
| `src/app/(app)/payments/PaymentsClient.tsx` | **Left join** loans (R15-3); fix running-balance scope; guard/disable mutations on non-operational loans |
| `src/services/customer.service.ts` | Server-side `loanStatus`; **overdue path `isNull(deletedAt)` (R23-4)**; wire via customers page (R19-2) |
| `cypress/e2e/loan-detail.cy.ts` | Remove/update stale Edit/Delete loan tests |
| `cypress/e2e/loan-balance-live.cy.ts` | Update for operational hook |
| `src/services/loan.service.ts` | Operational queries (**`LoanWithCustomer` + orderBy R25-4**), chain helpers, **`getLoanRowById({ includeDeleted })` (R23-3)**, export filter, `computeOverdue` fix, **`getLoanListEntryById`**, **`getLoanPaymentContext.status` (R17-1)**, **D1 block delete (R21-3)** |
| `src/collections/loan-views.ts` | Operational hook **prefers server customerName** (R25-2); fallback + redirect loading (R13-1/R23-2) |
| `src/lib/query-keys.ts` | **`loans.operational`** + customer/loan payment collection key prefixes (R21-1/R23-7) |
| `src/lib/cache-invalidation.ts` | Invalidate **`loans.all` + operational + `active-loan-check` + customer/loan payment prefixes** (R21/R23-1/R23-7) |
| `src/collections/loans.ts` | Mutation guards; on rollover **required optimistic predecessor → `rolled_over` + invalidate `loans.all` (R23-1/R25-1)** |
| `src/collections/operational-loans.ts` | **New** — uncapped active sync with **server customerName**; `subscribeToTableChanges`; remove predecessor on rollover optimistic (R15-1/R25-1/R25-2) |
| `src/collections/loan-views.ts` | Operational hook **prefers server customerName** (R25-2); fallback loading for redirect (R23-2) |
| `src/collections/loan-extras.ts` | Customer/loan payment collections; **raise/pin MAX_PER_ID for history deep links (R25-3)** |
| `src/app/(app)/loans/new/page.tsx` or `insertLoanWithInput` | **Optimistic predecessor status patch on rollover (R25-1)** |
| `src/app/(app)/loans/page.tsx` | Use operational hook |
| `src/app/(app)/loans/[loanId]/page.tsx` | **Do not redirect while R13-1 fallback is loading (R23-2)** |
| `src/app/(app)/customers/[id]/page.tsx` | Uncapped customer loans collection (R13-2) |
| `src/components/credit-score/credit-score-badge.tsx` | Uncapped customer loans + payments (R13-2/R17-2) |
| `src/lib/credit-score.ts` | **`scorePaydown` + penalties** terminal guards (R13-3/R15-5) |
| `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | History banner, read-only mode; **per-loan payments (R17-3)** |
| `src/app/(app)/loans/[loanId]/loan-info-cards.tsx` | Gate penalty UI + pending-rate badge on operational status |
| `src/app/(app)/loans/[loanId]/payments/new/page.tsx` | **`getLoanPaymentContext` + status (R15-4/R17-1)** fail-closed |
| `src/components/loans/loan-history-panel.tsx` | **New** — predecessor chain UI |
| `src/actions/loan.actions.ts` | **`listOperationalLoansAction`** + **`getLoanWithBalanceAction`** + history + export |
| `src/lib/interest/overdue.ts` | Zero non-active overdue/penalty outputs |
| `src/lib/interest/loanBalanceData.ts` | Zero non-active; **early-return before IO (R19-3)** |
| `src/lib/db/schema/loans.ts` + migration | **Index on `rolled_over_from` (R19-4)** |
| `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-PLAN.md` | **Blocking patch** Task 3 → `loan-visibility` helpers (R19-1) |
| `src/services/__integration__/rollover-report.test.ts` | **New** — portfolio/BS post-rollover |
| `scripts/db-backfill-payment-allocations.ts` | Filter `status = 'active'` only |
| `src/lib/db/__integration__/loan-balances-trigger.test.ts` | Rolled-over zero-balance case |
| `cypress/e2e/reports.cy.ts` or `report-details.cy.ts` | Post-rollover portfolio export |
| `src/services/rate-change-request.service.ts` | Operational guards; cancel pending on close |
| `src/services/collateral-settlement.service.ts` | Cancel pending rate requests on settlement |
| `src/app/(app)/approvals/page.tsx` | Filter/flag non-operational loan requests |
| `src/app/(app)/customers/page.tsx` | **Server search when loan filters set (R19-2)** |
| `src/services/activity.service.ts` | Rollover href → `rolledIntoLoanId` (R11-3) |
| `src/services/dashboard.service.ts` | Rollover recent activity → successor (R11-3) |
| `src/lib/email.ts` | Optional: resolve successor for deep links |
| `cypress/e2e/rollover-loan-visibility.cy.ts` | **New** E2E (dual-active race, redirect, soft-delete vs rolled_over, customer names) |
| `cypress/e2e/collateral-settlement.cy.ts` | Update list-count assertions post-fix |
| `scripts/reconcile-loan-balances.ts` | Zero-balance + chain + duplicate-successor (R9-8) |
| `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` | Disable submit when loan not active (R9-9) |

---

## Success Criteria

1. After rollover, `/loans` shows **exactly one row** per customer (the active successor).
2. Rolled-over loan data is **not deleted** — accessible via history UI and direct URL.
3. Export, print, and stat cards **exclude** non-active loans.
4. Dashboard, portfolio, overdue, accrual **unchanged** (already correct) + verified by tests.
5. Credit score **still includes** rolled-over loans in history.
6. Reconciliation confirms rolled-over loans have **~zero ledger balance** and intact predecessor/successor chain.
7. Cypress E2E covers visibility + history flow.
8. **Direct URL to `/loans/[id]/payments/new` on rolled-over loan is rejected** (UI + server).
9. **No mutation actions succeed** on non-operational loans (payment, penalty, rate change).
10. Historical loan detail pages render in **read-only mode** (no action buttons).
11. Delete-successor behavior: **blocked by default (D1 option a — R21-3)**; tested.
12. **Portfolio report and balance sheet show no double-count after rollover** (integration test R4-5).
13. **Payment edit/delete rejected** on non-operational loans (R4-3).
14. **Backfill script skips** rolled_over / non-active loans (R4-2).
15. Post-implementation **verification checklist** (Round 4) all items pass.
16. **Payment edit/delete/mark-wrong/unmark rejected** on rolled_over loans; status cannot flip to `fully_paid`/`active` via **all six** transition sites (R5-5/R9-1).
17. **`getLoanPredecessorChain` uses include-deleted DB reader** — not plain `getLoan()` (R5-9/R23-3).
18. Adversarial review loop **closed** (Rounds 25–26).
19. **Pending rate-change requests auto-cancelled** on rollover, settlement, and fully_paid (R7-1/R7-5).
20. **Rate change approve/apply rejected** on non-operational loans even if stale request remains (R7-2/R7-3/R7-4).
21. **Reconciliation asserts at most one successor** per rolled_over predecessor (R9-8).
22. **`/payments/new` fail-closed** for non-active loans — banner + disabled submit, not just server guard (R9-9).
23. **Path A (`computeLoanBalanceData`) zeroed** for non-active — watchlist fix is not `computeOverdue` alone (R11-1).
24. **Loan waiver PLAN.md Task 3** uses shared `loan-visibility.ts` helpers + cancels pending rate changes on full waiver (R11-2/R19-1) — **blocking artifact**.
25. **Rollover activity links** target successor loan (`rolledIntoLoanId`), not predecessor (R11-3).
26. **Historical loan deep links work** when loan is outside the 500-cap `listLoans` sync window (R13-1) **without redirect race (R23-2)**.
27. **Customer loan history** uses uncapped per-customer query, not 500-cap global collection filter (R13-2).
28. **Credit score paydown** not inflated by Path A display zeroing on `rolled_over` loans (R13-3).
29. **Operational watchlist + reports** use uncapped `listOperationalLoans()`, not capped `listLoans().filter` (R15-1/R15-2).
30. **Payments on historical loans** remain visible on `/payments` when loan is outside 500-cap sync (R15-3).
31. **`/payments/new` on rolled_over loan** shows inactive guard (not "Loan not found") even outside sync cap (R15-4/R17-1).
32. **Credit score penalties factor** preserves pre-rollover penalty history despite Path A zeroed `daysOverdue` (R15-5).
33. **`getLoanPaymentContext` includes `status`** so fail-closed UI does not need a second fetch (R17-1).
34. **Credit score uses uncapped customer payments**, not global 2000-cap `paymentCollection` (R17-2).
35. **Loan detail / history payment rows** load via per-loan query when outside global payment sync window (R17-3).
36. **Operational collection invalidates on create/rollover** so watchlist does not briefly show predecessor (R17-4).
37. **Customer loan-based filters** use server `searchCustomersAction`, not capped client `customerCollection` × `loanCollection` (R17-5/R19-2).
38. **Path A skips payment/ledger IO** for non-operational loans when zeroing (R19-3).
39. **`rolled_over_from` indexed** for successor/chain queries (R19-4).
40. **`queryKeys.loans.operational` + `invalidateLendingProjections`** refresh watchlist on settle / fully_paid / waiver / rollover (R21-1).
41. **`active-loan-check` cache invalidated** on loan lifecycle writes so new-loan wizard is not stale after rollover (R21-2).
42. **`deleteLoan` blocks** rollover successors and predecessors-with-successor (D1 default **(a)** — R21-3).
43. **`loanCollection` / `loans.all` invalidated** on rollover (R23-1).
44. **Customer overdue search excludes soft-deleted loans** (`deletedAt IS NULL`) (R23-4).
45. **Per-customer / per-loan payment collections invalidated** on lifecycle writes (R23-7).
46. **Rollover optimistically patches predecessor to `rolled_over`** before/at insert — invalidate alone is insufficient (R25-1).
47. **Operational watchlist customer names** come from server `LoanWithCustomer`, not 500-cap `customerCollection` (R25-2).
48. **Per-id history collections** do not evict the currently viewed loan mid-session (R25-3).
49. **`listOperationalLoans` returns `LoanWithCustomer` + newest-first order** matching `listLoans` contract (R25-4).

---

## Adversarial Review Summary

| Round | Focus | Key outcome |
|-------|--------|-------------|
| 1 | Initial plan vs codebase | Identified list/export/calculation gaps |
| 2 | Plan completeness | Hook-layer vs source fixes; credit score guard |
| 3 | Mutation paths, approvals, deep links | Payment URL bug; Phase 5 before Phase 2 |
| 4 | Interest, reports, exports, scripts | Backfill script; `computeLoanOverdueInfo`; verification checklist |
| 5 | UI layers, payment status corruption | **`deletePayment` can corrupt `rolled_over` status**; payment-table UI |
| 6 | Final sweep | No new gaps at the time (later superseded) |
| 7 | Async workflows (rate-change lifecycle) | **Stale pending requests survive rollover; approve mutates `rolled_over`** |
| 8 | Final sweep after R7 | No new gaps at the time (later superseded) |
| 9 | Payment status transitions — full inventory | **R5-5 incomplete: six sites flip `rolled_over` → `fully_paid`** |
| 10 | Final sweep after R9 | No new gaps at the time (later superseded) |
| 11 | Dual data path (Path A vs B) + waiver cross-plan | **Watchlist uses `loanBalanceCollection`, not `computeOverdue`** |
| 12 | Final sweep after R11 | No new material gaps at the time (later superseded) |
| 13 | **500-cap sync vs historical access** | **`listLoans` cap breaks direct URL + customer history; unused uncapped server action** |
| 14 | Final sweep after R13 | No new material gaps at the time (later superseded) |
| 15 | **500-cap operational surfaces + payments join** | **Filter-from-collection insufficient; reports still call capped `listLoans()`; payments inner join drops rows** |
| 16 | Final sweep after R15 | No new material gaps at the time (later superseded) |
| 17 | **Payment sync cap + incomplete R15-4 API** | **`getLoanPaymentContext` missing status; credit score/detail payments capped at 2000; operational collection not invalidated on create** |
| 18 | Final sweep after R17 | No new material gaps at the time (later superseded) |
| 19 | **Cross-plan drift + Path A IO + customers wiring** | **Waiver PLAN.md still unpatched; R17-5 needs page rewire; Path A must short-circuit before payment queries** |
| 20 | Final sweep after R19 | No new material gaps at the time (later superseded) |
| 21 | **Cache invalidation + D1 default** | **`operational` query key missing from shared invalidation; `activeLoanCheck` stale after rollover; D1 defaults to block** |
| 22 | Final sweep after R21 | No new material gaps at the time (later superseded) |
| 23 | **Stale `loanCollection` + plan contradictions** | **`loans.all` never invalidated; R13-1 redirect race; `getLoan` vs soft-delete; searchCustomers missing `deletedAt`** |
| 24 | Final sweep after R23 | No new material gaps at the time (later superseded) |
| 25 | **Optimistic dual-active + customer name cap** | **Invalidate ≠ sync rewrite; uncapped operational × 500-cap customers; FIFO 32 eviction; listOperationalLoans shape** |
| 26 | Final sweep after R25 | **No new material gaps — loop re-closed** |

---

## Recommended Execution Order (Updated)

1. Phase 1 (visibility helpers + **`listOperationalLoans()`** + on-demand loan fetch R13-1 + **`LoanPaymentContext.status` R17-1** + **`rolled_over_from` index R19-4** + **`queryKeys` operational/customer/loan-payment (R21/R23)** + **`getLoanRowById({ includeDeleted })` R23-3**)
2. **Cross-plan: patch waiver PLAN.md Task 3 (R19-1) — before or with Phase 1 merge**
3. Phase 4.1 (integrity check — catch ledger bugs early)
4. **Phase 5 (mutation guards + D1 block default R21-3) — before UI filtering**
5. **Phase 4 (Path A zeroing with IO short-circuit R19-3 + Path B `computeOverdue`)** — not active-only balance filter
6. Phase 2 ( **`operationalLoanCollection` + server customerName (R25-2)** + **required optimistic predecessor patch (R25-1)** + invalidate `loans.all`/operational/activeLoanCheck/customer collections (R21/R23) + detail redirect guard R23-2 + loans page + export/reports R15 + payments left join R15-3 + customer history R13-2 + **customers server search + `deletedAt` R19-2/R23-4** + **per-id cache pin R25-3**)
7. Phase 3 (history UI + read-only mode + **per-loan payments R17-3**)
8. Phase 6 (tests + Cypress dual-active / redirect-race / soft-delete vs rolled_over)

> **Ordering change from Round 3:** Ship mutation guards before hiding rolled-over loans from lists. Filtering alone leaves exploitable direct URLs.

---

## Related Docs

- Design spec: `docs/superpowers/specs/2026-04-06-collateral-settlement-rollover-design.md`
- Original rollover plan: `docs/superpowers/plans/2026-04-06-collateral-settlement-rollover.md`
- Perpetual threshold rollover: `docs/superpowers/plans/2026-04-27-perpetual-threshold-rollover.md`
- **Cross-plan (blocking R19-1):** Loan amount waiver — `.planning/quick/260722-loan-amount-waiver/260722-loan-waiver-PLAN.md` — **must patch Task 3** to reuse `loan-visibility.ts` (`assertLoanOperational`, `maybeUpdateLoanStatusAfterPayment`, cancel pending rate changes on full waiver). Waiver REVIEW-9 R9-H1 already requires this; PLAN.md is still stale.
