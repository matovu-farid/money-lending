---
phase: 05-add-optimistic-updates-for-form-submits-loading-animations-and-tanstack-query-integration
plan: 04
subsystem: ui
tags: [tanstack-query, useMutation, optimistic-updates, sonner, react]

# Dependency graph
requires:
  - phase: 05-01
    provides: QueryClientProvider wrapping AppShell with staleTime 60s

provides:
  - ExpenseListClient with useMutation optimistic add/delete, instant perceived response, rollback on failure
  - IncomeListClient with useMutation optimistic add/delete, instant perceived response, rollback on failure

affects: [expense-ui, income-ui, ux-responsiveness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useMutation with onMutate/onError/onSuccess lifecycle for optimistic list mutations
    - Optimistic rows use isOptimistic flag for opacity-50 visual distinction and disabled buttons
    - addMutation.isPending disables add button to prevent concurrent-mutation race conditions
    - Actions throw on error (void return) so onSuccess has no error-in-result check
    - onSuccess removes optimistic row; revalidatePath brings real server data on next navigation

key-files:
  created: []
  modified:
    - src/app/(app)/expenses/ExpenseListClient.tsx
    - src/app/(app)/income/IncomeListClient.tsx

key-decisions:
  - "Server Actions return void (throw on error) so onSuccess skips 'error in result' guard — rollback only needed in onError"
  - "Optimistic row removed in onSuccess rather than replaced — revalidatePath handles bringing real data without a second setState"
  - "IncomeListClient was rendering initialTransactions directly in JSX (not from state) — fixed to use localTransactions for optimistic updates to work"

patterns-established:
  - "useMutation optimistic pattern: onMutate snapshot + optimistic prepend, onError rollback, onSuccess remove optimistic"
  - "Keep useTransition only for category management (non-optimistic side effect); replace add/delete with useMutation"

requirements-completed: [UX-03, UX-05]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 05 Plan 04: Optimistic Mutations for Expense and Income Lists Summary

**TanStack Query useMutation replaces useTransition for expense and income add/delete — instant optimistic rows at opacity-50 with automatic rollback and sonner toast on failure**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T05:03:00Z
- **Completed:** 2026-03-22T05:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- ExpenseListClient upgraded with `addMutation` and `deleteMutation` using TanStack Query useMutation; optimistic rows appear instantly, rollback on error
- IncomeListClient upgraded with identical pattern; also fixed a bug where the component was rendering `initialTransactions` directly instead of local state
- Both files use `addMutation.isPending` to disable the add button preventing double-submit race conditions; optimistic rows show at `opacity-50` with delete buttons disabled

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade ExpenseListClient to TanStack Query optimistic mutations** - `42abcfd` (feat)
2. **Task 2: Upgrade IncomeListClient to TanStack Query optimistic mutations** - `d9d10f1` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/app/(app)/expenses/ExpenseListClient.tsx` - useTransition replaced with useMutation for add/delete; optimistic prepend with isOptimistic flag; sonner toast; keep useTransition for category ops
- `src/app/(app)/income/IncomeListClient.tsx` - Same useMutation pattern; also fixed JSX to render from `localTransactions` state (was using `initialTransactions` directly)

## Decisions Made

- Server Actions return void (throw on error) — `onSuccess` has no `"error" in result` guard; rollback is only handled in `onError` catch
- Optimistic row removed in `onSuccess` (not replaced with server data) — `revalidatePath` in the action handles refreshing the real list on next navigation
- `useTransition` kept only for category management since categories don't need optimistic updates in the same way

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IncomeListClient rendered initialTransactions directly instead of local state**

- **Found during:** Task 2 (IncomeListClient upgrade)
- **Issue:** The component's table and empty state used `initialTransactions` directly rather than a `useState`-managed copy, meaning optimistic updates would never appear in the UI
- **Fix:** Changed component to use `localTransactions` state (backed by `useState(initialTransactions)`) throughout the JSX
- **Files modified:** `src/app/(app)/income/IncomeListClient.tsx`
- **Verification:** `localTransactions` now drives all rendering; vitest passes
- **Committed in:** `d9d10f1` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Fix required for the optimistic pattern to work at all in the income list. No scope creep.

## Issues Encountered

None beyond the auto-fixed rendering bug above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both expense and income lists now have instant optimistic feedback with automatic rollback
- Pattern established for any future list pages needing useMutation optimistic updates
- No blockers; Phase 05 can continue with remaining plans

---
*Phase: 05-add-optimistic-updates-for-form-submits-loading-animations-and-tanstack-query-integration*
*Completed: 2026-03-22*
