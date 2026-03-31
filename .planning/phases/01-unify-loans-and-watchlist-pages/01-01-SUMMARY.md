---
phase: 01-unify-loans-and-watchlist-pages
plan: 01
subsystem: api
tags: [drizzle-orm, tanstack-query, loans, watchlist, data-layer]

# Dependency graph
requires: []
provides:
  - LoanListEntry type exported from src/types/index.ts with outstandingBalance, dailyRate, lastPaymentDate, daysOverdue fields
  - computeOverdue extended to fetch payments for ALL loan statuses and return LoanListEntry[]
  - useLoans TanStack Query hook calling listLoansWithOverdueAction
  - Sidebar and MoreSheet navigation cleaned of Watchlist entry
  - All watchlist service/action/hook/test files deleted
affects:
  - 01-02 (unified loans page needs LoanListEntry type and useLoans hook)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useLoans hook pattern: TanStack Query over server action, mirrors use-watchlist pattern"
    - "LoanListEntry extends LoanWithCustomer with computed watchlist-style fields"

key-files:
  created:
    - src/hooks/use-loans.ts
  modified:
    - src/types/index.ts
    - src/actions/loan.actions.ts
    - src/hooks/query-keys.ts
    - src/components/layout/sidebar.tsx
    - src/components/layout/more-sheet.tsx
    - src/app/(app)/watchlist/page.tsx

key-decisions:
  - "computeOverdue now fetches payments for ALL loan statuses, not just active — enables outstandingBalance and lastPaymentDate for every loan"
  - "watchlist/page.tsx adapted to use useLoans + filter for overdue active loans rather than dedicated getWatchlistAction — eliminates dead code path while maintaining existing UI until Plan 02 replaces it"

patterns-established:
  - "Data hook pattern: create use-[entity].ts with useQuery + queryKeys.[entity].all + unwrapAction"

requirements-completed:
  - UNIFY-DATA
  - UNIFY-NAV

# Metrics
duration: 12min
completed: 2026-03-31
---

# Phase 01 Plan 01: Unify Loans Data Layer Summary

**LoanListEntry unified type with outstandingBalance/dailyRate/lastPaymentDate, useLoans TanStack Query hook, and all watchlist navigation/files removed**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-31T13:10:00Z
- **Completed:** 2026-03-31T13:22:00Z
- **Tasks:** 2
- **Files modified:** 7 (2 deleted, 6 others removed via git rm)

## Accomplishments
- LoanListEntry type added to src/types/index.ts extending LoanWithCustomer with 4 new fields
- computeOverdue in loan.actions.ts extended to fetch payments for ALL loan statuses and return full LoanListEntry[]
- useLoans hook created following established TanStack Query pattern
- Watchlist query key removed from query-keys.ts
- Watchlist removed from sidebar and more-sheet navigation
- 6 watchlist files deleted (actions, service, hook, 2 unit tests, 1 integration test)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add LoanListEntry type, extend computeOverdue, create useLoans hook** - `3df43d1` (feat)
2. **Task 2: Remove watchlist from navigation and delete all watchlist files** - `c549ca1` (feat)

## Files Created/Modified
- `src/types/index.ts` - Added LoanListEntry type (extends LoanWithCustomer with 4 watchlist-style fields)
- `src/actions/loan.actions.ts` - Extended computeOverdue to return LoanListEntry[], added payment fetch for all loan statuses
- `src/hooks/use-loans.ts` - New TanStack Query hook calling listLoansWithOverdueAction
- `src/hooks/query-keys.ts` - Removed watchlist key
- `src/components/layout/sidebar.tsx` - Removed Watchlist nav item and AlertTriangle import
- `src/components/layout/more-sheet.tsx` - Removed Watchlist entry and AlertTriangle import
- `src/app/(app)/watchlist/page.tsx` - Updated to use useLoans hook instead of deleted useWatchlist
- **Deleted:** src/actions/watchlist.actions.ts, src/services/watchlist.service.ts, src/hooks/use-watchlist.ts, src/services/__tests__/watchlist.service.test.ts, src/services/__integration__/watchlist.service.test.ts, src/hooks/__tests__/use-watchlist.test.ts

## Decisions Made
- computeOverdue now fetches payments for ALL loan statuses — enables outstandingBalance and lastPaymentDate fields without conditional logic
- watchlist/page.tsx was adapted (not deleted) to use useLoans until Plan 02 replaces it — prevents broken page during development

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated watchlist/page.tsx to use useLoans after deleting use-watchlist.ts**
- **Found during:** Task 2 (Remove watchlist files)
- **Issue:** watchlist/page.tsx imported from the just-deleted use-watchlist hook, causing TypeScript compilation failure
- **Fix:** Updated watchlist/page.tsx to import useLoans, filter for overdue active loans (daysOverdue > 0), and adapt to LoanListEntry type (daysOverdue as number, e.id instead of e.loanId for row key)
- **Files modified:** src/app/(app)/watchlist/page.tsx
- **Verification:** npx tsc --noEmit exits 0
- **Committed in:** c549ca1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required fix to unblock TypeScript compilation. No scope creep — watchlist/page.tsx is a temporary adaptation until Plan 02 replaces it entirely.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- LoanListEntry type available for Plan 02 unified loans page
- useLoans hook ready for consumption in loans/page.tsx
- Navigation cleaned of Watchlist entry
- No blockers for Plan 02

---
*Phase: 01-unify-loans-and-watchlist-pages*
*Completed: 2026-03-31*
