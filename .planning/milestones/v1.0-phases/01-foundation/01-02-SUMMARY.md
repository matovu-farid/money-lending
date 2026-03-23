---
phase: 01-foundation
plan: "02"
subsystem: testing
tags: [bignumber, interest, tdd, vitest, financial-math]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: Project scaffold, database schema, vitest infrastructure

provides:
  - Pure BigNumber interest calculation functions (calculateInterest, calculateDailyRate, calculateLoanSummary, calculateDaysOverdue, formatAmount)
  - 12 unit tests covering all LOAN-03, LOAN-04, LOAN-10 requirements and RISK-01 watchlist formula
  - Barrel export at src/lib/interest/index.ts

affects: [loan-issuance, payment-processing, watchlist, loan-wizard-review]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD red-green-refactor, pure-function financial engine, BigNumber-only arithmetic, perpetual-loan model]

key-files:
  created:
    - src/lib/interest/engine.ts
    - src/lib/interest/index.ts
    - src/lib/interest/__tests__/engine.test.ts
  modified: []

key-decisions:
  - "Math.max is acceptable for integer day-count comparison (non-monetary) — BigNumber used exclusively for monetary arithmetic"
  - "calculateLoanSummary fields use totalInterestAtMinPeriod/totalOwedAtMinPeriod naming (not 30Days suffix) because min period is overridable per LOAN-11"
  - "calculateDaysOverdue returns BigNumber(0) when unpaid interest <= 0 (not an error condition)"

patterns-established:
  - "BigNumber.config at module top: DECIMAL_PLACES=10, ROUNDING_MODE=ROUND_HALF_UP"
  - "All monetary arithmetic via BigNumber methods: .multipliedBy(), .dividedBy(), .plus(), .minus()"
  - "formatAmount(.toFixed(2)) used consistently for string conversion at boundaries"
  - "Interest engine is pure — zero DB imports, zero fetch calls, zero side effects"

requirements-completed: [LOAN-03, LOAN-04, LOAN-10]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 01 Plan 02: Interest Engine Summary

**BigNumber interest engine with TDD — reducing-balance formula, 30-day minimum period enforcement, and watchlist days-overdue calculation via 12 passing tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T10:46:28Z
- **Completed:** 2026-03-20T10:47:57Z
- **Tasks:** 3 (TDD RED, GREEN, REFACTOR)
- **Files modified:** 3

## Accomplishments

- Implemented `calculateInterest` with reducing-balance formula and configurable minimum period enforcement (LOAN-03, LOAN-10)
- Implemented `calculateDailyRate`, `calculateLoanSummary` (loan wizard Review step, no termDays/dueDate — perpetual model), `calculateDaysOverdue` (RISK-01 watchlist), `formatAmount`
- All 12 unit tests pass covering basic interest, pro-rated days, minimum period override, edge cases (zero unpaid, full overdue)
- Engine is pure — zero DB imports, zero fetch calls, no side effects

## Task Commits

Each TDD phase committed atomically:

1. **TDD RED — failing tests** - `e7adce6` (test)
2. **TDD GREEN — engine implementation** - `8c7fca7` (feat)

No REFACTOR commit required — code was clean after GREEN.

## Files Created/Modified

- `src/lib/interest/engine.ts` — Pure BigNumber interest calculation functions (86 lines)
- `src/lib/interest/index.ts` — Barrel export for all engine functions
- `src/lib/interest/__tests__/engine.test.ts` — 12 unit tests covering all requirements (99 lines)

## Decisions Made

- `Math.max` used for integer day-count comparison in `calculateInterest` (comparing `daysElapsed` vs `minInterestDays` — both plain integers, never monetary values). This is not a BigNumber violation; native arithmetic is only forbidden on monetary values.
- Field names in `calculateLoanSummary` use `totalInterestAtMinPeriod`/`totalOwedAtMinPeriod` (not `totalInterest30Days`) because the minimum period is overridable per LOAN-11.
- `calculateDaysOverdue` returns `BigNumber(0)` when unpaid interest is <= 0 — this is the correct business behavior (not an error), representing a fully current loan.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Interest Engine is complete and tested — ready for consumption by loan issuance Server Actions (Plan 01-04) and the loan wizard Review step (Plan 01-05)
- `calculateDaysOverdue` pre-built for Phase 3 watchlist (RISK-01/RISK-02) — no rework needed
- Import via `@/lib/interest` (barrel) from any server or client module

---
*Phase: 01-foundation*
*Completed: 2026-03-20*

## Self-Check: PASSED

- engine.ts: FOUND
- index.ts: FOUND
- engine.test.ts: FOUND
- SUMMARY.md: FOUND
- Commit e7adce6 (RED): FOUND
- Commit 8c7fca7 (GREEN): FOUND
