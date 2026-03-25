---
phase: 13-responsive-table-primitive-card-layouts
plan: 01
subsystem: ui
tags: [responsive, tailwind, css-only, table, card-layout, cypress]

requires:
  - phase: 12-mobile-navigation
    provides: CSS-only show/hide pattern (flex md:hidden), md breakpoint convention, safe-area CSS, BottomTabBar

provides:
  - ResponsiveTable<T> generic primitive at src/components/ui/responsive-table.tsx
  - CSS-only dual table/card rendering via hidden md:block / md:hidden
  - Column<T> type with primary, hideInCard, align, cardLabel fields
  - Customers, Creditors, Watchlist pages migrated to ResponsiveTable
  - Dashboard KPI grid using md:grid-cols-2 breakpoint
  - Cypress E2E tests for responsive layouts at 390px and 1280px

affects:
  - 13-02 (Loans, Payments, Expenses, Income pages — uses same ResponsiveTable primitive)
  - Any future list page needing responsive table/card layout

tech-stack:
  added: []
  patterns:
    - "ResponsiveTable<T> primitive with Column<T> type for CSS-only responsive dual rendering"
    - "Server components pass array data to CreditorsTable client component — render functions cannot cross server/client boundary"
    - "getRowProps forwards className via cn() for optimistic update styling on mobile cards"
    - "cy.get('[data-testid=data-row]').filter(':visible') to distinguish mobile cards from hidden desktop rows"

key-files:
  created:
    - src/components/ui/responsive-table.tsx
    - src/app/(app)/creditors/creditors-table.tsx
    - cypress/e2e/responsive-layouts.cy.ts
  modified:
    - src/app/(app)/customers/page.tsx
    - src/app/(app)/creditors/page.tsx
    - src/app/(app)/watchlist/page.tsx
    - src/app/(app)/dashboard/page.tsx

key-decisions:
  - "Creditors page (server component) passes data to CreditorsTable (client component) — render functions cannot be passed across the Next.js server/client boundary"
  - "RowProps type extended with [key: string]: unknown index signature to allow data-* attributes without TypeScript error"
  - "Desktop table wrapped in div.hidden.md:block (not hidden md:table on table element) per RESEARCH.md Pattern 5"
  - "Mobile card list uses md:hidden space-y-2 — 8px gap between cards per UI-SPEC"
  - "Cypress tests use filter(':visible') to distinguish mobile card data-row divs from hidden desktop tr data-rows"

patterns-established:
  - "Pattern: For server component pages using ResponsiveTable, extract column definitions into a *Table client component"
  - "Pattern: getRowProps passes both data-testid and className; cn() merges className in card div"
  - "Pattern: Actions column uses flex justify-between items-center in card primary row"

requirements-completed: [RESP-01, RESP-02, RESP-07]

duration: 16min
completed: 2026-03-25
---

# Phase 13 Plan 01: Responsive Table Primitive + Card Layouts Summary

**Generic ResponsiveTable<T> CSS-only primitive rendering dual desktop-table/mobile-card layout, wired into Customers, Creditors, Watchlist pages and Dashboard KPI grid breakpoint fix**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-25T06:24:36Z
- **Completed:** 2026-03-25T06:40:08Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- `ResponsiveTable<T>` primitive: generic component with `Column<T>` type, CSS-only dual rendering, `data-testid="data-row"` on both table rows and card divs, `className` forwarding via `cn()` for optimistic updates, actions column header-row pattern
- Customers, Creditors, Watchlist pages migrated from direct `<Table>` usage to `ResponsiveTable`
- Dashboard and Creditors KPI grids updated from `sm:grid-cols-2` to `md:grid-cols-2` for consistent mobile breakpoint
- 8 Cypress E2E tests passing at both 390x844 (mobile) and 1280x800 (desktop) viewports

## Task Commits

1. **Task 1: Create ResponsiveTable primitive** - `230431f` (feat)
2. **Task 2: Wire pages + Dashboard grid fix** - `d4cda3f` (feat)
3. **Task 3: Cypress E2E tests + creditors server/client fix** - `8e4ff87` (feat)

## Files Created/Modified

- `src/components/ui/responsive-table.tsx` - Generic ResponsiveTable<T> primitive with Column<T> type, dual desktop/mobile rendering
- `src/app/(app)/creditors/creditors-table.tsx` - Client component wrapper for creditors table (server/client boundary fix)
- `cypress/e2e/responsive-layouts.cy.ts` - E2E tests for responsive layouts at mobile and desktop viewports
- `src/app/(app)/customers/page.tsx` - Migrated to ResponsiveTable
- `src/app/(app)/creditors/page.tsx` - Migrated to CreditorsTable, KPI grid md:grid-cols-2
- `src/app/(app)/watchlist/page.tsx` - Migrated to ResponsiveTable, loading skeleton desktop-only
- `src/app/(app)/dashboard/page.tsx` - KPI grid sm:grid-cols-2 → md:grid-cols-2

## Decisions Made

- `RowProps` type in `ResponsiveTable` uses `[key: string]: unknown` index signature to allow `data-*` attributes alongside standard `HTMLAttributes<HTMLElement>` — this is the minimal change needed for TypeScript compatibility
- Creditors server component cannot pass `render` functions to `ResponsiveTable` directly across the server/client boundary — extracted `CreditorsTable` as a separate `"use client"` component to hold the column definitions and accept data as plain serializable props

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted CreditorsTable client component to fix Next.js server/client boundary error**
- **Found during:** Task 3 (Cypress E2E tests for responsive layouts)
- **Issue:** Creditors page is a server component (`async function CreditorsPage`). Passing `render` function callbacks inline to `ResponsiveTable` (a `"use client"` component) caused a Next.js runtime error: "Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with 'use server'". The page showed an error overlay instead of the creditors list.
- **Fix:** Created `src/app/(app)/creditors/creditors-table.tsx` with `"use client"` directive. Moved column definitions and `ResponsiveTable` usage into this component. `CreditorsPage` passes the serializable `creditors` array as a prop.
- **Files modified:** `src/app/(app)/creditors/creditors-table.tsx` (created), `src/app/(app)/creditors/page.tsx` (updated to use CreditorsTable)
- **Verification:** Cypress creditors tests pass (both mobile card and desktop table assertions)
- **Committed in:** `8e4ff87` (Task 3 commit)

**2. [Rule 1 - Bug] Added [key: string]: unknown to RowProps for data-* attribute TypeScript compatibility**
- **Found during:** Task 2 (wiring pages)
- **Issue:** `getRowProps` return type was `React.HTMLAttributes<HTMLElement>` which doesn't include `data-*` attributes in TypeScript's structural type checking. `{ "data-testid": string }` was not assignable to `HTMLAttributes<HTMLElement>`.
- **Fix:** Added `RowProps = React.HTMLAttributes<HTMLElement> & { [key: string]: unknown }` exported type in `responsive-table.tsx`
- **Files modified:** `src/components/ui/responsive-table.tsx`
- **Verification:** TypeScript compiles without errors on all modified files
- **Committed in:** `d4cda3f` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes essential for correctness. The server/client boundary fix is a known pitfall documented in RESEARCH.md (Pitfall 3) that the plan didn't account for in implementation. No scope creep.

## Issues Encountered

- Cypress `cy.get("[data-testid='data-row']")` at mobile viewport matched the `<tr>` elements in the hidden desktop div (which are in DOM but not visible) before the card divs. Fixed by using `.filter(":visible")` in mobile assertions.
- Creditors form requires `amount` field in addition to name/contact/address — initial test omitted it, causing validation failure with no redirect.

## Next Phase Readiness

- `ResponsiveTable` primitive and `Column<T>` type are ready for Plan 02 (Loans, Payments, Expenses, Income pages)
- Pattern established: server component pages with function-passing columns need a `*Table` client component wrapper
- Pattern established: `filter(':visible')` required in Cypress when both `<tr>` and card `<div>` share `data-testid="data-row"`

---
*Phase: 13-responsive-table-primitive-card-layouts*
*Completed: 2026-03-25*
