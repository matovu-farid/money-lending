---
phase: 03-operational-management
plan: "02"
subsystem: ui
tags: [react, drizzle, effect, bignumber, base-ui, customer-management]

requires:
  - phase: 03-01
    provides: watchlist OverdueBadge, Interest Engine, overdue detection foundation
  - phase: 02-loan-operations
    provides: loan services, payment services, audit log pattern

provides:
  - searchCustomers service with name/status/daysRemaining filters and SQL pagination
  - changeCustomerStatus service with atomic tx and audit log
  - searchCustomersAction and changeCustomerStatusAction Server Actions
  - Blacklist safeguard in createLoan (ValidationError if customer.status === 'blacklisted')
  - CustomerSearchBar component with debounced name search and 3 filter dropdowns
  - Customer list page with server-side pagination (Previous/Next)
  - Customer profile with interactive status change dialog (reason >= 10 chars)
  - Full loan history with expandable payment cards and OverdueBadge

affects:
  - 03-03 (dashboard uses searchCustomers pattern)
  - 03-04 (notifications may reference customer status changes)

tech-stack:
  added: []
  patterns:
    - "daysRemainingFilter post-filter: fetch all matching rows, apply Interest Engine in-process, paginate result (O(customers*loans*payments) — acceptable for current volumes)"
    - "Status change dialog: Select onValueChange -> pendingStatus -> Dialog confirmation with reason textarea"
    - "Expandable loan card: toggle on click, lazy-load payments via getPaymentsByLoanAction, recalculate daysOverdue with fetched payments"

key-files:
  created:
    - src/components/customers/customer-search-bar.tsx
  modified:
    - src/services/customer.service.ts
    - src/services/loan.service.ts
    - src/actions/customer.actions.ts
    - src/actions/payment.actions.ts
    - src/app/(app)/customers/page.tsx
    - src/app/(app)/customers/[id]/page.tsx
    - src/lib/auth.ts

key-decisions:
  - "daysRemainingFilter uses in-process Interest Engine post-filter (not SQL column) — documented scaling concern in comments"
  - "getPaymentsByLoanAction added to payment.actions.ts for lazy-load on expand — includes soft-deleted payments"
  - "pendingVerifications Map exported from auth.ts — required by Cypress E2E test route that was failing TypeScript check"

patterns-established:
  - "CustomerSearchBar: debounceRef pattern for name input (300ms), immediate onValueChange for Select dropdowns"
  - "Loan history card: lazy-load payments on first expand, cache in component state on subsequent expands"

requirements-completed: ["CUST-05", "CUST-06", "CUST-07"]

duration: 25min
completed: "2026-03-21"
---

# Phase 03 Plan 02: Customer Search, Filtering, Status Management, and Loan History Summary

**Customer search with daysRemaining post-filter via Interest Engine, server-side pagination, inline status change dialog with audit log, and expandable loan history cards with payment breakdown**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-21T07:00:00Z
- **Completed:** 2026-03-21T07:25:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- searchCustomers service with name ilike, status inArray, and daysRemainingFilter via Interest Engine post-filter (due_within_30 / overdue_30_plus)
- Customer list page rebuilt with CustomerSearchBar (debounced name, 3 Select filters, Clear filters button) and Previous/Next pagination
- Customer profile with interactive status Select triggering confirmation Dialog (reason min 10 chars, Blacklist uses destructive styling), audit log written on status change
- Loan history section shows all loans as expandable cards — payments lazy-loaded on expand, OverdueBadge computed via Interest Engine
- Blacklist safeguard in createLoan: ValidationError if customer.status === 'blacklisted'

## Task Commits

1. **Task 1: searchCustomers + changeCustomerStatus service, actions, blacklist safeguard** - `9eacd78` (feat)
2. **Task 2: Rebuild customers page with search, filter, pagination** - `1d54862` (feat)
3. **Task 3: Customer profile status change dialog and full loan history** - `61fdc36` (feat)

## Files Created/Modified

- `src/services/customer.service.ts` - Added searchCustomers (with Interest Engine daysRemainingFilter) and changeCustomerStatus (atomic tx + audit)
- `src/services/loan.service.ts` - Added blacklist safeguard in createLoan (ValidationError for blacklisted customers)
- `src/actions/customer.actions.ts` - Added searchCustomersAction and changeCustomerStatusAction
- `src/actions/payment.actions.ts` - Added getPaymentsByLoanAction (includes soft-deleted payments)
- `src/components/customers/customer-search-bar.tsx` - New client component with debounced name, 3 filter dropdowns, Clear filters button
- `src/app/(app)/customers/page.tsx` - Rebuilt with CustomerSearchBar, searchCustomersAction, pagination
- `src/app/(app)/customers/[id]/page.tsx` - Status change dialog, full loan history with expandable payment cards
- `src/lib/auth.ts` - Added pendingVerifications Map export (pre-existing missing export fix)

## Decisions Made

- daysRemainingFilter uses in-process Interest Engine post-filter — days overdue is not a DB column; documented scaling concern (O(customers*loans*payments)) in code comments
- getPaymentsByLoanAction added to payment.actions.ts for lazy-load on card expand; includes soft-deleted for complete history view
- pendingVerifications Map exported from auth.ts: test route `src/app/api/test/verification-url/route.ts` was importing a non-existent export causing TypeScript build failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed missing `pendingVerifications` export from auth.ts**
- **Found during:** Task 3 (build verification)
- **Issue:** `src/app/api/test/verification-url/route.ts` imported `pendingVerifications` from `@/lib/auth` but this export did not exist — TypeScript build was failing with "Module has no exported member"
- **Fix:** Added `export const pendingVerifications = new Map<string, string>()` to auth.ts with comment explaining its purpose (Cypress E2E test store)
- **Files modified:** src/lib/auth.ts
- **Verification:** `pnpm build` passes TypeScript check
- **Committed in:** `61fdc36` (Task 3 commit)

**2. [Rule 2 - Missing Critical] Added `getPaymentsByLoanAction` to payment.actions.ts**
- **Found during:** Task 3 (customer profile implementation)
- **Issue:** Plan required fetching payments per loan in loan history, but no action existed
- **Fix:** Created `getPaymentsByLoanAction(loanId)` that returns all payments including soft-deleted
- **Files modified:** src/actions/payment.actions.ts
- **Verification:** Build passes; customer profile lazy-loads payments on card expand
- **Committed in:** `61fdc36` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both fixes required for correctness and build. No scope creep.

## Issues Encountered

- Linter reverted customer profile page write twice during Task 3 — rewrote using Write tool each time; also required fixing TypeScript error (`result.data` possibly undefined inside `if ("data" in result)` check)

## Next Phase Readiness

- Customer management fully operational: search, filter, pagination, status change, loan history
- Blacklist safeguard active in loan issuance
- All CUST-05, CUST-06, CUST-07 requirements satisfied

---
*Phase: 03-operational-management*
*Completed: 2026-03-21*
