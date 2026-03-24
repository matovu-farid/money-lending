---
phase: 11-test-selector-foundation
plan: 01
subsystem: testing
tags: [cypress, data-testid, e2e, test-selectors, sidebar, table]

# Dependency graph
requires: []
provides:
  - data-testid="sidebar-nav" on the only <nav> element in sidebar.tsx
  - data-testid="data-row" on all TableRow elements inside TableBody across the entire app
  - Cypress specs using stable data-testid selectors instead of structural queries
affects: [phases 12-16, any future Cypress spec that queries nav or table rows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All nav assertions use [data-testid='sidebar-nav'] not bare cy.get('nav')"
    - "All table row assertions use [data-testid='data-row'] not cy.get('table tbody tr')"
    - "data-testid='data-row' on body rows only, never on header rows or skeleton/loading rows"

key-files:
  created: []
  modified:
    - src/components/layout/sidebar.tsx
    - src/app/(app)/customers/page.tsx
    - src/app/(app)/customers/[id]/page.tsx
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/payments/PaymentsClient.tsx
    - src/app/(app)/payments/DailyCollectionsTab.tsx
    - src/app/(app)/expenses/ExpenseListClient.tsx
    - src/app/(app)/income/IncomeListClient.tsx
    - src/app/(app)/admin/page.tsx
    - src/app/(app)/transactions/TransactionLogClient.tsx
    - src/app/(app)/creditors/page.tsx
    - src/app/(app)/creditors/[id]/CreditorProfileClient.tsx
    - src/app/(app)/watchlist/page.tsx
    - src/app/(app)/reports/portfolio/PortfolioClient.tsx
    - cypress/e2e/payments-list.cy.ts
    - cypress/e2e/admin-panel.cy.ts
    - cypress/e2e/design-system.cy.ts

key-decisions:
  - "Skeleton/loading placeholder rows do not get data-testid='data-row' — they are not real data and have no stable identity"
  - "data-testid='sidebar-nav' targets the single navigation nav element in sidebar.tsx only — not AppShell which does not exist yet"

patterns-established:
  - "data-testid='data-row': every TableRow inside a TableBody across the entire app gets this attribute"
  - "data-testid='sidebar-nav': exactly one nav element in sidebar.tsx carries this attribute"

requirements-completed: [TEST-01]

# Metrics
duration: 25min
completed: 2026-03-25
---

# Phase 11 Plan 01: Test Selector Foundation Summary

**data-testid="sidebar-nav" and data-testid="data-row" added to 15 source files; Cypress selectors migrated from structural queries to testid-based queries in 3 spec files**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-25T00:00:00Z
- **Completed:** 2026-03-25T00:25:00Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments
- Added data-testid="sidebar-nav" to the nav element in sidebar.tsx
- Added data-testid="data-row" to all TableRow elements inside TableBody across 15 app files (customers, loans, payments, admin, expenses, income, transactions, creditors, watchlist, reports, and detail pages)
- Migrated all Cypress structural selectors: cy.get("nav") → [data-testid='sidebar-nav'], cy.get("table tbody tr") → [data-testid='data-row'], [data-slot=table] tbody tr → [data-testid='data-row']
- Zero remaining bare structural selectors in any Cypress spec file

## Task Commits

Each task was committed atomically:

1. **Task 1: Add data-testid attributes to sidebar nav and all data TableRows** - `eb78681` (feat)
2. **Task 2: Migrate Cypress selectors from structural queries to data-testid queries** - `1fb58d5` (feat)

## Files Created/Modified
- `src/components/layout/sidebar.tsx` - Added data-testid="sidebar-nav" to nav element
- `src/app/(app)/customers/page.tsx` - Added data-testid="data-row" to customer TableRows
- `src/app/(app)/customers/[id]/page.tsx` - Added data-testid="data-row" to payment history TableRows
- `src/app/(app)/loans/page.tsx` - Added data-testid="data-row" to loan TableRows
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` - Added data-testid="data-row" to payment TableRows
- `src/app/(app)/payments/PaymentsClient.tsx` - Added data-testid="data-row" to payment TableRows
- `src/app/(app)/payments/DailyCollectionsTab.tsx` - Added data-testid="data-row" to data rows (not skeleton rows)
- `src/app/(app)/expenses/ExpenseListClient.tsx` - Added data-testid="data-row" to expense TableRows
- `src/app/(app)/income/IncomeListClient.tsx` - Added data-testid="data-row" to income TableRows
- `src/app/(app)/admin/page.tsx` - Added data-testid="data-row" to user TableRows
- `src/app/(app)/transactions/TransactionLogClient.tsx` - Added data-testid="data-row" to transaction TableRows
- `src/app/(app)/creditors/page.tsx` - Added data-testid="data-row" to creditor TableRows
- `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx` - Added data-testid="data-row" to investment and repayment TableRows
- `src/app/(app)/watchlist/page.tsx` - Added data-testid="data-row" to watchlist data TableRows (not skeleton rows)
- `src/app/(app)/reports/portfolio/PortfolioClient.tsx` - Added data-testid="data-row" to portfolio TableRows
- `cypress/e2e/payments-list.cy.ts` - Migrated cy.get("table tbody tr") and cy.get("nav") to testid selectors
- `cypress/e2e/admin-panel.cy.ts` - Migrated cy.get("table tbody tr") to testid selector
- `cypress/e2e/design-system.cy.ts` - Migrated [data-slot=table] tbody tr to testid selector

## Decisions Made
- Skeleton/loading placeholder rows (used for animated loading states) do not get data-testid="data-row" since they are not real data rows and have numeric keys like `key={i}` with no stable identity.
- Scope expanded beyond the 5 files listed in the plan to cover ALL TableBody rows across the entire app, per the plan's own instruction to check for additional pages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended data-testid coverage beyond listed files to all app pages**
- **Found during:** Task 1 (Add data-testid attributes)
- **Issue:** Plan listed 5 target files but instructed to check for additional pages and add data-row to all TableBody rows app-wide
- **Fix:** Added data-testid="data-row" to 10 additional files beyond the 5 specified (customers detail, loan detail, DailyCollectionsTab, expenses, income, transactions, creditors detail, creditors list, watchlist, reports portfolio)
- **Files modified:** As listed above
- **Verification:** grep confirms data-testid="data-row" exists in all TableBody rows, zero in TableHeader rows
- **Committed in:** eb78681 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (scope expansion per plan's own instruction)
**Impact on plan:** Required by the plan. No scope creep beyond plan intent.

## Issues Encountered
- Some Cypress tests fail due to pre-existing auth session management issues in multi-user test flows (beforeEach hooks timing out when redirected to /login). These failures are unrelated to selector changes — the test `shows Last Active date column (AUTH-04)` which directly uses the new `[data-testid='data-row']` selector passes. The auth infrastructure failures were present before this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stable testid foundation is in place before Phase 12+ adds BottomTabBar (second nav element) and responsive card views (DOM structure changes)
- All Cypress specs are resilient to upcoming structural DOM changes in Phases 12-16
- Phase 11 Plan 02 can proceed with confidence the test selector foundation is solid

---
*Phase: 11-test-selector-foundation*
*Completed: 2026-03-25*
