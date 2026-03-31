# Phase 1: Unify Loans and Watchlist Pages — Research

**Researched:** 2026-03-31
**Domain:** Next.js App Router, React, TanStack Query, Drizzle ORM, Cypress E2E
**Confidence:** HIGH

---

## Summary

The project has two separate pages that overlap in purpose: `/watchlist` (overdue-only, risk-focused view of active loans) and `/loans` (all loans, simpler). The goal is to merge them into a single `/loans` page that shows all loans while incorporating the watchlist's risk columns and stat cards.

The current `/watchlist` page already has the visual infrastructure this phase needs: stat cards, filter tabs, OverdueBadge, criticality sorting, and ResponsiveTable integration. The current `/loans` page already has the right data action (`listLoansWithOverdueAction`) which returns all loan statuses with computed overdue days. The unification work is primarily: extend the data shape to include watchlist-style fields for all loans, rebuild the `/loans` page with the watchlist's UI patterns, then delete the watchlist route and all its supporting files.

There are more files referencing `/watchlist` than just the page — the sidebar, mobile `MoreSheet`, bottom tab bar (no reference, already points to /loans), query-keys, and an existing hook and service. All need to be cleaned up. Several Cypress E2E files test both pages independently; those must be superseded by a new unified E2E test.

**Primary recommendation:** Reuse `listLoansWithOverdueAction` as the data source, extend `LoanWithCustomer` with watchlist-style fields (outstandingBalance, dailyRate, lastPaymentDate), then replace both pages with a single unified component.

---

## Current Codebase Inventory

### Files to DELETE
| File | Reason |
|------|--------|
| `src/app/(app)/watchlist/page.tsx` | Route being removed |
| `src/actions/watchlist.actions.ts` | Wraps `getWatchlistData` — no longer needed |
| `src/services/watchlist.service.ts` | Logic moves into `loan.actions.ts` or stays via extended query |
| `src/hooks/use-watchlist.ts` | Replaced by a new `use-loans` hook |
| `src/services/__tests__/watchlist.service.test.ts` | Tests for deleted service |
| `src/services/__integration__/watchlist.service.test.ts` | Integration tests for deleted service |
| `src/hooks/__tests__/use-watchlist.test.ts` | Tests for deleted hook |
| `cypress/e2e/watchlist.cy.ts` | Superseded by new unified loans E2E |

### Files to MODIFY
| File | Change |
|------|--------|
| `src/app/(app)/loans/page.tsx` | Replace with unified page component |
| `src/components/layout/sidebar.tsx` | Remove "Watchlist" entry, keep "Loans" entry (already present) |
| `src/components/layout/more-sheet.tsx` | Change "Watchlist" item to point to `/loans` or remove it |
| `src/hooks/query-keys.ts` | Remove `watchlist` key, add `loans.list()` key if not present |
| `src/actions/loan.actions.ts` | Extend `listLoansWithOverdueAction` to also return watchlist fields |
| `src/types/index.ts` | Add unified type: `LoanListEntry` (loan + overdue + watchlist fields) |
| `cypress/e2e/loans-list.cy.ts` | Replace with comprehensive unified test file |

### Files to CREATE
| File | Reason |
|------|--------|
| `src/hooks/use-loans.ts` | TanStack Query hook for the unified loans list |

---

## Current Data Shape Gap Analysis

The unified page needs MORE data than either current page exposes individually.

**Current `listLoansWithOverdueAction` returns:** `LoanWithCustomer & { daysOverdue: number }`
- Has: `id`, `customerId`, `customerName`, `principalAmount`, `interestRate`, `status`, `startDate`, `daysOverdue`
- Missing: `outstandingBalance`, `dailyRate`, `lastPaymentDate`, `interestOwed`

**Current `getWatchlistAction` returns:** `WatchlistEntry[]`
- Has: `customerId`, `customerName`, `loanId`, `loanAmount`, `outstandingBalance`, `daysOverdue`, `dailyRate`, `lastPaymentDate`
- Missing: `status`, `startDate`, `interestRate`, `principalAmount` as named field
- Only includes ACTIVE loans with `daysOverdue > 0`

**Unified requirement:** All loans (active, pending, fully_paid), sorted by criticality, with BOTH sets of fields.

### Recommended Data Strategy

Option A — Extend `computeOverdue` in `loan.actions.ts` to also fetch payments and compute the watchlist fields for every loan. This is self-contained.

Option B — Create a new `getLoanListData` service function that joins watchlist logic into the loans query.

**Recommendation: Option A.** The `computeOverdue` helper in `loan.actions.ts` already does the per-loan payment fetching for active loans. Extend it to always compute `outstandingBalance`, `dailyRate`, and `lastPaymentDate` for all statuses (they're zero/null for non-active loans).

### New unified type

```typescript
// In src/types/index.ts — add alongside existing types
export type LoanListEntry = LoanWithCustomer & {
  daysOverdue: number          // 0 for non-overdue loans
  outstandingBalance: string   // last payment's principalBalanceAfter, or principalAmount
  dailyRate: string            // dailyInterestAmount in UGX as string
  lastPaymentDate: Date | null
  interestOwed: number         // daysOverdue * parseFloat(dailyRate)
}
```

---

## Architecture Patterns

### Page Component Structure

Follow the pattern from `watchlist/page.tsx` — the watchlist page is the authoritative template. The unified loans page should:

1. Import a `useLoans()` hook (mirrors `useWatchlist()` structure)
2. Accept `FilterCategory` state: `"all" | "critical" | "at-risk" | "early" | "current"`
3. Show stat cards (clickable, same 4 as watchlist, same color scheme)
4. Show filter tabs with counts
5. Show `ResponsiveTable` with all required columns
6. Row `onClick` navigates to `/loans/${loanId}` (NOT customer profile — key difference from current watchlist)

**Key departure from current watchlist page:** Current watchlist `getRowProps.onClick` navigates to `/customers/${e.customerId}`. Phase requirement says row clicks go to `/loans/{loanId}`. The "View Loan" actions column can be dropped; row click IS the navigation.

### Criticality Sort Order

The phase requires "criticality ordering" as default. Map to a sort key:

```typescript
function criticalityRank(entry: LoanListEntry): number {
  const days = entry.daysOverdue
  if (days >= 30) return 0    // critical — first
  if (days >= 15) return 1    // at-risk
  if (days >= 1)  return 2    // early
  return 3                    // current (0 days overdue)
}
// Then sort by criticalityRank ascending, then daysOverdue descending within group
```

### Categorization for Stat Cards

Current watchlist categorizes only overdue loans. The unified view must handle "current" loans (daysOverdue === 0) which are excluded from the filter tabs but still appear in "All":

```typescript
type FilterCategory = "all" | "critical" | "at-risk" | "early"
// "current" loans appear in "All" but not in any named category tab
// This matches the requirement: filter tabs are the 4 watchlist categories
```

Stat cards show only the 3 overdue categories (Critical/At-Risk/Early/Total-overdue) — the current loans don't get a separate card.

### Print Support

The `window.print()` API with `@media print` CSS is the correct approach. Implementation pattern:

```typescript
// In page component
function handlePrint() {
  window.print()
}
```

```css
/* In global CSS or inline via className */
@media print {
  /* Hide sidebar, header, filter buttons, stat cards */
  /* Show only the table */
  /* page-break-avoid on table rows */
}
```

This requires a `data-print-hide` attribute pattern on elements to suppress, and a print-specific stylesheet section. The simplest approach is a `print:hidden` utility class via Tailwind (Tailwind has `print:` variant built-in).

**Tailwind print variant is confirmed supported** (`print:hidden`, `print:block` etc.) — use these instead of raw `@media print` in CSS files.

### ResponsiveTable Column Definitions

The unified columns (from phase requirements):

| Column Key | Header | Notes |
|------------|--------|-------|
| `customerName` | Customer Name | Link to `/customers/${customerId}`, `primary: true` |
| `principalAmount` | Principal Amount | formatCurrency, `align: "right"` |
| `outstandingBalance` | Outstanding Balance | formatCurrency, `align: "right"` |
| `interestRate` | Interest Rate | `(rate * 100).toFixed(0)% / month` |
| `daysOverdue` | Days Overdue | `<OverdueBadge>` when > 0, else `—` |
| `status` | Status | `<Badge>` |
| `dailyRate` | Daily Rate | formatCurrency, `align: "right"` |
| `lastPayment` | Last Payment | formatDate or "No payments" |
| `startDate` | Start Date | formatDate, `hideInCard: true` |

### Sidebar Change

Current `sidebar.tsx` `navGroups` Operations section has BOTH "Watchlist" (AlertTriangle icon) and "Loans" (Banknote icon). Phase requirement: remove "Watchlist" entry, keep "Loans" entry with Banknote icon pointing to `/loans`. The sidebar change is a single array modification.

### MoreSheet Change

`more-sheet.tsx` `MORE_ITEMS` includes `{ label: "Watchlist", href: "/watchlist", icon: AlertTriangle }`. This entry must be removed. "Loans" is already in the bottom tab bar primary tabs, so it does not need to be added to MoreSheet.

### Hook Pattern

Follow exact pattern of `use-watchlist.ts`:

```typescript
// src/hooks/use-loans.ts
"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { listLoansWithOverdueAction } from "@/actions/loan.actions"
import type { LoanListEntry } from "@/types"

export function useLoans() {
  return useQuery<LoanListEntry[]>({
    queryKey: queryKeys.loans.all,
    queryFn: async () => {
      const result = await listLoansWithOverdueAction()
      return unwrapAction<LoanListEntry[]>(
        result as { data: LoanListEntry[] } | { error: string }
      )
    },
  })
}
```

The `queryKeys.loans.all` key already exists. The action already exists. The hook is thin glue.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Responsive table | Custom responsive logic | `ResponsiveTable` (already in codebase) | Battle-tested, has card layout, handles desktop/mobile split |
| Overdue severity badge | Custom badge | `OverdueBadge` (already in codebase) | Color semantics already correct for this domain |
| Print layout | Custom print library | `print:hidden` / `print:block` Tailwind variants | Built-in, zero-cost |
| Interest math | Re-implement formulas | `calculateDailyRate`, `calculateInterest`, `calculateDaysOverdue` from `@/lib/interest` | Correct rounding, min-period logic already handled |
| QueryKey management | Inline strings | `queryKeys.loans.all` from `query-keys.ts` | Cache invalidation requires consistent keys |

---

## Common Pitfalls

### Pitfall 1: Row Navigation Points to Customer Instead of Loan
**What goes wrong:** Current watchlist `getRowProps.onClick` navigates to `/customers/${e.customerId}`. If copied verbatim, the row click goes to the wrong place.
**How to avoid:** `onClick: () => router.push(`/loans/${entry.id}`)` — use `loanId`, not `customerId`.

### Pitfall 2: Stat Cards Show Only Overdue Loans, but "All" Tab Shows All Loans
**What goes wrong:** If you filter `entries` before computing stats, "All" count will show only overdue count, not total.
**How to avoid:** Compute stats from the full `entries` array. The "All" tab shows ALL loans regardless of overdue status. The category stats (Critical/At-Risk/Early) show counts from the overdue subset.

### Pitfall 3: Empty State Logic Has Two Cases
**What goes wrong:** Using a single empty state check misses the "filter has no results" vs "no loans at all" distinction.
**How to avoid:**
- `entries.length === 0` → "No loans yet" + New Loan button
- `filteredEntries.length === 0 && activeFilter !== "all"` → "No loans match this filter" + clear filter button

### Pitfall 4: Pending Loans Have No Payments — Don't Break Outstanding Balance
**What goes wrong:** `computeOverdue` uses `loanPayments.at(-1)?.principalBalanceAfter` for outstanding balance. For pending loans with no payments, this is undefined. Must fall back to `loan.principalAmount`.
**How to avoid:** The existing watchlist service pattern already handles this:
```typescript
const outstandingBalance = lastPayment
  ? lastPayment.principalBalanceAfter
  : loan.principalAmount
```
Apply same pattern in the extended `computeOverdue`.

### Pitfall 5: Watchlist QueryKey Leaks After Removal
**What goes wrong:** Removing the `watchlist` query key from `query-keys.ts` while other files still import it will cause TypeScript errors.
**How to avoid:** Remove `watchlist.actions.ts` and `use-watchlist.ts` first (or in same commit), then remove the key from `query-keys.ts`. Grep for `queryKeys.watchlist` to catch all usages.

### Pitfall 6: Cypress Tests Reference `/watchlist` Route After Deletion
**What goes wrong:** `watchlist.cy.ts` navigates to `/watchlist`, which returns 404 after the route is deleted.
**How to avoid:** Delete `cypress/e2e/watchlist.cy.ts` and replace `cypress/e2e/loans-list.cy.ts` with the comprehensive unified test file. Do this in the same task wave as the route deletion.

### Pitfall 7: `interestOwed` Is Computed In-Component, Not Returned from Server
**What goes wrong:** Current watchlist page computes `interestOwed` inline: `parseInt(e.daysOverdue) * parseFloat(e.dailyRate)`. This is fine for display but if a column definition is extracted elsewhere, it needs access to both fields.
**How to avoid:** Either keep the inline computation in the render function, or pre-compute it in `computeOverdue` and include it in the returned type. Pre-computing is cleaner for sorting.

---

## Code Examples

### Extending computeOverdue to Return Watchlist Fields

```typescript
// Source: loan.actions.ts — extend the existing computeOverdue helper
async function computeOverdue(loanList: LoanWithCustomer[]) {
  const now = new Date()
  return Promise.all(
    loanList.map(async (loan) => {
      let daysOverdue = 0
      let outstandingBalance = loan.principalAmount
      let dailyRate = "0"
      let lastPaymentDate: Date | null = null

      // Always fetch payments (needed for outstandingBalance and lastPaymentDate)
      const loanPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))

      const lastPayment = loanPayments.at(-1)  // assume ordered by date
      if (lastPayment) {
        outstandingBalance = lastPayment.principalBalanceAfter
        lastPaymentDate = lastPayment.paymentDate
      }

      if (loan.status === "active") {
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const totalInterestAccrued = calculateInterest(loan.principalAmount, effectiveRate, totalDaysElapsed, 0)
        const dailyRateBN = calculateDailyRate(effectiveRate)
        const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRateBN)
        dailyRate = dailyInterestAmount.toFixed(2)

        const totalInterestPaid = loanPayments.reduce(
          (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
        )
        const daysOverdueBN = calculateDaysOverdue(
          totalInterestAccrued.toFixed(2),
          totalInterestPaid.toFixed(2),
          dailyInterestAmount.toFixed(2)
        )
        daysOverdue = daysOverdueBN.toNumber()
      }

      return { ...loan, daysOverdue, outstandingBalance, dailyRate, lastPaymentDate }
    })
  )
}
```

Note: The existing `computeOverdue` already fetches payments per loan for active loans. The extension adds payment fetch for all statuses and captures `outstandingBalance` and `lastPaymentDate`.

**Performance note:** This makes N payment queries (one per loan). This is the existing pattern — no regression introduced. For very large loan portfolios, a JOIN-based approach would be preferable, but is out of scope for this phase.

### Criticality Sort

```typescript
function criticalityRank(entry: LoanListEntry): number {
  if (entry.daysOverdue >= 30) return 0
  if (entry.daysOverdue >= 15) return 1
  if (entry.daysOverdue >= 1)  return 2
  return 3  // current
}

// Sort: by rank asc, then within overdue group by daysOverdue desc
const sorted = [...entries].sort((a, b) => {
  const rankDiff = criticalityRank(a) - criticalityRank(b)
  if (rankDiff !== 0) return rankDiff
  return b.daysOverdue - a.daysOverdue
})
```

### Print Button

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => window.print()}
  className="print:hidden"
>
  Print
</Button>

{/* In the table wrapper: */}
<div className="print:block">
  <ResponsiveTable ... />
</div>
```

Add `print:hidden` to: sidebar, header buttons (New Loan, Print), stat cards, filter tabs.
The table itself should render all rows when printing (not just the filtered view — but per phase requirements, "print the current filtered view", so keep filter state and just hide UI chrome).

---

## Files Referencing Watchlist — Complete List

Run-time check confirms these files must be updated or deleted:

| File | What to Do |
|------|-----------|
| `src/app/(app)/watchlist/page.tsx` | DELETE entire file |
| `src/actions/watchlist.actions.ts` | DELETE |
| `src/services/watchlist.service.ts` | DELETE |
| `src/hooks/use-watchlist.ts` | DELETE |
| `src/hooks/query-keys.ts` | Remove `watchlist` key object |
| `src/components/layout/sidebar.tsx` | Remove "Watchlist" nav item from Operations group |
| `src/components/layout/more-sheet.tsx` | Remove "Watchlist" from `MORE_ITEMS` |
| `src/services/__tests__/watchlist.service.test.ts` | DELETE |
| `src/services/__integration__/watchlist.service.test.ts` | DELETE |
| `src/hooks/__tests__/use-watchlist.test.ts` | DELETE |
| `cypress/e2e/watchlist.cy.ts` | DELETE |
| `cypress/e2e/loans-list.cy.ts` | REPLACE with comprehensive unified tests |

Note: `src/app/(app)/customers/[id]/page.tsx` references watchlist for the customer-level overdue view — confirm it uses `getCustomerLoansWithOverdueAction` directly, not the watchlist service. If so, no change needed there.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Cypress 14.x (E2E) |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/loans-list.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map

| Behavior | Test Type | Automated Command |
|----------|-----------|-------------------|
| Page loads at /loans with heading | E2E | `cypress/e2e/loans-list.cy.ts` |
| Stat cards visible (Critical/At-Risk/Early/Total) | E2E | `cypress/e2e/loans-list.cy.ts` |
| Clicking stat card activates corresponding filter | E2E | `cypress/e2e/loans-list.cy.ts` |
| Filter tabs (All/Critical/At-Risk/Early) work | E2E | `cypress/e2e/loans-list.cy.ts` |
| Row click navigates to /loans/{loanId} | E2E | `cypress/e2e/loans-list.cy.ts` |
| Customer Name link navigates to /customers/{id} | E2E | `cypress/e2e/loans-list.cy.ts` |
| New Loan button navigates to /loans/new | E2E | `cypress/e2e/loans-list.cy.ts` |
| Print button exists and is visible | E2E | `cypress/e2e/loans-list.cy.ts` |
| Empty state "No loans yet" when no loans | E2E | `cypress/e2e/loans-list.cy.ts` |
| Empty state "No loans match this filter" when filter empty | E2E | `cypress/e2e/loans-list.cy.ts` |
| /watchlist returns 404 after deletion | E2E | `cypress/e2e/loans-list.cy.ts` |
| Sidebar shows "Loans" but not "Watchlist" | E2E | `cypress/e2e/loans-list.cy.ts` |
| Mobile card layout renders at 390px | E2E | `cypress/e2e/loans-list.cy.ts` |

### Wave 0 Gaps

`cypress/e2e/loans-list.cy.ts` exists but covers only basic scenarios. It must be REWRITTEN (not extended) in Wave 1 of execution to cover all behaviors above.

---

## Open Questions

1. **Should `interestOwed` be pre-computed server-side or computed client-side?**
   - What we know: Current watchlist computes it client-side as `days * dailyRate`. This works.
   - Recommendation: Keep it client-side in the render function (not added to server return type). Avoids type complexity for a derived value.

2. **Does `src/app/(app)/customers/[id]/page.tsx` use `getWatchlistAction` or its own loan query?**
   - What we know: It imports `getCustomerLoansWithOverdueAction` from `loan.actions.ts`, not from watchlist. Safe to delete watchlist service without touching that page.
   - Confidence: HIGH (confirmed by grep results showing only the files listed use watchlist imports).

3. **Should fully_paid loans show watchlist risk columns?**
   - What we know: Phase requirements say "Show ALL loans with watchlist-style risk information". But fully_paid loans have daysOverdue = 0 and dailyRate = 0.
   - Recommendation: Show the columns for all, display `—` for zero values. The OverdueBadge already handles `daysOverdue = 0` by not rendering in current loans page (shows `—`).

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/app/(app)/watchlist/page.tsx` — complete page component
- Direct codebase inspection: `src/app/(app)/loans/page.tsx` — complete page component
- Direct codebase inspection: `src/services/watchlist.service.ts` — complete service
- Direct codebase inspection: `src/actions/loan.actions.ts` — `computeOverdue`, `listLoansWithOverdueAction`
- Direct codebase inspection: `src/types/index.ts` — `WatchlistEntry`, `LoanWithCustomer` types
- Direct codebase inspection: `src/components/layout/sidebar.tsx` — nav structure
- Direct codebase inspection: `src/components/layout/more-sheet.tsx` — mobile nav
- Direct codebase inspection: `src/components/layout/bottom-tab-bar.tsx` — mobile tab bar
- Direct codebase inspection: `src/components/ui/responsive-table.tsx` — table API
- Direct codebase inspection: `src/hooks/query-keys.ts` — query key structure
- Direct codebase inspection: `src/hooks/use-watchlist.ts` — hook pattern
- Direct codebase inspection: `cypress/e2e/watchlist.cy.ts` — existing tests
- Direct codebase inspection: `cypress/e2e/loans-list.cy.ts` — existing tests

### Secondary (MEDIUM confidence)
- Tailwind `print:` variant support — well-established feature, no version concern
- `window.print()` browser API — universal, no library needed

---

## Metadata

**Confidence breakdown:**
- Data layer: HIGH — both services inspected, gap is clear and bridgeable
- UI components: HIGH — ResponsiveTable, OverdueBadge, sidebar all inspected
- File deletion scope: HIGH — grep confirmed complete list of watchlist references
- Print implementation: HIGH — Tailwind print variant is standard

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable codebase, no external dependency changes expected)
