---
phase: 01-foundation
plan: 05
subsystem: api
tags: [effect, drizzle, server-actions, loans, collateral, audit, rbac]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: loans schema, collateral schema, settings schema, errors.ts, types/index.ts
  - phase: 01-foundation/01-02
    provides: interest engine (calculateLoanSummary)
  - phase: 01-foundation/01-03
    provides: auth.ts, ROLE_LEVELS, session pattern
  - phase: 01-foundation/01-04
    provides: writeAuditLog plain async function, customer.actions.ts pattern
provides:
  - Atomic loan issuance (loan + collateral + audit log in single db.transaction)
  - createLoan Effect with CUST-04 completeness check and LOAN-02 perpetual design
  - listLoans and getLoan query Effects
  - createLoanAction and listLoansAction Server Actions with role-guarded overrides (LOAN-11)
  - getSettingsAction and updateSettingAction Server Actions (superAdmin-only global defaults)
  - CollateralInput and CreateLoanInput TypeScript interfaces (no Zod)
affects:
  - 01-06 (payment service), 02-* (UI layers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Effect.tryPromise wrapping db.transaction for atomic multi-table writes
    - Plain await writeAuditLog(tx, ...) inside Drizzle transaction (not Effect.runPromise)
    - Customer completeness check before entering transaction (fail fast)
    - Role-level stripping for override fields in Server Actions
    - Two-tier override model: per-loan (admin+) vs global defaults (superAdmin)

key-files:
  created:
    - src/services/loan.service.ts
    - src/actions/loan.actions.ts
    - src/actions/settings.actions.ts
  modified:
    - src/types/index.ts
    - src/services/__tests__/loan.service.test.ts

key-decisions:
  - "LOAN-11 vs AUTH-03 resolved: per-loan overrides (interestRateOverride, minPeriodOverride) are admin+, global system defaults require superAdmin per AUTH-03 capability table"
  - "CollateralInput and CreateLoanInput are TypeScript interfaces -- no Zod per user decision"
  - "writeAuditLog called with direct await inside db.transaction -- not Effect.runPromise (Pitfall 7)"
  - "Customer completeness check runs outside transaction to fail fast before acquiring db lock"

patterns-established:
  - "Loan creation pattern: fetch+validate customer -> db.transaction(loan+collateral+auditLog)"
  - "Role guard pattern: ROLE_LEVELS[role] < ROLE_LEVELS.admin -> strip override fields silently"
  - "Settings guard pattern: ROLE_LEVELS[role] < ROLE_LEVELS.superAdmin -> return error"

requirements-completed: [LOAN-01, LOAN-02, LOAN-05, LOAN-11, CUST-03, CUST-04]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 01 Plan 05: Loan Service Summary

**Effect-based atomic loan issuance with separate collateral table, audit log in single db.transaction, and role-guarded Server Actions for per-loan and global-default overrides**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T11:17:33Z
- **Completed:** 2026-03-20T11:22:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Loan issuance is atomic: loan row + collateral row (separate table) + audit log entry all committed or all rolled back in one `db.transaction`
- CUST-04 completeness check (fullName, contact, address) blocks incomplete applications before the transaction begins
- LOAN-11 and AUTH-03 tension resolved via two-tier override model: per-loan overrides (columns on loans table) are admin+, global system defaults require superAdmin
- No Zod anywhere — TypeScript interfaces for inputs, runtime string guards in Server Actions

## Task Commits

Each task was committed atomically:

1. **Task 1: Loan input types, loan service, test update** - `9966f61` (feat)
2. **Task 2: Loan and settings Server Actions with role guards** - `7e5c8ba` (feat)

**Plan metadata:** (see final docs commit below)

## Files Created/Modified

- `src/types/index.ts` - Added CollateralInput and CreateLoanInput interfaces (no termDays)
- `src/services/loan.service.ts` - createLoan, getLoan, listLoans Effects; atomic transaction with collateral and audit log
- `src/services/__tests__/loan.service.test.ts` - Replaced Wave 0 stubs with real tests (4 passing, 3 todos for DB tests)
- `src/actions/loan.actions.ts` - createLoanAction and listLoansAction Server Actions; role guard strips overrides for non-admin
- `src/actions/settings.actions.ts` - getSettingsAction and updateSettingAction; superAdmin-only for global defaults

## Decisions Made

- **LOAN-11 vs AUTH-03:** Per-loan overrides (interestRateOverride, minPeriodOverride on loan record) are admin+. Global system defaults in system_settings table are superAdmin only. This resolves the tension without changing schema.
- **writeAuditLog call pattern:** Direct `await writeAuditLog(tx, ...)` inside db.transaction — NOT wrapped in Effect.runPromise. Drizzle transaction callbacks are plain async; calling Effect.runPromise there causes runtime errors (RESEARCH.md Pitfall 7). This continues the pattern established in Plan 01-04.
- **Customer check placement:** Completeness check runs before `db.transaction()` to fail fast without acquiring a DB lock for a predictably-invalid input.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled clean on first pass, all 4 tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Loan service is ready for use by Plan 01-06 (payment recording service)
- createLoanAction can be called from UI components in Phase 02
- Settings Server Actions are ready for an admin UI
- 3 DB-integration tests remain as todos (requires test DB environment)

---
*Phase: 01-foundation*
*Completed: 2026-03-20*
