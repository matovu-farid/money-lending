---
phase: 04-financial-reporting
plan: 03
subsystem: database
tags: [effect, drizzle, transactions, categories, auto-posting, bignum]

# Dependency graph
requires:
  - phase: 04-01
    provides: transaction_categories and transactions schema tables, type definitions (CreateExpenseInput, CreateIncomeInput, TransactionLogFilters)

provides:
  - category.service.ts with seedDefaultCategories, listCategories, createCategory, deleteCategory, getCategoryByName
  - transaction.service.ts with recordExpense, recordIncome, listTransactions, getTransactionById, deleteTransaction, autoPostInterestEarned, autoPostInterestExpense
  - expenses/actions.ts and income/actions.ts server actions for UI layer
  - Auto-posting wired into payment.service.ts inside db.transaction callback (FINC-01 atomicity)
  - Default category seed script at src/lib/db/seed-categories.ts

affects: [04-04, 04-05, 04-06, 04-07, 04-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "autoPost* functions are plain async (not Effect) — called inside db.transaction callbacks, same Pitfall 7 pattern as writeAuditLog"
    - "autoPostInterestEarned/Expense accept tx as first param so they execute atomically inside parent operation"
    - "Category seed uses check-before-insert (not ON CONFLICT) for clarity and portability"
    - "Auto-post gracefully skips if category not seeded (logs warning) rather than failing the parent payment"

key-files:
  created:
    - src/services/category.service.ts
    - src/services/transaction.service.ts
    - src/app/(app)/expenses/actions.ts
    - src/app/(app)/income/actions.ts
    - src/lib/db/seed-categories.ts
  modified:
    - src/services/payment.service.ts
    - src/services/__tests__/payment.service.test.ts

key-decisions:
  - "autoPost* functions are plain async not Effect — called inside db.transaction where Effect.runPromise is unsafe (Pitfall 7)"
  - "Auto-posting skips gracefully if Interest Earned category not found rather than failing the payment (defensive behavior)"
  - "deleteCategory uses check-before-delete with CategoryInUseError — not DB constraint error — for clean user-facing errors"
  - "editPayment cleanup deletes all auto-posted transactions by referenceType=payment + referenceId=loanId then re-posts updated interest"

patterns-established:
  - "Plain async auto-post functions accept DrizzleTransaction as first param for same-tx atomicity"
  - "Server actions in (app) subdirectories use auth.api.getSession + headers() for auth, same as existing actions"

requirements-completed: [FINC-01, FINC-02, FINC-03]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 04 Plan 03: Transaction Service Summary

**Unified transaction ledger with atomic auto-posting: category service, expense/income CRUD via Effect, and interest-earned auto-post wired inside payment.service.ts db.transaction**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T08:13:35Z
- **Completed:** 2026-03-21T08:17:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Transaction log service with full CRUD, paginated filtering by type/category/date, joined with category name
- Category service with usage protection (CategoryInUseError on delete if referenced), default seed for 5 expense + 3 income categories
- autoPostInterestEarned and autoPostInterestExpense as plain async functions accepting DrizzleTransaction for atomicity
- Auto-posting wired into recordPayment, editPayment (cleanup + re-post), and deletePayment (cleanup) inside db.transaction
- Server Actions for expenses and income (recordExpenseAction, deleteExpenseAction, createExpenseCategoryAction, deleteExpenseCategoryAction and income equivalents)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create category service and transaction service** - `0b70431` (feat)
2. **Task 2: Hook auto-posting into existing payment service and seed default categories** - `4cfd4c6` (feat)

## Files Created/Modified

- `src/services/category.service.ts` - seedDefaultCategories, listCategories, createCategory, deleteCategory, getCategoryByName
- `src/services/transaction.service.ts` - recordExpense, recordIncome, listTransactions, getTransactionById, deleteTransaction, autoPostInterestEarned, autoPostInterestExpense
- `src/app/(app)/expenses/actions.ts` - Server Actions for expense management
- `src/app/(app)/income/actions.ts` - Server Actions for income management
- `src/lib/db/seed-categories.ts` - Seed script for default categories
- `src/services/payment.service.ts` - Auto-posting hooks in recordPayment, editPayment, deletePayment
- `src/services/__tests__/payment.service.test.ts` - Additional tests for auto-posting wiring

## Decisions Made

- **Plain async autoPost* functions:** Called inside Drizzle transaction callbacks where Effect.runPromise causes runtime errors (Pitfall 7). Same pattern as writeAuditLog.
- **Graceful skip on missing category:** autoPost* logs a warning and skips rather than throwing — prevents category seed order from breaking payment recording.
- **CategoryInUseError for delete protection:** Clean typed error instead of relying on DB FK constraint violation, gives better UX in server actions.
- **editPayment cleanup strategy:** Deletes all auto-posts by referenceType+referenceId then re-inserts fresh — simpler and correct vs trying to identify specific row to update.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error: input.loanId does not exist on EditPaymentInput**
- **Found during:** Task 2 (payment.service.ts update)
- **Issue:** Plan's editPayment cleanup used `input.loanId ?? payment.loanId` but EditPaymentInput has no loanId field
- **Fix:** Replaced with `payment.loanId` (already available in closure from the initial payment fetch)
- **Files modified:** src/services/payment.service.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 4cfd4c6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type error)
**Impact on plan:** Minor bug in plan specification. Fix is correct — payment.loanId is the right value.

## Issues Encountered

None — plan executed cleanly.

## Next Phase Readiness

- Transaction ledger service is ready for UI components (Plans 04-05, 04-06)
- autoPostInterestEarned wired and tested — P&L will automatically include interest income from payments
- autoPostInterestExpense available for creditor repayment service (Plan 04-04) to use
- Default categories must be seeded before auto-posting will record transactions: `pnpm tsx src/lib/db/seed-categories.ts`

---
*Phase: 04-financial-reporting*
*Completed: 2026-03-21*
