---
phase: 06-global-payments-list
plan: 01
subsystem: payments
tags: [drizzle, effect, server-actions, postgres, partial-index, integration-tests]

# Dependency graph
requires:
  - phase: existing-payment-schema
    provides: payments, loans, customers tables; recordPayment/deletePayment services
provides:
  - listPayments Effect service function with 3-table JOIN, pagination, and 5 filter types
  - listPaymentsAction Server Action with auth guard
  - ListPaymentsInput and PaymentWithCustomer types
  - Partial index idx_payments_active_date on payments(payment_date) WHERE deleted_at IS NULL
  - Integration tests covering PAY-01 through PAY-05 plus soft-delete exclusion
affects:
  - 06-02 (UI plan that depends on listPaymentsAction)
  - future payment filter/reporting features

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isNull(payments.deletedAt) is always the first condition in listPayments — never omit it"
    - "Partial index defined inside pgTable second arg as array: pgTable('t', cols, (t) => [index(...)])"
    - "listPayments uses parallel Promise.all for rows + count queries"
    - "dateTo inclusive: append T23:59:59.999Z to include same-day payments"

key-files:
  created:
    - drizzle/0005_polite_makkari.sql
    - drizzle/meta/0005_snapshot.json
  modified:
    - src/types/index.ts
    - src/services/payment.service.ts
    - src/actions/payment.actions.ts
    - src/lib/db/schema/payments.ts
    - src/services/__integration__/payment.service.test.ts
    - src/services/__tests__/payment.service.test.ts

key-decisions:
  - "Partial index defined inside pgTable() second argument as array (not as standalone export) — standalone export caused JSON.parse error on undefined defaultConfig in drizzle 0.45.1"
  - "listPayments always applies isNull(payments.deletedAt) as first condition; getPaymentsForLoan intentionally includes soft-deleted rows (different contract)"
  - "dateTo upper bound uses T23:59:59.999Z suffix to include payments recorded on the boundary date"

patterns-established:
  - "Drizzle partial indexes: use pgTable second arg array — index('name').on(table.col).where(sql`cond`)"
  - "3-table JOIN pattern: payments -> innerJoin(loans) -> innerJoin(customers) to denormalize customerName"
  - "Parallel count + rows queries with Promise.all for pagination efficiency"

requirements-completed: [PAY-01, PAY-02, PAY-03, PAY-04, PAY-05]

# Metrics
duration: 6min
completed: 2026-03-23
---

# Phase 06 Plan 01: Global Payments List — Data Layer Summary

**listPayments Effect service with 3-table JOIN (payments->loans->customers), pagination/5-filter types, listPaymentsAction Server Action, partial index, and 6 integration tests covering PAY-01 to PAY-05**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-23T09:43:11Z
- **Completed:** 2026-03-23T09:49:23Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Added `ListPaymentsInput` and `PaymentWithCustomer` types to `src/types/index.ts`
- Implemented `listPayments` Effect service function with 3-table JOIN (payments, loans, customers), pagination, date range, amount range, and case-insensitive customer name filters — soft-deleted payments always excluded
- Added `listPaymentsAction` Server Action with auth guard calling `Effect.runPromise(listPayments(input))`
- Added partial index `idx_payments_active_date` on `payments(payment_date) WHERE deleted_at IS NULL` inside pgTable definition; generated and applied migration
- Added 6 integration tests covering all required behaviors (PAY-01 through PAY-05 plus soft-delete exclusion); all 166 integration tests and 341 unit tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add types, listPayments service function, listPaymentsAction, and partial index** - `bccc3b5` (feat)
2. **Task 2: Integration tests for listPayments (PAY-01 through PAY-05)** - `f087fb1` (test)

**Plan metadata:** TBD (docs commit)

## Files Created/Modified
- `src/types/index.ts` - Added `ListPaymentsInput` and `PaymentWithCustomer` interfaces
- `src/services/payment.service.ts` - Added `listPayments` Effect function; added customers/drizzle-orm imports
- `src/actions/payment.actions.ts` - Added `listPaymentsAction` Server Action
- `src/lib/db/schema/payments.ts` - Added partial index via pgTable second argument; added `index` and `sql` imports
- `drizzle/0005_polite_makkari.sql` - Migration: CREATE INDEX CONCURRENTLY idx_payments_active_date
- `drizzle/meta/0005_snapshot.json` - Drizzle schema snapshot
- `src/services/__integration__/payment.service.test.ts` - Added `describe("listPayments")` with 6 tests; added `listPayments` to imports
- `src/services/__tests__/payment.service.test.ts` - Added sanity check unit test for `listPayments` export

## Decisions Made
- **Partial index syntax**: Standalone `export const paymentsActiveDateIdx = index(...).on(payments.paymentDate)` caused `JSON.parse(JSON.stringify(undefined))` error in drizzle 0.45.1 (the column's `defaultConfig` was undefined outside the table builder context). Fixed by moving index definition inside `pgTable()` second argument as array — this is the correct pattern for this version.
- **listPayments vs getPaymentsForLoan contracts**: `listPayments` always applies `isNull(deletedAt)` as first condition. `getPaymentsForLoan` intentionally returns all rows including soft-deleted (for loan history display). These are different contracts and must not be merged.
- **dateTo inclusive boundary**: Applied `T23:59:59.999Z` suffix to dateTo before creating the `Date` object so a `dateTo: "2025-01-20"` filter includes payments recorded on January 20.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed partial index definition syntax for drizzle 0.45.1**
- **Found during:** Task 1 (schema + service implementation)
- **Issue:** Plan instructed defining partial index as standalone `export const paymentsActiveDateIdx = index("idx_payments_active_date").on(payments.paymentDate)`. This fails at runtime with `JSON.parse error: undefined is not valid JSON` because `payments.paymentDate.defaultConfig` is `undefined` outside the table builder.
- **Fix:** Moved index definition to pgTable second argument: `pgTable("payments", {...columns}, (table) => [index("idx_payments_active_date").on(table.paymentDate).where(sql\`deleted_at IS NULL\`)])`
- **Files modified:** `src/lib/db/schema/payments.ts`
- **Verification:** `pnpm test` passed with 341/341 after fix
- **Committed in:** `bccc3b5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: index syntax incompatible with drizzle 0.45.1 standalone export)
**Impact on plan:** Necessary correctness fix. No scope creep. Index is functionally identical — same name, same column, same WHERE condition.

## Issues Encountered
- Pre-existing `pnpm build` failure due to `fflate`/`jspdf` dynamic import (`module-not-found` error in pdf.service.ts). This is unrelated to this plan's changes. TypeScript type-checking (`tsc --noEmit`) on our specific files returned zero errors.

## Next Phase Readiness
- `listPayments` service and `listPaymentsAction` are ready for 06-02 (UI plan)
- `ListPaymentsInput` and `PaymentWithCustomer` types are exported and available
- Partial index is applied to production DB via migration 0005

## Self-Check: PASSED
- src/types/index.ts: FOUND
- src/services/payment.service.ts: FOUND
- src/actions/payment.actions.ts: FOUND
- src/lib/db/schema/payments.ts: FOUND
- drizzle/0005_polite_makkari.sql: FOUND
- 06-01-SUMMARY.md: FOUND
- Commit bccc3b5: FOUND
- Commit f087fb1: FOUND

---
*Phase: 06-global-payments-list*
*Completed: 2026-03-23*
