---
phase: 03-operational-management
plan: "03"
subsystem: ui
tags: [dashboard, watchlist, kpi, drizzle-orm, effect, bignumber, sql-aggregates, interest-engine]

# Dependency graph
requires:
  - phase: 03-01
    provides: KpiCard component, OverdueBadge component, DashboardKPIs/WatchlistEntry/ActivityFeedItem types, notification infrastructure
  - phase: 01-02
    provides: Interest Engine (calculateDaysOverdue, calculateDailyRate, calculateInterest)
  - phase: 01-04
    provides: audit log schema for activity feed
provides:
  - Executive dashboard page with 6 SQL-aggregated KPI cards and activity feed
  - Borrower watchlist page with real-time overdue calculation (daysOverdue >= 30)
  - dashboard.service.ts — getDashboardKPIs, getRecentActivity
  - watchlist.service.ts — getWatchlistData
  - dashboard.actions.ts — getDashboardAction server action
  - watchlist.actions.ts — getWatchlistAction server action
affects: [04-creditor-management, reporting, notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL aggregates (sum/count) via Drizzle ORM for KPI values — never stored/cached"
    - "Interest Engine reused for real-time overdue calculation on both dashboard and watchlist"
    - "Client component + useEffect + server action pattern for data fetching pages"
    - "Per-loan BigNumber arithmetic loop for outstanding balance (no SQL sum of principalBalanceAfter)"

key-files:
  created:
    - src/services/dashboard.service.ts
    - src/services/watchlist.service.ts
    - src/actions/dashboard.actions.ts
    - src/actions/watchlist.actions.ts
    - src/app/(app)/watchlist/page.tsx
  modified:
    - src/app/(app)/dashboard/page.tsx
    - src/components/notifications/notification-bell.tsx

key-decisions:
  - "Outstanding balance calculated per-loan via principalBalanceAfter of last payment (not SQL sum) — matches loan detail page pattern"
  - "Watchlist threshold is >= 30 days overdue, using same calculateDaysOverdue engine as cron endpoint for consistency (RISK-04)"
  - "capitalInSystem hardcoded to 0.00 with Phase 4 subtitle — creditor data not yet available"
  - "Overdue count uses text-destructive class only when count > 0 — semantic color signal for management"

patterns-established:
  - "Effect.tryPromise service functions returning Effect<T, DatabaseError>"
  - "Server action pattern: auth.api.getSession guard + Effect.runPromise + error discrimination"
  - "Client page pattern: useEffect on mount, loading skeleton, error state, empty state"

requirements-completed: ["RPTS-01", "RISK-01", "RISK-02"]

# Metrics
duration: 20min
completed: 2026-03-21
---

# Phase 3 Plan 03: Dashboard and Watchlist Summary

**SQL-aggregated executive dashboard with 6 KPI cards and activity feed, plus real-time borrower watchlist using Interest Engine (daysOverdue >= 30 threshold)**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-21T06:30:00Z
- **Completed:** 2026-03-21T06:50:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Dashboard service computing outstanding balance, repayments, interest earned, active borrowers, and overdue count from live SQL data
- Watchlist service filtering active loans by daysOverdue >= 30 using the same Interest Engine as the cron endpoint, sorted descending
- Dashboard page with 6 KPI cards in 3-column grid: overdue count uses `text-destructive` when > 0, Capital card shows Phase 4 note
- Activity feed showing last 10 audit log events with relative timestamps and type-specific icons
- Watchlist page with table, OverdueBadge, skeleton loading, empty state, and row-click navigation to customer profile

## Task Commits

Each task was committed atomically:

1. **Task 1: Dashboard service, actions, and page** - `77b9600` (feat)
2. **Task 2: Watchlist service, actions, and page** - `d2cffe1` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/services/dashboard.service.ts` — getDashboardKPIs, getRecentActivity using SQL aggregates and Interest Engine
- `src/services/watchlist.service.ts` — getWatchlistData with per-loan overdue calculation, daysOverdue >= 30 filter
- `src/actions/dashboard.actions.ts` — getDashboardAction server action with auth guard
- `src/actions/watchlist.actions.ts` — getWatchlistAction server action with auth guard
- `src/app/(app)/dashboard/page.tsx` — 6 KPI cards, activity feed, loading/error/empty states
- `src/app/(app)/watchlist/page.tsx` — watchlist table with OverdueBadge, skeleton, empty state, row navigation
- `src/components/notifications/notification-bell.tsx` — bug fix: result.data nullability

## Decisions Made

- Outstanding balance calculated per-loan via principalBalanceAfter of last payment (not SQL sum) — needed because payments table is the source of truth for running balance
- Watchlist >= 30 day threshold uses identical engine function calls as cron endpoint for RISK-04 compliance
- capitalInSystem is hardcoded "0.00" with "Creditor data available in Phase 4" subtitle — Phase 4 will supply creditor data

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript nullability errors in notification-bell.tsx**
- **Found during:** Task 2 build verification (pnpm build)
- **Issue:** `setUnreadCount(result.data)` and `setNotifications(result.data)` failed TypeScript because result.data is `T | undefined` from the union return type of server actions; caused build failure
- **Fix:** Added `?? 0` and `?? []` fallbacks to the two `setX(result.data)` calls
- **Files modified:** src/components/notifications/notification-bell.tsx
- **Verification:** `npx tsc --noEmit` clean, `pnpm build` passes
- **Committed in:** d2cffe1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Required for build to pass. Pre-existing bug in notification-bell component unrelated to Task 2 scope but blocking compilation.

## Issues Encountered

- Next.js build lock file (`/.next/lock`) was stale from a previous killed build, causing "Another build already running" errors. Removed lock file to proceed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Dashboard and watchlist complete — management has real-time portfolio visibility
- Phase 4 (creditor management) can populate capitalInSystem once creditor data is available
- Watchlist threshold (30 days) matches cron endpoint logic — no drift risk

## Self-Check

- [x] `src/services/dashboard.service.ts` — confirmed exists
- [x] `src/services/watchlist.service.ts` — confirmed exists
- [x] `src/actions/dashboard.actions.ts` — confirmed exists
- [x] `src/actions/watchlist.actions.ts` — confirmed exists
- [x] `src/app/(app)/watchlist/page.tsx` — confirmed exists
- [x] `src/app/(app)/dashboard/page.tsx` — confirmed modified
- [x] Task 1 commit `77b9600` — confirmed in git log
- [x] Task 2 commit `d2cffe1` — confirmed in git log
- [x] `pnpm build` — PASSED (watchlist route visible in build output)

## Self-Check: PASSED

---
*Phase: 03-operational-management*
*Completed: 2026-03-21*
