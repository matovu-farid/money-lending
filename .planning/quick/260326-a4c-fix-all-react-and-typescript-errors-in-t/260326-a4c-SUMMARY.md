---
phase: quick-260326-a4c
plan: "01"
subsystem: type-safety
tags: [typescript, schema, services, tests, bugfix]
dependency_graph:
  requires: []
  provides: [zero-typescript-errors, passing-unit-tests]
  affects: [src/lib/db/schema/loans.ts, src/services/loan.service.ts, src/services/dashboard.service.ts]
tech_stack:
  added: []
  patterns: [as-any-type-escape-hatch, effect-runpromise-cast]
key_files:
  created: []
  modified:
    - src/lib/db/schema/loans.ts
    - src/app/(app)/expenses/actions.ts
    - src/app/(app)/income/actions.ts
    - src/services/loan.service.ts
    - src/services/dashboard.service.ts
    - src/lib/__tests__/permissions.test.ts
    - src/services/__tests__/pdf.service.test.ts
    - src/services/__tests__/transaction.service.test.ts
decisions:
  - "Used as-any casts in test files for better-auth role type limitations rather than widening library types"
  - "Fixed getRecentActivity to match dotted action format (loan.create not create) stored in audit log"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-26"
  tasks_completed: 3
  files_modified: 8
---

# Phase quick-260326-a4c Plan 01: Fix TypeScript and React Errors Summary

**One-liner:** Fixed 36 TypeScript errors across 8 files by adding deletedAt to loans schema, fixing listLoans to join customers returning LoanWithCustomer[], returning created category from server actions, and fixing test type annotations.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Add deletedAt to loans schema and fix service/action type mismatches | f18f0bc | loans schema +deletedAt, listLoans joins customers, expenses/income actions return category |
| 2 | Fix TypeScript errors in test files | 49075bf | as-any in permissions test, Record<string,any> in pdf test, as-any casts in transaction test |
| 3 | Run full test suite and fix remaining failures | 32127d2 | Fix getRecentActivity action format matching and output shape |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed getRecentActivity action format mismatch**
- **Found during:** Task 3 (vitest run)
- **Issue:** Dashboard service `getRecentActivity` used `entry.action === "create"` but audit log stores `"loan.create"`, `"payment.create"` etc. Also missing customer name lookup, amount formatting, loanId/customerId/detail fields that tests expected.
- **Fix:** Rewrote `getRecentActivity` to match dotted action format, added customer lookup for loan.create, formatted amounts with toLocaleString, populated loanId/customerId/detail fields, added payment.update handling.
- **Files modified:** `src/services/dashboard.service.ts`
- **Commit:** 32127d2

## Final Verification

- `npx tsc --noEmit`: 0 errors (confirmed)
- `npx vitest run`: 351 tests passed, 0 failed across 21 test files

## Self-Check: PASSED

- src/lib/db/schema/loans.ts: FOUND - contains deletedAt column
- src/app/(app)/expenses/actions.ts: FOUND - returns category
- src/app/(app)/income/actions.ts: FOUND - returns category
- src/services/loan.service.ts: FOUND - returns LoanWithCustomer[]
- src/services/dashboard.service.ts: FOUND - fixed getRecentActivity
- Commits f18f0bc, 49075bf, 32127d2: all present in git log
