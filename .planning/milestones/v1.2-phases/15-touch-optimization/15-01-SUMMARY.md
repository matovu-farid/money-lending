---
phase: 15-touch-optimization
plan: 01
subsystem: ui-components
tags: [touch-targets, wcag, accessibility, drawer, dialog, responsive]
dependency_graph:
  requires: []
  provides: [DrawerDialog, DrawerDialogContent, touch-target-button-variants]
  affects: [src/components/ui/button.tsx, src/components/ui/drawer-dialog.tsx]
tech_stack:
  added: []
  patterns:
    - "min-h-[44px] min-w-[44px] md:min-h-* md:min-w-* for WCAG 2.5.8 touch targets on mobile only"
    - "useMediaQuery from @base-ui/react/unstable-use-media-query for SSR-safe desktop/mobile split"
    - "DrawerDialog: Dialog on desktop (md+), Drawer.Root on mobile"
    - "DrawerDialogContent: DialogContent on desktop, Drawer.Popup bottom sheet on mobile"
key_files:
  created:
    - src/components/ui/drawer-dialog.tsx
  modified:
    - src/components/ui/button.tsx
    - src/components/ui/filter-panel.tsx
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/payments/PaymentsClient.tsx
decisions:
  - "defaultMatches:true on useMediaQuery assumes desktop at SSR — avoids bottom-drawer flash on desktop first paint"
  - "onOpenChange wrapper (o) => onOpenChange(o) in Drawer.Root normalizes two-arg Drawer callback to single-arg"
  - "xs, sm, icon-xs Button variants NOT updated — desktop-only contexts per research"
  - "DrawerDialogContentProps uses [key: string]: unknown index signature for safe ...props spread"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-25"
  tasks_completed: 2
  files_modified: 6
---

# Phase 15 Plan 01: Touch Targets and DrawerDialog Foundation Summary

**One-liner:** WCAG 2.5.8 44px mobile touch targets on Button/DropdownMenuTrigger/FilterPanel plus new DrawerDialog responsive wrapper using @base-ui/react/drawer.

## What Was Built

### Task 1: 44px Mobile Touch Targets (commit 0aee20e)

Updated `buttonVariants` cva in `button.tsx` to add mobile touch-target classes to five size variants:

- `default`: added `min-h-[44px] md:min-h-0`
- `lg`: added `min-h-[44px] md:min-h-0`
- `icon`: added `min-h-[44px] min-w-[44px] md:min-h-8 md:min-w-8`
- `icon-sm`: added `min-h-[44px] min-w-[44px] md:min-h-7 md:min-w-7`
- `icon-lg`: added `min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9`

The `xs`, `sm`, and `icon-xs` variants were NOT changed — these are desktop-only contexts (pagination, filter bars, table headers).

Updated three `DropdownMenuTrigger` call sites in table action menus with `min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0`:
- `src/app/(app)/loans/page.tsx`
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- `src/app/(app)/payments/PaymentsClient.tsx`

Updated `filter-panel.tsx` toggle button (mobile-only, already `md:hidden`) with `min-h-[44px]`.

### Task 2: DrawerDialog Component (commit 909a864)

Created `src/components/ui/drawer-dialog.tsx` with two exports:

**DrawerDialog** — root wrapper that renders:
- Desktop (md+): `<Dialog open={open} onOpenChange={onOpenChange}>` from @base-ui/react/dialog
- Mobile: `<Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)} swipeDirection="down">` from @base-ui/react/drawer

**DrawerDialogContent** — content wrapper that renders:
- Desktop: `<DialogContent className={className} showCloseButton={showCloseButton} {...props}>`
- Mobile: `<Drawer.Portal>` + `<Drawer.Popup data-slot="drawer-dialog-content">` with drag handle, close button, `max-h-[90dvh] overflow-y-auto`

Both components use `useMediaQuery("(min-width: 768px)", { defaultMatches: true })` from `@base-ui/react/unstable-use-media-query` for SSR-safe breakpoint detection.

Callers import `DialogHeader`, `DialogTitle`, `DialogFooter`, `DialogDescription` from `@/components/ui/dialog` unchanged — these are plain div wrappers that work inside either content renderer.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit` passes with zero errors in modified/created files (pre-existing test file errors in `permissions.test.ts`, `pdf.service.test.ts`, `transaction.service.test.ts` are unrelated and pre-existing)
- `grep -c "min-h-\[44px\]" src/components/ui/button.tsx` returns 5 (default, lg, icon, icon-sm, icon-lg)
- `grep "data-slot=\"drawer-dialog-content\""` confirms mobile markup in drawer-dialog.tsx
- Both `DrawerDialog` and `DrawerDialogContent` exported from drawer-dialog.tsx

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1: 44px touch targets | 0aee20e | button.tsx, filter-panel.tsx, loans/page.tsx, loan-detail-client.tsx, PaymentsClient.tsx |
| 2: DrawerDialog component | 909a864 | src/components/ui/drawer-dialog.tsx (new) |

## Self-Check: PASSED
