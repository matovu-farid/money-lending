---
phase: 07-daily-collections-view
plan: 01
subsystem: payments
tags: [effect, drizzle, tanstack-query, bignumber, timezone, server-actions]

requires:
  - phase: 06-global-payments-list
    provides: Payment schema with deletedAt, listPayments service patterns

provides:
  - getDailyCollections Effect service — timezone-aware (Africa/Kampala) daily aggregation with BigNumber totals
  - getLoansDueToday Effect service — 30-day threshold loop over active loans
  - getDailyCollectionsAction and getLoansDueTodayAction auth-gated server actions
  - useDailyCollections and useLoansDueToday TanStack Query hooks with date-keyed queryKeys
  - DailyCollectionRow, DailyCollectionsSummary, LoanDueToday type exports from src/types/index.ts

affects:
  - 07-02 (UI plan will consume these hooks and types directly)

tech-stack:
  added: []
  patterns:
    - "AT TIME ZONE 'Africa/Kampala' in Drizzle sql`` template for timezone-aware date filtering"
    - "BigNumber.js reduce aggregation for NUMERIC precision totals"
    - "getLoansDueToday follows watchlist.service.ts loop pattern: active loans -> payments -> customer"
    - "Date-keyed TanStack Query queryKey: ['daily-collections', date] for automatic per-date refetch"
    - "Integration tests use T09:00:00Z (noon Kampala time) to avoid timezone boundary ambiguity"

key-files:
  created:
    - src/services/daily-collections.service.ts
    - src/actions/daily-collections.actions.ts
    - src/hooks/use-daily-collections.ts
    - src/services/__tests__/daily-collections.service.test.ts
    - src/services/__integration__/daily-collections.service.test.ts
  modified:
    - src/types/index.ts

key-decisions:
  - "getLoansDueToday uses loan.startDate as anchor when loan has zero payments (matches watchlist pattern)"
  - "daysSinceLastPayment uses simple floor(ms/day) calculation — same as watchlist.service.ts"
  - "Integration test timestamps use T09:00:00Z (noon Kampala = UTC+3) to avoid date boundary issues in PGlite"
  - "useLoansDueToday sets staleTime: 5 * 60 * 1000 since due-today list is date-independent"

patterns-established:
  - "Service pattern: getDailyCollections mirrors watchlist.service.ts Effect.tryPromise wrapper"
  - "Test mock pattern: chainedSelect helper supports innerJoin chains for payment aggregation queries"

requirements-completed: [COLL-01, COLL-02, COLL-03, COLL-04]

duration: 3min
completed: 2026-03-23
---

# Phase 07 Plan 01: Daily Collections Data Layer Summary

**Timezone-aware daily payment aggregation service with BigNumber precision totals, due-today loan list, auth-gated server actions, and date-keyed TanStack Query hooks — all with 14 passing tests (7 unit + 7 integration)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-23T10:59:44Z
- **Completed:** 2026-03-23T11:03:18Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Built getDailyCollections Effect service using `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` filter and BigNumber.js aggregation for precision NUMERIC totals
- Built getLoansDueToday Effect service following watchlist.service.ts loop pattern — iterates active loans, computes daysSinceLastPayment from last payment or startDate, returns sorted results
- Created auth-gated server actions and date-keyed TanStack Query hooks ready for UI consumption in plan 07-02
- Added 7 unit tests (mock db) and 7 integration tests (PGlite) — all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Type definitions, service functions, server actions, and hooks** - `60f4346` (feat)
2. **Task 2: Unit tests and integration tests for daily collections service** - `4bd6899` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/types/index.ts` — Added DailyCollectionRow, DailyCollectionsSummary, LoanDueToday interfaces
- `src/services/daily-collections.service.ts` — getDailyCollections and getLoansDueToday Effect services
- `src/actions/daily-collections.actions.ts` — Auth-gated server actions wrapping Effect.runPromise
- `src/hooks/use-daily-collections.ts` — useDailyCollections and useLoansDueToday TanStack Query hooks
- `src/services/__tests__/daily-collections.service.test.ts` — 7 unit tests with mocked db
- `src/services/__integration__/daily-collections.service.test.ts` — 7 integration tests against PGlite

## Decisions Made

- getLoansDueToday uses loan.startDate as anchor when loan has zero payments — consistent with watchlist.service.ts approach
- Integration test timestamps use T09:00:00Z (noon Kampala time in UTC) to avoid date boundary ambiguity in PGlite which runs in UTC
- useLoansDueToday sets staleTime of 5 minutes since the due-today list doesn't change with date navigation
- daysSinceLastPayment uses simple floor(ms / 86400000) formula — same arithmetic as watchlist.service.ts daysOverdue computation

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All data layer artifacts ready for plan 07-02 (UI implementation)
- useDailyCollections(date) and useLoansDueToday() hooks are the primary API surface for the UI
- DailyCollectionsSummary.rows provides per-payment breakdown for the collections table
- LoanDueToday[] provides the due-today list with daysSinceLastPayment for sorting/display

---
*Phase: 07-daily-collections-view*
*Completed: 2026-03-23*
