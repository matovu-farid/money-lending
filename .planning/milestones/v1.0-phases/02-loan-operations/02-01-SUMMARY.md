---
phase: 02-loan-operations
plan: 01
subsystem: payment-engine
tags: [payments, interest-allocation, tdd, soft-delete, audit-log, effect, server-actions]
dependency_graph:
  requires:
    - src/lib/interest/engine.ts (calculateInterest, formatAmount)
    - src/services/audit.service.ts (writeAuditLog)
    - src/lib/db/schema/loans.ts (loans table)
    - src/lib/errors.ts (DatabaseError, LoanNotFound)
    - src/types/index.ts (Payment, Loan types)
  provides:
    - src/lib/interest/engine.ts (allocatePayment function)
    - src/services/payment.service.ts (recordPayment, editPayment, deletePayment, getPaymentsForLoan)
    - src/actions/payment.actions.ts (recordPaymentAction, editPaymentAction, deletePaymentAction)
  affects:
    - Plans 02-02, 02-03 (receipt pages and loan detail UI depend on payment service)
tech_stack:
  added: []
  patterns:
    - TDD: allocatePayment written test-first with 6 RED->GREEN test cases
    - Effect.tryPromise wrapping async DB operations (matches loan.service.ts pattern)
    - db.transaction() for atomic multi-step mutations (insert + status update + audit)
    - writeAuditLog(tx, ...) called with direct await inside transaction (not Effect.runPromise)
    - Soft delete via deletedAt/deletedBy/deleteReason columns on payments table
    - isNull(payments.deletedAt) filter on all active payment queries
    - Recalculation cascade replays allocatePayment() chronologically from modified payment
key_files:
  created:
    - src/services/payment.service.ts
    - src/services/__tests__/payment.service.test.ts
    - src/actions/payment.actions.ts
    - drizzle/0001_burly_nextwave.sql
  modified:
    - src/lib/interest/engine.ts (added allocatePayment, PaymentAllocation type)
    - src/lib/interest/index.ts (added allocatePayment, PaymentAllocation to exports)
    - src/lib/interest/__tests__/engine.test.ts (added 6 allocatePayment test cases)
    - src/lib/db/schema/payments.ts (added editReason, deletedAt, deletedBy, deleteReason)
    - src/lib/errors.ts (added PaymentNotFound, ReceiptBlockedError)
    - src/types/index.ts (added RecordPaymentInput, EditPaymentInput, DeletePaymentInput)
decisions:
  - "allocatePayment takes params object (not positional args) for clarity with 5 inputs"
  - "recalculateFromPayment is internal (not exported) — called only from editPayment and deletePayment"
  - "deletePayment reverts loan to pending if no active payments remain after deletion"
  - "db:migrate failed with exit code 1 due to pre-existing schema NOTICE messages; used drizzle-kit push to apply migration successfully"
metrics:
  duration: 7 min
  completed_date: "2026-03-21"
  tasks: 2
  files_changed: 10
---

# Phase 02 Plan 01: Payment Allocation Engine + Service Layer Summary

Pure `allocatePayment()` function with TDD tests, full payment service CRUD with soft-delete/recalculation cascade/audit logging, and Server Actions wiring the service to the frontend.

## Tasks Completed

### Task 1: TDD allocatePayment engine + schema updates + error types

**RED:** Added `allocatePayment` import to engine.test.ts and 6 failing test cases covering LOAN-08 (interest-first), LOAN-09 (any amount), LOAN-10 (min period enforcement). All 6 failed as expected.

**GREEN:** Implemented `allocatePayment()` in engine.ts using existing `calculateInterest` and `formatAmount`. Exported `PaymentAllocation` type from barrel index.ts. All 18 tests pass.

Added to schema, errors, and types:
- `payments.ts`: `editReason`, `deletedAt`, `deletedBy`, `deleteReason` soft-delete columns
- `errors.ts`: `PaymentNotFound` and `ReceiptBlockedError` tagged error classes
- `types/index.ts`: `RecordPaymentInput`, `EditPaymentInput`, `DeletePaymentInput` interfaces
- DB migration `0001_burly_nextwave.sql` generated and applied via `drizzle-kit push`

**Commit:** b5eca6d

### Task 2: Payment service layer with recordPayment, editPayment, deletePayment

Created `payment.service.ts` following the exact `loan.service.ts` Effect pattern:

- `recordPayment`: fetches loan, computes principalBalanceBefore/daysElapsed, calls allocatePayment(), inserts payment in tx, handles pending->active and active->fully_paid status transitions, writes audit log
- `editPayment`: validates payment exists and not soft-deleted, updates fields with reason, runs recalculation cascade from modified payment, updates loan status, writes audit log
- `deletePayment`: soft-deletes (never hard), runs cascade from first payment after deletion, handles loan status reversion to pending if no payments remain, writes audit log
- `getPaymentsForLoan`: returns all payments including soft-deleted for UI display
- `recalculateFromPayment` (internal): replays allocatePayment() chronologically inside the same transaction

Created `payment.actions.ts` Server Actions:
- Auth check on all three actions
- Runtime string validation (loanId, amount format, paymentId, reason)
- Permission check for edit/delete: must be own payment OR admin+ role
- `revalidatePath` after successful mutations

Created `payment.service.test.ts`: 7 export/type tests + 9 DB integration todos (no test DB in CI).

All 31 tests pass. TypeScript compiles without errors (pre-existing cypress type issues excluded).

**Commit:** 9e2d0f5

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type error on paymentDate in editPayment**
- **Found during:** Task 2 (tsc --noEmit check)
- **Issue:** `updates.paymentDate = new Date(input.paymentDate) as unknown as string` — type cast was incorrect; the updates object type needed to explicitly declare `paymentDate?: Date`
- **Fix:** Changed updates type annotation to `{ updatedAt: Date; editReason: string; amount?: string; paymentDate?: Date }` and removed the cast
- **Files modified:** src/services/payment.service.ts
- **Commit:** included in 9e2d0f5

**2. [Rule 3 - Blocking] db:migrate exit code 1 despite successful SQL**
- **Found during:** Task 1 migration step
- **Issue:** `pnpm db:migrate` exited with code 1 due to NOTICE messages about pre-existing `drizzle` schema and `__drizzle_migrations` table. The actual ALTER TABLE statements were correct.
- **Fix:** Used `drizzle-kit push` to apply schema changes directly. Columns verified as present in DB.
- **Files modified:** None (infrastructure only)

## Self-Check: PASSED

All files exist and commits are present:
- src/services/payment.service.ts: FOUND
- src/actions/payment.actions.ts: FOUND
- src/services/__tests__/payment.service.test.ts: FOUND
- Commit b5eca6d (Task 1): FOUND
- Commit 9e2d0f5 (Task 2): FOUND
- allocatePayment in engine.ts: FOUND
- PaymentAllocation type: FOUND
- deletedAt soft-delete column: FOUND
- PaymentNotFound error type: FOUND
