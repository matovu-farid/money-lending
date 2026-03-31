---
phase: 01-unify-loans-and-watchlist-pages
verified: 2026-03-31T14:10:00Z
status: passed
score: 15/15 must-haves verified
re_verification: false
---

# Phase 01: Unify Loans and Watchlist Pages — Verification Report

**Phase Goal:** Merge the Watchlist page and Loans list page into a single unified "Loans" page at /loans. Remove the separate /watchlist route.
**Verified:** 2026-03-31T14:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `listLoansWithOverdueAction` returns `outstandingBalance`, `dailyRate`, `lastPaymentDate` for every loan | VERIFIED | `computeOverdue` in `loan.actions.ts` fetches payments for ALL loan statuses (line 197-207), computes all three fields, returns `LoanListEntry[]` |
| 2  | Sidebar shows Loans but not Watchlist | VERIFIED | `sidebar.tsx` has no "Watchlist" or `AlertTriangle` reference; `data-testid="sidebar-nav"` present for Cypress test |
| 3  | MoreSheet shows no Watchlist entry | VERIFIED | `more-sheet.tsx` contains no "Watchlist" or `AlertTriangle` reference |
| 4  | `useLoans` hook fetches unified loan data via TanStack Query | VERIFIED | `src/hooks/use-loans.ts` exports `useLoans`, uses `queryKeys.loans.all`, calls `listLoansWithOverdueAction` via `unwrapAction` |
| 5  | User visits /loans and sees stat cards for Critical, At Risk, Early, and Total Overdue | VERIFIED | `loans/page.tsx` lines 224-292 render 4 stat cards with correct labels and `print:hidden` class |
| 6  | User clicks a stat card and the table filters to that category | VERIFIED | Each card's `onClick` calls `setActiveFilter(category)`; `filteredEntries` memo switches on `activeFilter` |
| 7  | User clicks a filter tab and the table filters accordingly | VERIFIED | `filterTabs.map(...)` renders `<Button>` for each category, each calls `setActiveFilter` |
| 8  | User clicks a table row and navigates to `/loans/{loanId}` | VERIFIED | `getRowProps` sets `onClick: () => router.push('/loans/${e.id}')` (line 341) |
| 9  | User clicks Customer Name link and navigates to `/customers/{id}` without triggering row click | VERIFIED | `<Link>` with `onClick={(ev) => ev.stopPropagation()}` (line 107) |
| 10 | User clicks Print button and `window.print()` is invoked | VERIFIED | `<Button onClick={() => window.print()}>Print</Button>` at line 313 |
| 11 | User visits /watchlist and gets a 404 | VERIFIED | `/watchlist` directory deleted; Cypress test confirms via `cy.request` with `failOnStatusCode: false` |
| 12 | Empty state shows "No loans yet." when no loans exist | VERIFIED | `loans/page.tsx` line 215: `<h2>No loans yet.</h2>` with `entries.length === 0 && !isLoading` guard |
| 13 | Empty state shows "No loans in this category." when filter has no results | VERIFIED | `loans/page.tsx` line 321: `<h2>No loans in this category.</h2>` with "Show all loans" button |
| 14 | Mobile card layout renders at 390px viewport | VERIFIED | `ResponsiveTable` component handles card layout; Cypress test at 390x844 verifies `[data-slot='table-container']` not visible and `[data-testid='data-row']` visible |
| 15 | Sidebar shows Loans but not Watchlist (Cypress-verifiable) | VERIFIED | Cypress test "sidebar shows Loans but not Watchlist" checks `[data-testid='sidebar-nav']` at 1280px viewport |

**Score:** 15/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | `LoanListEntry` type | VERIFIED | Lines 14-19: `export type LoanListEntry = LoanWithCustomer & { daysOverdue, outstandingBalance, dailyRate, lastPaymentDate }` |
| `src/hooks/use-loans.ts` | `useLoans` TanStack Query hook | VERIFIED | 19-line file, exports `useLoans`, substantive (not stub) |
| `src/actions/loan.actions.ts` | Extended `computeOverdue` with watchlist fields | VERIFIED | `outstandingBalance` computed on line 206, `lastPaymentDate` line 207, `dailyRate` line 218; `asc` import confirmed line 19 |
| `src/app/(app)/loans/page.tsx` | Unified loans page (min 150 lines) | VERIFIED | 351 lines; stat cards, filter tabs, 9 columns, `criticalityRank`, print support all present |
| `cypress/e2e/loans-list.cy.ts` | Comprehensive E2E tests (min 100 lines) | VERIFIED | 165 lines; 15 test cases covering all required behaviors |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/hooks/use-loans.ts` | `src/actions/loan.actions.ts` | `listLoansWithOverdueAction` import | WIRED | Line 6: `import { listLoansWithOverdueAction } from "@/actions/loan.actions"` — used on line 13 |
| `src/hooks/use-loans.ts` | `src/hooks/query-keys.ts` | `queryKeys.loans.all` | WIRED | Line 11: `queryKey: queryKeys.loans.all` |
| `src/app/(app)/loans/page.tsx` | `src/hooks/use-loans.ts` | `useLoans()` hook import | WIRED | Line 6: `import { useLoans } from "@/hooks/use-loans"` — used on line 41 |
| `src/app/(app)/loans/page.tsx` | `src/components/ui/responsive-table` | `ResponsiveTable` component | WIRED | Line 8: import — used on line 334 |
| `src/app/(app)/loans/page.tsx` | `src/components/watchlist/overdue-badge` | `OverdueBadge` for days overdue column | WIRED | Line 7: import — used on line 148 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UNIFY-DATA | 01-01-PLAN.md | `LoanListEntry` type with `outstandingBalance`, `dailyRate`, `lastPaymentDate`; `computeOverdue` fetches payments for all loan statuses | SATISFIED | Type exists in `src/types/index.ts` lines 14-19; `computeOverdue` fetches all-status payments at `loan.actions.ts` lines 197-207 |
| UNIFY-NAV | 01-01-PLAN.md | Sidebar and MoreSheet no longer show Watchlist entry | SATISFIED | Both `sidebar.tsx` and `more-sheet.tsx` contain zero references to "Watchlist" or `AlertTriangle` |
| UNIFY-UI | 01-02-PLAN.md | Unified /loans page with stat cards, filter tabs, criticality sort, 9-column ResponsiveTable, print support | SATISFIED | `loans/page.tsx` is 351 lines with all required UI elements; /watchlist directory deleted |
| UNIFY-E2E | 01-02-PLAN.md | Cypress E2E tests covering all 13+ unified loans page behaviors | SATISFIED | `cypress/e2e/loans-list.cy.ts` contains 15 tests covering all behaviors from plan's acceptance criteria; `watchlist.cy.ts` deleted |

All 4 phase requirements are fully satisfied. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/interest/engine.ts` | 63 | Comment `Used for the watchlist (RISK-01, RISK-02)` | Info | Stale comment referencing old watchlist feature; no functional impact. The component (`OverdueBadge`) now serves the unified loans page, not a dedicated watchlist. |

No blockers or warnings. The `src/components/watchlist/` directory still exists but only contains `overdue-badge.tsx` which is legitimately used by `loans/page.tsx`, `customers/[id]/page.tsx`, and `payments/DailyCollectionsTab.tsx`. This is expected — the directory name is a legacy path for a shared component, not a watchlist route artifact.

### Human Verification Required

None. All verification items are covered by automated Cypress tests per project policy (AGENTS.md: all visual/interaction verification must use Cypress E2E tests, not manual checkpoints).

The Cypress test suite at `cypress/e2e/loans-list.cy.ts` covers:
- Empty state rendering
- Stat card labels and click-to-filter behavior
- Filter tab counts and activation
- Row click navigation to `/loans/{id}`
- Customer Name link navigation to `/customers/{id}` (stop propagation)
- Print button presence
- 9-column table headers
- Filter empty state and "Show all loans" reset
- /watchlist 404 response
- Sidebar Watchlist absence
- Mobile card layout at 390x844 viewport
- Bottom tab bar presence at mobile

### Gaps Summary

No gaps. All must-haves from both plans are verified. The phase goal — merging /watchlist and /loans into a single unified page while deleting the /watchlist route — is fully achieved.

**Data layer (UNIFY-DATA, UNIFY-NAV):** `LoanListEntry` type, extended `computeOverdue`, `useLoans` hook, and navigation cleanup are all implemented and wired correctly.

**UI layer (UNIFY-UI, UNIFY-E2E):** The unified `/loans` page is substantive (351 lines) with all 9 required columns, stat cards, filter tabs, criticality sort, print support, dual empty states, and mobile card layout. The `/watchlist` route is deleted. The Cypress test file is substantive (165 lines, 15 tests) covering every required behavior.

---

_Verified: 2026-03-31T14:10:00Z_
_Verifier: Claude (gsd-verifier)_
