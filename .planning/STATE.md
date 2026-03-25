---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Responsive
status: unknown
stopped_at: Completed 15-01-PLAN.md
last_updated: "2026-03-25T15:37:45.205Z"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 10
  completed_plans: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-24)

**Core value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.
**Current focus:** Phase 15 — touch-optimization

## Current Position

Phase: 15 (touch-optimization) — EXECUTING
Plan: 1 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 2 (v1.2)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

*Updated after each plan completion*
| Phase 11-test-selector-foundation P01 | 25 | 2 tasks | 18 files |
| Phase 11-test-selector-foundation P02 | 56 | 2 tasks | 22 files |
| Phase 12-mobile-navigation P01 | 138s | 2 tasks | 5 files |
| Phase 12-mobile-navigation P02 | 51 | 2 tasks | 5 files |
| Phase 13 P01 | 932 | 3 tasks | 9 files |
| Phase 13 P02 | 48 | 3 tasks | 6 files |
| Phase 14-forms-filters-table-polish P01 | 226 | 2 tasks | 4 files |
| Phase 14-forms-filters-table-polish P02 | 54 | 2 tasks | 2 files |
| Phase 15-touch-optimization P01 | 8 | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key decisions affecting v1.2:

- CSS-only show/hide for responsive table/card switch (no JS viewport detection — avoids hydration mismatch)
- `data-testid` scoping must happen before any second `<nav>` element enters the DOM
- BottomTabBar lives in AppShell (not layout.tsx) — only place where useSession + usePathname are available
- Global Cypress viewport must NOT be changed — mobile tests use scoped `cy.viewport()` in beforeEach
- DrawerDialog @base-ui/react compatibility needs verification task at Phase 15 start
- [Phase 11-test-selector-foundation]: Skeleton/loading placeholder rows do not get data-testid='data-row' — they are not real data and have no stable identity
- [Phase 11-test-selector-foundation]: data-testid scope extended to all app TableBody rows (15 files), not just the 5 listed in plan, per plan's own instruction
- [Phase 11-02]: Only page-level wrapper divs updated; card interior bg-card p-6 preserved (Phase 13 concern); receipt pages print:p-0 preserved
- [Phase 12-mobile-navigation]: CSS-only show/hide for BottomTabBar (flex md:hidden) — no JS viewport detection, avoids hydration mismatch
- [Phase 12-mobile-navigation]: viewport export with viewportFit cover added to layout.tsx for iPhone safe-area CSS variable support
- [Phase 12-mobile-navigation]: Replace pb-[env(safe-area-inset-bottom)] with safe-area-bottom CSS custom property class — Tailwind v4 generates invalid env(...) hint CSS when scanning .planning/ markdown files with env() arbitrary values
- [Phase 12-mobile-navigation]: Add @source not directives to globals.css to exclude .planning/, cypress/, and **/*.md from Tailwind v4 scanning to prevent markdown class name strings from being compiled as CSS utilities
- [Phase 13-01]: Creditors server component passes data to CreditorsTable client component — render functions cannot cross Next.js server/client boundary
- [Phase 13-01]: RowProps extends HTMLAttributes with [key: string]: unknown index signature to allow data-* attributes in TypeScript
- [Phase 13-01]: Cypress filter(':visible') required in mobile assertions to distinguish card data-row divs from hidden desktop tr data-rows sharing same data-testid
- [Phase 13]: hideInCard: true on Payments interest/principal portion columns — mobile cards show Amount and Balance After only
- [Phase 13]: payments-list.cy.ts visibility assertions updated to filter(':visible') pattern after ResponsiveTable introduced dual DOM elements
- [Phase 14-01]: CSS-only desktop open state for FilterPanel: md:!block on Collapsible.Panel avoids hydration mismatch — consistent with Phase 12/13 CSS-only pattern
- [Phase 14-01]: sticky TableHead applied in responsive-table.tsx at call site, not table.tsx base — only desktop scrollable context needs sticky headers
- [Phase 14-02]: Replaced @base-ui/react Collapsible with plain CSS button+div for FilterPanel: base-ui's hidden HTML attribute on Collapsible.Panel blocks CSS \!important overrides; plain CSS block/hidden toggle with md:\!block is reliable and SSR-safe
- [Phase 15-touch-optimization]: useMediaQuery defaultMatches:true for DrawerDialog — assumes desktop on SSR to avoid bottom-drawer flash on desktop first paint
- [Phase 15-touch-optimization]: xs, sm, icon-xs Button variants NOT given touch targets — desktop-only contexts per research

### Blockers/Concerns

- [v1.0]: Effect.js services close over module-scope db — full Context.Tag/Layer DI deferred
- [v1.2 Phase 15]: DrawerDialog (shadcn Drawer / Vaul) compatibility with @base-ui/react unverified — resolve at Phase 15 start

## Session Continuity

Last session: 2026-03-25T15:37:45.203Z
Stopped at: Completed 15-01-PLAN.md
Resume file: None
