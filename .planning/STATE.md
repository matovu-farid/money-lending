---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Responsive
status: unknown
stopped_at: Completed 11-test-selector-foundation-01-PLAN.md
last_updated: "2026-03-24T21:15:12.752Z"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-24)

**Core value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.
**Current focus:** Phase 11 — test-selector-foundation

## Current Position

Phase: 11 (test-selector-foundation) — EXECUTING
Plan: 1 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.2)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

*Updated after each plan completion*
| Phase 11-test-selector-foundation P01 | 25 | 2 tasks | 18 files |

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

### Blockers/Concerns

- [v1.0]: Effect.js services close over module-scope db — full Context.Tag/Layer DI deferred
- [v1.2 Phase 15]: DrawerDialog (shadcn Drawer / Vaul) compatibility with @base-ui/react unverified — resolve at Phase 15 start

## Session Continuity

Last session: 2026-03-24T21:15:12.750Z
Stopped at: Completed 11-test-selector-foundation-01-PLAN.md
Resume file: None
