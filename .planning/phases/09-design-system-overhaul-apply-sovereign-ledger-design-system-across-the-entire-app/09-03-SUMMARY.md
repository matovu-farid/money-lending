---
phase: 09-design-system-overhaul
plan: "03"
subsystem: layout-chrome
tags: [design-system, no-line-rule, tonal-separation, sidebar, top-bar, app-shell]
dependency_graph:
  requires: ["09-02"]
  provides: ["border-free-sidebar", "border-free-top-bar", "explicit-surface-tier"]
  affects: ["src/components/layout/"]
tech_stack:
  added: []
  patterns: ["tonal-separation-via-bg-tokens", "spatial-dividers-instead-of-separator"]
key_files:
  created: []
  modified:
    - src/components/layout/sidebar.tsx
    - src/components/layout/top-bar.tsx
    - src/components/layout/app-shell.tsx
    - cypress/e2e/design-system.cy.ts
decisions:
  - "Separator component replaced with <div className='my-2' /> in collapsed nav — spatial separation over visual lines"
  - "bg-background added explicitly to app-shell main — documents surface tier intent, not just inheritance"
  - "Plan 03 border-removal Cypress tests enabled from it.skip to it — both assertions pass (0px border-right, 0px border-bottom)"
metrics:
  duration: "7min"
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_modified: 4
---

# Phase 09 Plan 03: Layout Chrome Border Removal Summary

Border-free sidebar (tonal separation via oklch 0.96 vs 0.98) and border-free top-bar, with explicit bg-background on the app-shell content area, completing the No-Line Rule for all layout chrome components.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Remove borders from Sidebar and TopBar | 7052e8b | sidebar.tsx, top-bar.tsx |
| 2 | Update AppShell content area surface + enable tests | 044d93f | app-shell.tsx, design-system.cy.ts |

## What Was Built

### sidebar.tsx
- Removed `border-r border-sidebar-border` from the `<aside>` element
- Removed `border-b border-sidebar-border` from the collapse toggle container
- Removed `border-t border-sidebar-border` from the user section container
- Replaced `<Separator className="mx-2 my-1 bg-sidebar-border" />` with `<div className="my-2" />` for collapsed nav group spacing
- Removed unused `Separator` import from `@/components/ui/separator`

### top-bar.tsx
- Removed `border-b` from the `<header>` element className

### app-shell.tsx
- Added `bg-background` to `<main>` element to explicitly document the base surface tier (oklch 0.98 — "the desk")

### cypress/e2e/design-system.cy.ts
- Enabled "sidebar aside has no visible border-right" test (was `it.skip`)
- Enabled "top-bar header has no visible border-bottom" test (was `it.skip`)
- Both tests pass: computed borderRightWidth = 0, computed borderBottomWidth = 0

## Verification Results

```
dashboard.cy.ts      — 6/6 passing
design-system.cy.ts  — 12/12 passing (1 pending = Plan 04 typography test, correctly still skipped)
```

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

1. **Separator → spatial div:** The `<Separator>` component rendered a visible 1px horizontal rule between collapsed nav groups, violating the No-Line Rule. Replaced with `<div className="my-2" />` which provides spatial breathing room without a visible stroke.

2. **Explicit bg-background on main:** The content area already inherits `bg-background` from the body, but adding it explicitly makes the surface tier hierarchy self-documenting and prevents accidental overrides from parent wrappers.

3. **Test comments cleaned up:** The `it.skip` comment prefix "enable after Plan 03" was removed with the tests so the test descriptions are clean (`"sidebar aside has no visible border-right"` instead of `"enable after Plan 03 — sidebar aside..."`).

## Self-Check: PASSED

- sidebar.tsx: FOUND
- top-bar.tsx: FOUND
- app-shell.tsx: FOUND
- commit 7052e8b: FOUND
- commit 044d93f: FOUND
