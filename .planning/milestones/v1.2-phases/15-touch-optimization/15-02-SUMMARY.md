---
phase: 15-touch-optimization
plan: 02
subsystem: ui
tags: [cypress, base-ui, drawer, dialog, touch, mobile, responsive]

requires:
  - phase: 15-01
    provides: DrawerDialog/DrawerDialogContent component and 44px touch target CSS

provides:
  - All Dialog/Sheet call sites migrated to DrawerDialog across 9 app files
  - MoreSheet drag handle updated to h-2 w-12 per UI-SPEC
  - Drawer.Viewport added to DrawerDialog and MoreSheet (enables real swipe-to-dismiss)
  - Cypress E2E test suite for TOUCH-01, TOUCH-02, TOUCH-03

affects: [15-03, any phase using Dialog or Sheet components]

tech-stack:
  added: []
  patterns:
    - "TouchEvent dispatch targeting popup coordinates for Base UI drawer swipe simulation in Cypress"
    - "Drawer.Viewport wraps Drawer.Popup to enable swipe-to-dismiss (required by Base UI)"
    - "DrawerDialog migration: swap Dialog+DialogContent import for DrawerDialog+DrawerDialogContent"

key-files:
  created:
    - cypress/e2e/touch-optimization.cy.ts
  modified:
    - src/components/ui/drawer-dialog.tsx
    - src/components/layout/more-sheet.tsx
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/payments/PaymentsClient.tsx
    - src/app/(app)/payments/QuickRecordDialog.tsx
    - src/app/(app)/expenses/ExpenseListClient.tsx
    - src/app/(app)/income/IncomeListClient.tsx
    - src/app/(app)/customers/[id]/page.tsx
    - src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx
    - src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx

key-decisions:
  - "Base UI's Drawer.Viewport is required for swipe-to-dismiss — added to DrawerDialog and MoreSheet"
  - "Cypress swipe simulation uses native TouchEvent dispatch on viewport element at popup-internal coordinates (not CDP touch events or PointerEvents)"
  - "DrawerViewport wraps Popup via pointer-events-none/pointer-events-auto pattern to allow full-screen positioning without blocking backdrop clicks"

patterns-established:
  - "Swipe test pattern: dispatch TouchEvent on popup.parentElement (Drawer.Viewport) using popup's own getBoundingClientRect for coordinates"
  - "DrawerDialog structure: Portal > Viewport (full-screen flex items-end) > Popup (w-full rounded-t-xl)"

requirements-completed: [TOUCH-02, TOUCH-03]

duration: 120min
completed: 2026-03-25
---

# Phase 15 Plan 02: Touch Optimization Migration Summary

**Dialog/Sheet migration to DrawerDialog across 9 files + Cypress E2E test suite verifying 44px touch targets, responsive drawer/dialog behavior, and swipe-to-dismiss on mobile**

## Performance

- **Duration:** ~120 min (includes debugging swipe simulation)
- **Started:** 2026-03-25T14:00:00Z
- **Completed:** 2026-03-25T18:53:00Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 13 (9 app files + more-sheet + drawer-dialog + 1 test file)

## Accomplishments
- Migrated 13 Dialog usages and 3 Sheet side="right" usages to DrawerDialog/DrawerDialogContent across 9 app files
- Updated MoreSheet drag handle from h-1 w-10 to h-2 w-12 per UI-SPEC
- Fixed swipe-to-dismiss by adding Drawer.Viewport to both DrawerDialog and MoreSheet
- Created comprehensive Cypress test suite (8 tests) covering all TOUCH requirements
- All 26 regression tests pass across loans-list, payments, expenses, income, creditors

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate all Dialog/Sheet call sites to DrawerDialog** - `4df1ef9` (feat)
2. **Task 2: Cypress E2E tests + Drawer.Viewport fix** - `ec1e7f3` (feat)

## Files Created/Modified
- `cypress/e2e/touch-optimization.cy.ts` - 8 E2E tests: TOUCH-01 (44px), TOUCH-02 (drawer/dialog), TOUCH-03 (swipe)
- `src/components/ui/drawer-dialog.tsx` - Added Drawer.Viewport wrapper for swipe-to-dismiss support
- `src/components/layout/more-sheet.tsx` - Added Drawer.Viewport; drag handle h-2 w-12
- `src/app/(app)/loans/page.tsx` - Dialog → DrawerDialog migration
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` - 4 dialogs migrated
- `src/app/(app)/payments/PaymentsClient.tsx` - 1 Sheet + 1 Dialog → 2 DrawerDialogs
- `src/app/(app)/payments/QuickRecordDialog.tsx` - Dialog → DrawerDialog
- `src/app/(app)/expenses/ExpenseListClient.tsx` - 1 Sheet + 1 Dialog → 2 DrawerDialogs
- `src/app/(app)/income/IncomeListClient.tsx` - 1 Sheet + 1 Dialog → 2 DrawerDialogs
- `src/app/(app)/customers/[id]/page.tsx` - Dialog → DrawerDialog
- `src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx` - Dialog → DrawerDialog
- `src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx` - Dialog → DrawerDialog

## Decisions Made
- Added `Drawer.Viewport` to `DrawerDialogContent` and `MoreSheet`: Base UI's drawer only enables swipe-to-dismiss when `Drawer.Viewport` is present — without it, `swipeDirection="down"` on `Drawer.Root` has no effect
- Cypress swipe simulation uses native `TouchEvent` dispatch on `popup.parentElement` at coordinates derived from the popup's own `getBoundingClientRect`: CDP touch events (`realSwipe`) don't trigger Base UI's React touch event handlers; PointerEvents with `pointerType='touch'` are explicitly ignored by DrawerViewport; direct DOM TouchEvents DO propagate through React's event delegation
- Viewport layout pattern: `pointer-events-none` on viewport container, `pointer-events-auto` on popup — allows full-screen flex positioning while letting backdrop clicks through

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added Drawer.Viewport to enable swipe-to-dismiss**
- **Found during:** Task 2 (Cypress E2E tests)
- **Issue:** DrawerDialog and MoreSheet used `swipeDirection="down"` on `Drawer.Root` but without `Drawer.Viewport`, Base UI's swipe-dismiss hook (`useSwipeDismiss`) is never activated — confirmed by reading DrawerPopup source which reads swipe context from `DrawerViewportContext` (returns null without Viewport)
- **Fix:** Wrapped `Drawer.Popup` with `Drawer.Viewport className="fixed inset-0 z-50 flex items-end pointer-events-none"` in both `drawer-dialog.tsx` and `more-sheet.tsx`. Adjusted popup classes to use `w-full` and `pointer-events-auto` instead of `fixed bottom-0 inset-x-0`
- **Files modified:** src/components/ui/drawer-dialog.tsx, src/components/layout/more-sheet.tsx
- **Verification:** Cypress swipe tests pass (8/8), regression tests pass (26/26)
- **Committed in:** ec1e7f3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Critical correctness fix — swipe-to-dismiss was silently broken before. No scope creep.

## Issues Encountered
- `realSwipe` from `cypress-real-events` uses CDP `Input.dispatchTouchEvent` — doesn't trigger Base UI's touch handlers (React synthetic events)
- PointerEvents with `pointerType='touch'` are explicitly skipped in DrawerViewport (only used for desktop mouse swipe)
- Solution: dispatch native DOM `TouchEvent` on the viewport container at coordinates within the popup rect — React's delegated event system picks these up and fires synthetic `onTouchStart/onTouchMove/onTouchEnd`

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All TOUCH requirements (TOUCH-01, TOUCH-02, TOUCH-03) are tested and verified
- DrawerDialog is now the standard dialog/sheet pattern across the entire app
- Swipe-to-dismiss works correctly on both DrawerDialog and MoreSheet
- Ready for Phase 15-03 (if any) or Phase 16

## Self-Check: PASSED
- cypress/e2e/touch-optimization.cy.ts: FOUND
- src/components/ui/drawer-dialog.tsx: FOUND
- src/components/layout/more-sheet.tsx: FOUND
- Commit ec1e7f3: FOUND
- Commit 4df1ef9: FOUND

---
*Phase: 15-touch-optimization*
*Completed: 2026-03-25*
