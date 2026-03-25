---
phase: 14-forms-filters-table-polish
plan: 01
subsystem: ui
tags: [responsive, tailwind, base-ui, collapsible, sticky-headers, filter-panel]

# Dependency graph
requires:
  - phase: 13-responsive-table
    provides: ResponsiveTable component with desktop/mobile dual rendering
provides:
  - FilterPanel collapsible wrapper component at src/components/ui/filter-panel.tsx
  - Sticky table headers in ResponsiveTable desktop view via CSS
  - Customers and Payments filter bars wrapped in FilterPanel for mobile collapse
affects: [15-mobile-forms, any phase adding filter UI to list pages]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CSS-only mobile collapse via md:!block on Collapsible.Panel (no JS viewport detection)
    - @base-ui/react Collapsible for accessible filter panel toggle
    - sticky top-0 bg-background z-10 on TableHead inside overflow-y-auto container

key-files:
  created:
    - src/components/ui/filter-panel.tsx
  modified:
    - src/components/ui/responsive-table.tsx
    - src/components/customers/customer-search-bar.tsx
    - src/app/(app)/payments/PaymentsClient.tsx

key-decisions:
  - "CSS-only desktop open state: FilterPanel uses md:!block on Collapsible.Panel instead of JS window.matchMedia to avoid hydration mismatch — consistent with Phase 12/13 CSS-only pattern"
  - "sticky TableHead applied in responsive-table.tsx at call site rather than table.tsx base component — only desktop scrollable context should have sticky headers, not standalone table usage"
  - "max-h-[calc(100vh-12rem)] overflow-y-auto on desktop wrapper creates scroll container required for CSS sticky to work"

patterns-established:
  - "Pattern: FilterPanel wrapping — any list page with filters uses <FilterPanel label='Filters' activeCount={n}> to get mobile collapse for free"
  - "Pattern: activeFilterCount as array of boolean conditions filtered to length — consistent across CustomerSearchBar (4 states) and PaymentsClient (5 states)"

requirements-completed: [RESP-04, RESP-05]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 14 Plan 01: FilterPanel and Sticky Headers Summary

**Collapsible FilterPanel component with @base-ui/react and CSS-only desktop override, plus sticky table headers via overflow-y-auto container and sticky top-0 on TableHead**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T10:08:53Z
- **Completed:** 2026-03-25T10:12:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `FilterPanel` component with `@base-ui/react/collapsible` — collapses on mobile, always-visible on desktop via `md:!block`
- Added sticky table headers to `ResponsiveTable` desktop wrapper: `max-h-[calc(100vh-12rem)] overflow-y-auto` container + `sticky top-0 bg-background z-10` on `TableHead`
- Wired `FilterPanel` into `CustomerSearchBar` and `PaymentsClient` with active filter count badges

## Task Commits

1. **Task 1: Create FilterPanel component and add sticky table headers** - `497301c` (feat)
2. **Task 2: Wire FilterPanel into Customers and Payments pages** - `60ac8e1` (feat)

## Files Created/Modified

- `src/components/ui/filter-panel.tsx` - New collapsible filter wrapper using @base-ui/react Collapsible; toggle button hidden on desktop (md:hidden), panel always visible on desktop (md:!block)
- `src/components/ui/responsive-table.tsx` - Desktop wrapper now has max-h and overflow-y-auto; TableHead cells get sticky top-0 bg-background z-10
- `src/components/customers/customer-search-bar.tsx` - Added FilterPanel import, activeFilterCount from 4 filter states, filter div wrapped in FilterPanel
- `src/app/(app)/payments/PaymentsClient.tsx` - Added FilterPanel import, activeFilterCount from 5 filter states, filter bar wrapped in FilterPanel

## Decisions Made

- Used CSS `md:!block` (Tailwind v4 important) on `Collapsible.Panel` to force panel visible on desktop regardless of `open` React state initialised to `false`. This avoids SSR/hydration mismatch from reading `window.matchMedia` at init.
- Applied sticky `TableHead` className at the call site in `responsive-table.tsx`, not in `table.tsx` base component, so sticky behaviour only activates inside the scrollable table context.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm build` fails due to a pre-existing `fflate/lib/node.cjs` dynamic `Worker` import in `jspdf` used by `pdf.service.ts`. This failure exists before and after this plan's changes and is out of scope. Deferred to `deferred-items.md`.
- TypeScript errors in pre-existing test files (`src/lib/__tests__/permissions.test.ts`, `src/services/__tests__/pdf.service.test.ts`) are unrelated to this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FilterPanel is a reusable component ready for any future list page that needs filter UI
- RESP-04 and RESP-05 requirements fulfilled
- Phase 14 Plan 02 can proceed (RESP-03 single-column forms Cypress tests)

---
*Phase: 14-forms-filters-table-polish*
*Completed: 2026-03-25*
