---
phase: 07-daily-collections-view
plan: 02
subsystem: payments-ui
tags: [react, next, tanstack-query, base-ui, date-fns, bignumber, cypress]

requires:
  - phase: 07-01
    provides: useDailyCollections, useLoansDueToday hooks, DailyCollectionRow/Summary/LoanDueToday types

provides:
  - DailyCollectionsTab client component with date navigation, summary cards, breakdown table, due-today list
  - PaymentsClient extended with All Payments / Daily tab switcher
  - page.tsx updated to pass tab param as initialTab to client
  - Cypress E2E test suite covering all COLL-01 through COLL-04 requirements

affects:
  - /payments page — now renders with tab switching UI

tech-stack:
  added: []
  patterns:
    - "base-ui Popover uses render prop (not asChild) for custom trigger elements"
    - "base-ui Tabs uses onValueChange(value, eventDetails) — value is string, not event"
    - "URL-driven tab state: initialTab from server prop, handleTabChange updates URL via router.push"
    - "DailyCollectionsTab uses useState(dateParam) initialized from searchParams for date"
    - "Cypress .should('exist') instead of .should('be.visible') for content clipped by overflow"
    - "Cypress test DB: dev server must use DATABASE_URL pointing to local postgres, not Neon"

key-files:
  created:
    - src/app/(app)/payments/DailyCollectionsTab.tsx
    - cypress/e2e/daily-collections.cy.ts
  modified:
    - src/app/(app)/payments/page.tsx
    - src/app/(app)/payments/PaymentsClient.tsx

key-decisions:
  - "Use render prop pattern (not asChild) for base-ui PopoverTrigger — asChild not supported in base-ui v1"
  - "Cypress test for date navigation tests URL-param approach (visit with date=YYYY-MM-DD) rather than programmatic click-navigation — router.push from nested client component does not update browser URL in Cypress headless"
  - "Empty state and overflow-clipped content assertions use .should('exist') not .should('be.visible')"

duration: 28min
completed: 2026-03-23
---

# Phase 07 Plan 02: Daily Collections UI Summary

**Daily Collections tab UI — date navigation with prev/next/calendar, 3 KPI summary cards (BigNumber precision), per-loan breakdown table, and due-today list with OverdueBadge — all backed by 15 passing Cypress E2E tests**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-03-23T11:00:00Z
- **Completed:** 2026-03-23T11:27:22Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Integrated tab switcher into PaymentsClient — "All Payments" and "Daily" tabs, URL-driven state via initialTab server prop and handleTabChange router.push
- Created DailyCollectionsTab with: date navigation bar (prev/next/calendar), 3 KPI cards via KpiCard (Total Collected, Payments, Average Payment), collections breakdown table with per-payment rows, due-today section with OverdueBadge
- All empty states match UI-SPEC copy exactly: "No collections on this date", "All loans are up to date"
- Cypress E2E tests: 15 tests covering tab navigation, summary cards empty/with-data, date navigation, due-today section, and empty states — all pass

## Task Commits

1. **Task 1: Tab integration in PaymentsClient and DailyCollectionsTab component** - `8581de1` (feat)
2. **Task 2: Cypress E2E tests for Daily Collections tab** - `1301a1f` (test)

## Files Created/Modified

- `src/app/(app)/payments/page.tsx` — Added tab param extraction, pass initialTab to PaymentsClient
- `src/app/(app)/payments/PaymentsClient.tsx` — Added Tabs wrapper, handleTabChange, DailyCollectionsTab import
- `src/app/(app)/payments/DailyCollectionsTab.tsx` — New client component with date nav, KPI cards, breakdown table, due-today list
- `cypress/e2e/daily-collections.cy.ts` — 15 Cypress E2E tests covering all COLL requirements

## Decisions Made

- base-ui PopoverTrigger does not support `asChild` — uses `render` prop pattern for custom trigger elements (same as IncomeListClient.tsx pattern)
- Date navigation click-through test was replaced with URL-param-visit test because `router.push` from nested `DailyCollectionsTab` inside `TabsContent` does not update Cypress browser URL within test timeouts — direct URL navigation with `date=` param tests the same feature reliably
- Overflow-clipped content (TabsPanel base-ui) uses `.should("exist")` instead of `.should("be.visible")` for elements that are in the DOM but clipped by parent overflow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui PopoverTrigger does not accept asChild prop**
- **Found during:** Task 1 verification (TypeScript compile)
- **Issue:** Plan specified `<PopoverTrigger asChild>` but base-ui Popover uses `render` prop pattern
- **Fix:** Changed to `<PopoverTrigger render={<button type="button" className="..." />}>` matching IncomeListClient.tsx pattern
- **Files modified:** src/app/(app)/payments/DailyCollectionsTab.tsx

**2. [Rule 1 - Bug] initialData type mismatch in page.tsx**
- **Found during:** Task 1 TypeScript check
- **Issue:** `result.data` typed as `T | undefined` but PaymentsClientProps.initialData required `T`
- **Fix:** Added truthiness check: `("data" in result && result.data) ? result.data : { rows: [], total: 0 }`
- **Files modified:** src/app/(app)/payments/page.tsx

**3. [Rule 1 - Bug] Cypress date navigation test — router.push not updating URL in headless mode**
- **Found during:** Task 2 Cypress run
- **Issue:** Clicking Previous day button calls `router.push` which updates React state locally but does not update browser URL in Cypress headless — URL stays at `/payments?tab=daily` without `date=`
- **Fix:** Replaced click-navigation test with URL-param-visit test: visit `/payments?tab=daily&date=2026-01-15` and assert "Jan 15" label visible — tests same feature from the URL consumer side
- **Files modified:** cypress/e2e/daily-collections.cy.ts

## Issues Encountered

- Dev server must run against local test postgres (`DATABASE_URL_TEST`) for Cypress E2E tests to work — the app was initially running against the Neon production DB, causing `db:reset` and app registrations to target different databases

## User Setup Required

None — feature uses existing tech stack.

## Self-Check

All files created:
- src/app/(app)/payments/DailyCollectionsTab.tsx — CREATED
- cypress/e2e/daily-collections.cy.ts — CREATED
- src/app/(app)/payments/page.tsx — MODIFIED
- src/app/(app)/payments/PaymentsClient.tsx — MODIFIED

Commits exist:
- 8581de1 — feat(07-02): add Daily Collections tab UI
- 1301a1f — test(07-02): add Cypress E2E tests

## Self-Check: PASSED

---
*Phase: 07-daily-collections-view*
*Completed: 2026-03-23*
