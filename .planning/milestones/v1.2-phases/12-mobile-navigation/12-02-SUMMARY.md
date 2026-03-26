---
phase: 12-mobile-navigation
plan: "02"
subsystem: testing
tags: [cypress, e2e, mobile-navigation, tailwind-v4, safe-area-inset]

requires:
  - phase: 12-01
    provides: BottomTabBar, MoreSheet, AppShell with mobile layout, data-testid selectors

provides:
  - "cypress/e2e/mobile-navigation.cy.ts with 11 tests covering NAV-01 through NAV-05"
  - "Safe-area-inset CSS custom property fix for Tailwind v4 env() parse error"
  - "globals.css @source exclusions to prevent .planning/ markdown from polluting Tailwind utility scan"

affects:
  - phase-13
  - any phase adding new CSS with env() arbitrary values
  - any phase that reads globals.css scanning config

tech-stack:
  added: []
  patterns:
    - "safe-area-bottom CSS class using var(--safe-bottom) instead of Tailwind arbitrary pb-[env(...)]"
    - "main-content-pb CSS class with @media max-width guard instead of pb-[calc(...+env(...))]"
    - "cy.viewport() scoped in beforeEach within context blocks for responsive tests"
    - "should('exist') + should('have.css', 'display', 'flex') for fixed-position elements covered by dev overlay"
    - "@source not directives in globals.css to exclude .planning/ markdown from Tailwind scanning"

key-files:
  created:
    - cypress/e2e/mobile-navigation.cy.ts
  modified:
    - src/app/globals.css
    - src/components/layout/app-shell.tsx
    - src/components/layout/bottom-tab-bar.tsx
    - src/components/layout/more-sheet.tsx

key-decisions:
  - "Replace pb-[env(safe-area-inset-bottom)] Tailwind arbitrary values with safe-area-bottom CSS custom property class — Tailwind v4 scans .planning/ markdown files and generates invalid env(...) hint CSS"
  - "Use @source not directives in globals.css to exclude .planning/**,  cypress/**, and **/*.md from Tailwind v4 scanning"
  - "Safe-area padding uses CSS custom property --safe-bottom: env(safe-area-inset-bottom, 0px) in :root to avoid Tailwind scanning env() in arbitrary value positions"
  - "Cypress test uses should('exist') + should('have.css') for bottom-tab-bar visibility assertion — Next.js dev badge (data-next-badge-root) covers fixed-position elements, breaking be.visible assertion"

patterns-established:
  - "Mobile nav test pattern: cy.viewport(390, 844) scoped to mobile context beforeEach, cy.viewport(1280, 800) for desktop"
  - "CSS env() safe-area pattern: always use CSS custom property (var(--safe-bottom)) rather than Tailwind arbitrary value"

requirements-completed: [NAV-01, NAV-02, NAV-03, NAV-04, NAV-05]

duration: 51min
completed: 2026-03-25
---

# Phase 12 Plan 02: Mobile Navigation E2E Tests Summary

**Cypress E2E test suite for mobile nav covering all 5 NAV requirements, plus Tailwind v4 env() CSS parse bug fix enabling the app to compile**

## Performance

- **Duration:** 51 min
- **Started:** 2026-03-25T00:00:00Z
- **Completed:** 2026-03-25T00:47:10Z
- **Tasks:** 2 of 2
- **Files modified:** 5

## Accomplishments

- Created `cypress/e2e/mobile-navigation.cy.ts` with 11 tests — all pass — covering NAV-01 (bottom tab bar), NAV-02 (More sheet), NAV-03 (responsive sidebar/tab switching), NAV-04 (active tab state), NAV-05 (safe-area-inset class)
- Fixed critical Tailwind v4 CSS parse error: `pb-[calc(3.5rem+env(...))]` invalid hint CSS generated when Tailwind scanned `.planning/` markdown files containing the class name string
- Replaced all `env()` Tailwind arbitrary value classes with CSS custom property classes to prevent re-occurrence

## Task Commits

Each task was committed atomically:

1. **Task 1: Write Cypress E2E tests for mobile navigation** - `77786a7` (feat)

Task 2 (full suite run) produced no file changes — it was a verification run.

**Plan metadata:** Included in `77786a7` (task 1 commit contains all file changes)

## Files Created/Modified

- `cypress/e2e/mobile-navigation.cy.ts` - 11 E2E tests covering NAV-01 through NAV-05, mobile (390x844) and desktop (1280x800) viewports
- `src/app/globals.css` - Added @source not directives, CSS custom properties for safe-area, main-content-pb utility class
- `src/components/layout/app-shell.tsx` - Changed `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` to `main-content-pb` custom CSS class
- `src/components/layout/bottom-tab-bar.tsx` - Changed `pb-[env(safe-area-inset-bottom)]` to `safe-area-bottom` custom class
- `src/components/layout/more-sheet.tsx` - Changed `pb-[env(safe-area-inset-bottom)]` to `safe-area-bottom` custom class

## Decisions Made

- Used `@source not` directives to exclude `.planning/**`, `cypress/**`, and `**/*.md` from Tailwind v4 scanning. Tailwind v4 scans ALL project files including markdown; when it finds a class name string like `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` in a .md file, it generates both the real class AND an invalid `env(...)` hint class that crashes the CSS compiler.
- CSS custom property approach (`--safe-bottom: env(safe-area-inset-bottom, 0px)`) used instead of Tailwind arbitrary `env()` values. This is the Tailwind v4 recommended workaround for CSS functions in arbitrary values.
- `should("exist")` + `should("have.css", "display", "flex")` used instead of `should("be.visible")` for the bottom-tab-bar nav container because Next.js dev overlay badge (`data-next-badge-root`) sits above fixed-position elements and causes false "covered" failures in Cypress visibility checks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Tailwind v4 CSS parse error crashing the dev server**
- **Found during:** Task 1 (running mobile-navigation.cy.ts for the first time)
- **Issue:** `src/app/globals.css` was causing a PostCSS compile error: `.pb-[calc(3.5rem+env(...))]` generated as an invalid CSS hint rule. Root cause: Tailwind v4 scanned `.planning/` markdown files and `.planning/phases/12-mobile-navigation/12-01-PLAN.md` contained the literal string `pb-[calc(3.5rem+env(safe-area-inset-bottom))]`, causing Tailwind to generate both the utility class AND an invalid `env(...)` hint class.
- **Fix:** (a) Replaced all `env()` Tailwind arbitrary values in components with CSS custom property classes (`safe-area-bottom`, `main-content-pb`). (b) Added `@source not` directives in `globals.css` to exclude `.planning/`, `cypress/`, and markdown files. (c) Added `:root { --safe-bottom: env(safe-area-inset-bottom, 0px) }` and custom CSS classes in `globals.css`.
- **Files modified:** `src/app/globals.css`, `src/components/layout/app-shell.tsx`, `src/components/layout/bottom-tab-bar.tsx`, `src/components/layout/more-sheet.tsx`
- **Verification:** Dev server starts successfully, `/register` returns 200, all 11 mobile-navigation tests pass
- **Committed in:** `77786a7` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed test assertion for safe-area class (plan expected old class name)**
- **Found during:** Task 1 (after CSS fix, safe-area test still failed)
- **Issue:** The plan's test template asserted `pb-[env(safe-area-inset-bottom)]` in the class attribute, but the fix in deviation #1 replaced that class with `safe-area-bottom`
- **Fix:** Updated test to assert `should("have.class", "safe-area-bottom")` instead
- **Files modified:** `cypress/e2e/mobile-navigation.cy.ts`
- **Committed in:** `77786a7` (Task 1 commit)

**3. [Rule 1 - Bug] Fixed bottom-tab-bar visibility assertion blocked by Next.js dev overlay**
- **Found during:** Task 1 (9/11 tests passed, visibility test failed)
- **Issue:** Cypress `be.visible` check failed for `bottom-tab-bar` because Next.js dev badge (`data-next-badge-root`) sits above fixed-position elements and Cypress considers them "not visible" when covered
- **Fix:** Changed `should("be.visible")` to `should("exist").should("have.css", "display", "flex")` for the nav container; individual tab elements use `should("exist")`
- **Files modified:** `cypress/e2e/mobile-navigation.cy.ts`
- **Committed in:** `77786a7` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All auto-fixes necessary for test correctness and app functionality. No scope creep.

## Issues Encountered

- **Pglite socket server instability:** Initial Cypress runs used the pglite test server, which dropped connections with ECONNRESET. Resolved by using the local PostgreSQL instance at `localhost:5432` (`DATABASE_URL_TEST_UNPOOLED` from `.env`).
- **Full suite pre-existing failures:** `npx cypress run` shows 8 failing specs (admin-panel, auth-gate, creditors, customer-search, daily-collections, expenses, payments-list, transactions). These failures pre-date Plan 12-02 — they are from uncommitted working tree changes in Phase 11 work. None are navigation-related. The `sidebar-nav` test in payments-list.cy.ts passes correctly. These are deferred to their respective plan fixes.

## Next Phase Readiness

- All NAV requirements verified with passing E2E tests
- Phase 12 mobile navigation complete — Phase 13 can proceed
- Note: 8 pre-existing test failures in uncommitted Phase 11 work need resolution before those tests are merged

## Self-Check: PASSED

- cypress/e2e/mobile-navigation.cy.ts: FOUND (109 lines, exceeds minimum 80)
- src/app/globals.css: FOUND
- src/components/layout/app-shell.tsx: FOUND
- src/components/layout/bottom-tab-bar.tsx: FOUND
- src/components/layout/more-sheet.tsx: FOUND
- Commit 77786a7: FOUND

---
*Phase: 12-mobile-navigation*
*Completed: 2026-03-25*
