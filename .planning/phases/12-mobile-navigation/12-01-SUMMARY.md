---
phase: 12-mobile-navigation
plan: "01"
subsystem: layout
tags: [mobile, navigation, bottom-tab-bar, drawer, safe-area]
dependency_graph:
  requires: []
  provides: [bottom-tab-bar, more-sheet, app-shell-mobile-nav]
  affects: [src/app/layout.tsx, src/components/layout/app-shell.tsx, src/components/layout/top-bar.tsx]
tech_stack:
  added: ["@base-ui/react Drawer (for MoreSheet)"]
  patterns: ["CSS-only show/hide (flex md:hidden / hidden md:flex)", "env(safe-area-inset-bottom) for iPhone notch support", "pb-[calc(3.5rem+env(...))] to clear fixed bottom tab bar"]
key_files:
  created:
    - src/components/layout/bottom-tab-bar.tsx
    - src/components/layout/more-sheet.tsx
  modified:
    - src/components/layout/app-shell.tsx
    - src/components/layout/top-bar.tsx
    - src/app/layout.tsx
decisions:
  - "CSS-only responsive show/hide: BottomTabBar has className='flex md:hidden' — no JS viewport detection, avoids hydration mismatch"
  - "MoreSheet uses @base-ui/react Drawer with swipeDirection=down matching the UI-SPEC pattern"
  - "Main content gets pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-6 to prevent content hiding behind fixed tab bar"
  - "viewport export added to layout.tsx with viewportFit cover for iPhone safe-area support"
metrics:
  duration: "138 seconds"
  completed_date: "2026-03-25"
  tasks_completed: 2
  files_changed: 5
---

# Phase 12 Plan 01: Mobile Bottom Tab Bar Summary

**One-liner:** Bottom tab bar with 5 primary tabs + @base-ui/react Drawer for secondary nav, replacing the hamburger-Sheet mobile sidebar pattern.

## What Was Built

Two new layout components and updates to three existing files:

- **BottomTabBar** (`src/components/layout/bottom-tab-bar.tsx`): Fixed bottom nav bar with 5 primary tabs (Dashboard, Customers, Payments, Loans, More). Uses `usePathname` for active detection, renders an active indicator line per tab, and applies `pb-[env(safe-area-inset-bottom)]` for iPhone home indicator clearance.

- **MoreSheet** (`src/components/layout/more-sheet.tsx`): Slide-up @base-ui/react Drawer with 5 secondary nav items (Creditors, Expenses, Income, Reports, Watchlist). Supports swipe-to-dismiss with `swipeDirection="down"` and auto-closes on item tap.

- **AppShell** (`src/components/layout/app-shell.tsx`): Replaced Sheet/hamburger mobile sidebar with BottomTabBar + MoreSheet. Uses CSS-only `flex md:hidden` for mobile-only visibility. Added bottom padding on main content to clear the fixed tab bar.

- **TopBar** (`src/components/layout/top-bar.tsx`): Removed `onMenuClick` prop, hamburger button, `Menu` icon import, and `Button` import. Now a stateless component.

- **layout.tsx** (`src/app/layout.tsx`): Added `viewport` export with `viewportFit: "cover"` for iPhone safe-area CSS variable support.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] `src/components/layout/bottom-tab-bar.tsx` exists
- [x] `src/components/layout/more-sheet.tsx` exists
- [x] `src/components/layout/app-shell.tsx` updated (no Sheet/SheetContent imports)
- [x] `src/components/layout/top-bar.tsx` updated (no onMenuClick, no hamburger)
- [x] `src/app/layout.tsx` updated (viewport export with viewportFit cover)
- [x] Commit `2a7e553`: feat(12-01): create BottomTabBar and MoreSheet components
- [x] Commit `916d9c6`: feat(12-01): wire BottomTabBar/MoreSheet into AppShell, clean up TopBar, add viewport
- [x] Zero TypeScript errors in all new/modified source files (pre-existing test file errors unrelated to this plan)
