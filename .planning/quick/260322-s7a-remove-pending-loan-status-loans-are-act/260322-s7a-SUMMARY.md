---
phase: quick
plan: 260322-s7a
subsystem: loan-lifecycle
tags: [loan-status, schema, migration, payment-service, ui]
dependency_graph:
  requires: []
  provides: [simplified-loan-lifecycle]
  affects: [loan-service, payment-service, ui-loan-pages, customer-search]
tech_stack:
  added: []
  patterns: [drizzle-enum-migration]
key_files:
  created:
    - drizzle/0004_remove-pending-loan-status.sql
  modified:
    - src/lib/db/schema/loans.ts
    - src/types/index.ts
    - src/services/loan.service.ts
    - src/services/payment.service.ts
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/customers/[id]/page.tsx
    - src/components/customers/customer-search-bar.tsx
    - src/services/__tests__/loan.service.test.ts
    - src/services/__tests__/payment.service.test.ts
    - src/services/__integration__/loan.service.test.ts
    - src/services/__integration__/payment.service.test.ts
decisions:
  - "deletePayment reverts loan to active (not pending) when all payments deleted — disbursement happened off-app before recording"
  - "Migration uses rename+recreate pattern because Postgres does not support removing enum values directly"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-22"
  tasks_completed: 3
  files_modified: 12
---

# Quick Task 260322-s7a: Remove Pending Loan Status Summary

**One-liner:** Removed "pending" from loanStatusEnum entirely — loans created as "active" immediately, with DB migration, service cleanup, and test updates.

## What Was Done

Simplified the loan lifecycle by removing the "pending" status. The pending->active transition was unnecessary ceremony since the loan officer gives money off-app before recording the loan.

### Task 1: Schema, types, and service logic

- `src/lib/db/schema/loans.ts`: `loanStatusEnum` now only has `["active", "fully_paid"]`; column default changed from `"pending"` to `"active"`
- `src/types/index.ts`: `LoanStatus` is now `"active" | "fully_paid"`
- `src/services/loan.service.ts`: `createLoan` inserts with `status: "active"`
- `src/services/payment.service.ts`:
  - Removed the `else if (loan.status === "pending")` branch in `recordPayment`
  - Updated JSDoc comment to remove pending->active mention
  - `deletePayment` now sets `status: "active"` (not `"pending"`) when no active payments remain
- `drizzle/0004_remove-pending-loan-status.sql`: Migration that updates existing pending rows to active, then renames the old enum, creates the new one, migrates the column type, and drops the old enum

### Task 2: UI components

- `src/app/(app)/loans/page.tsx`: `loanStatusVariant` no longer handles `"pending"` branch
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`: Removed `"pending"` badge variant and the entire "Loan pending disbursement" amber callout block
- `src/app/(app)/customers/[id]/page.tsx`: `loanStatusVariant` no longer handles `"pending"` branch
- `src/components/customers/customer-search-bar.tsx`: Removed `<SelectItem value="pending">Pending</SelectItem>` from loan status filter

### Task 3: Tests

- Unit tests: `mockLoan.status` changed from `"pending"` to `"active"` in both loan and payment service tests
- `payment.service.test.ts`: Rewrote "pending->active" test to "first payment on active loan keeps it active"
- Integration tests: Both `loan.service.test.ts` assertions on `result.status` updated to `"active"`
- Integration `payment.service.test.ts`: Test 1 now confirms loan starts as `"active"`; test 12 renamed to "deleting only payment keeps loan active" with assertion changed from `"pending"` to `"active"`

## Verification

- TypeScript: `npx tsc --noEmit` — zero errors
- Tests: `npx vitest run` — 97 tests pass (6 test files)
- No grep matches for `"pending"` as a loan status in src/

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| b7e78cc | feat(quick-s7a): remove pending loan status — loans created as active immediately |
| 88b67d0 | test(quick-s7a): update all tests to remove pending loan status references |

## Self-Check: PASSED
