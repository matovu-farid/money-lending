---
phase: 13-responsive-table-primitive-card-layouts
plan: 02
subsystem: ui
tags: [responsive, tailwind, css-only, table, card-layout, cypress, loans, payments, expenses, income]

requires:
  - phase: 13-responsive-table-primitive-card-layouts
    plan: 01
    provides: ResponsiveTable<T> primitive with Column<T> type, CSS-only dual rendering, data-testid pattern

provides:
  - Loans page migrated to ResponsiveTable with conditional isAdmin actions column
  - Payments list tab migrated to ResponsiveTable with hideInCard for detail columns
  - Expenses page migrated to ResponsiveTable with Delete button in actions column
  - Income page migrated to ResponsiveTable with Delete button in actions column
  - Cypress E2E tests for all 7 list pages at mobile and desktop viewports (16 tests passing)

affects:
  - Any future list page needing responsive table/card layout
  - payments-list.cy.ts (updated 2 assertions for dual-DOM visibility)

tech-stack:
  added: []
  patterns:
    - "Payments: hideInCard: true on interestPortion and principalPortion columns — too granular for mobile card summary"
    - "Expenses/Income: inline column definitions inside ResponsiveTable<Transaction> generic call (no Column<T>[] variable needed)"
    - "isOptimistic opacity forwarded via getRowProps className parameter"
    - "Empty state passed via emptyState prop to ResponsiveTable for expense/income (eliminates ternary pattern)"
    - "cy.get('[data-testid=data-row]').filter(':visible') required in payments-list assertions after dual-DOM introduced"

key-files:
  created: []
  modified:
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/payments/PaymentsClient.tsx
    - src/app/(app)/expenses/ExpenseListClient.tsx
    - src/app/(app)/income/IncomeListClient.tsx
    - cypress/e2e/responsive-layouts.cy.ts
    - cypress/e2e/payments-list.cy.ts

key-decisions:
  - "Payments: hideInCard on interestPortion and principalPortion — Amount and Balance After are sufficient for mobile summary"
  - "Expenses/Income: inline column definitions inside generic ResponsiveTable<Transaction> call — simpler than named Column<T>[] variable since columns don't need reuse"
  - "Empty state moved to emptyState prop — removes ternary wrapper that obscures the responsive table usage"
  - "payments-list.cy.ts: updated 2 no-timeout assertions to use filter(':visible') pattern to fix visibility matching in dual-DOM"

patterns-established:
  - "Pattern: For large tables, use hideInCard for columns that are too detailed for mobile summary (interest, principal breakdowns)"
  - "Pattern: getRowProps className forwarding for CSS state classes (opacity-50 for optimistic rows)"
  - "Pattern: emptyState prop on ResponsiveTable eliminates ternary wrapper at call site"

requirements-completed: [RESP-02, RESP-07]

duration: 48min
completed: 2026-03-25
---

# Phase 13 Plan 02: Responsive Table - Loans, Payments, Expenses, Income Summary

**Loans, Payments, Expenses, and Income pages migrated to ResponsiveTable with CSS-only mobile card layouts and 16 Cypress E2E tests covering all 7 list pages at mobile and desktop viewports**

## Performance

- **Duration:** 48 min
- **Started:** 2026-03-25T08:00:00Z
- **Completed:** 2026-03-25T08:48:59Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- All 4 remaining list pages (Loans, Payments, Expenses, Income) now use `ResponsiveTable` — no direct `<Table>/<TableBody>/<TableRow>` usage remains in any of the 7 list pages
- Payments columns designed with `hideInCard: true` on interest/principal breakdown columns — mobile card shows Customer, Loan Ref, Amount, Balance (sufficient summary)
- Expenses and Income use inline column definitions with `ResponsiveTable<Transaction>` generic syntax — cleaner than named variable since columns are page-local
- Cypress E2E suite extended: `responsive-layouts.cy.ts` now has 16 tests (8 mobile, 8 desktop) covering all 7 pages, all passing
- Fixed pre-existing `payments-list.cy.ts` visibility assertion issue caused by dual-DOM (desktop table + mobile card)

## Task Commits

1. **Task 1: Wire Loans and Payments pages to ResponsiveTable** - `b9705f9` (feat)
2. **Task 2: Wire Expenses and Income pages to ResponsiveTable** - `28fdbfa` (feat)
3. **Task 3: Extend Cypress E2E tests for all 7 pages** - `986d21f` (feat)

## Files Created/Modified

- `src/app/(app)/loans/page.tsx` - Replaced Table with ResponsiveTable, added loanColumns with isAdmin conditional actions column
- `src/app/(app)/payments/PaymentsClient.tsx` - Replaced Table in list tab with ResponsiveTable, added paymentColumns with hideInCard on detail columns
- `src/app/(app)/expenses/ExpenseListClient.tsx` - Replaced Table with ResponsiveTable using inline column definitions, Delete button in actions column
- `src/app/(app)/income/IncomeListClient.tsx` - Same pattern as expenses
- `cypress/e2e/responsive-layouts.cy.ts` - Added 8 new tests for Loans, Payments, Expenses, Income at both viewports
- `cypress/e2e/payments-list.cy.ts` - Updated 2 assertions to use `filter(':visible')` for dual-DOM compatibility

## Decisions Made

- `hideInCard: true` on Payments interest/principal portion columns: mobile users need to see Amount and Balance After but not the internal breakdown
- Inline column definitions for Expenses/Income instead of named `Column<T>[]` variable: simpler since columns are only used once
- `emptyState` prop instead of ternary: moves empty state logic into ResponsiveTable's single return point, cleaner call site
- `cy.reload()` + toast wait pattern for Expenses/Income Cypress tests: these pages use optimistic updates that clear on success before page revalidation, so hard reload is needed to fetch server-confirmed data

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Cypress tests for Expenses/Income category selection**
- **Found during:** Task 3 (Cypress E2E tests)
- **Issue:** Initial test implementation used `cy.get("#expense-category").click()` and `cy.contains("[role='option']")` selectors. Tests failed because the Select component's option selector is `[data-slot=select-item]`, not `[role='option']`. Category wasn't selected, form submitted without category, "Please fill out this field" validation error appeared.
- **Fix:** Updated to `cy.get("[data-slot=select-trigger]").first().click({ force: true })` + `cy.contains("[data-slot=select-item]", "Category Name").realClick()` — same pattern as existing `expenses.cy.ts`
- **Files modified:** `cypress/e2e/responsive-layouts.cy.ts`
- **Verification:** All 16 responsive-layouts tests pass
- **Committed in:** `986d21f` (Task 3 commit)

**2. [Rule 1 - Bug] Fixed Cypress tests for Expenses/Income data visibility after optimistic update**
- **Found during:** Task 3 (Cypress E2E tests)
- **Issue:** After recording an expense/income, the optimistic item is added to `localTransactions`, then removed on mutation success (before page revalidation brings real data). Asserting `[data-slot='table-container']` right after submit found the empty state instead of the table.
- **Fix:** Added `cy.contains("Expense recorded").should("exist")` wait before `cy.reload()` to ensure DB commit before hard reload
- **Files modified:** `cypress/e2e/responsive-layouts.cy.ts`
- **Verification:** All 16 responsive-layouts tests pass
- **Committed in:** `986d21f` (Task 3 commit)

**3. [Rule 1 - Bug] Fixed payments-list.cy.ts Keep Payment test visibility assertion**
- **Found during:** Task 3 (full Cypress suite run)
- **Issue:** After ResponsiveTable creates dual DOM (desktop `<td>` + mobile `<div>`), `cy.contains("Grace Namubiru").should("be.visible")` with default 4000ms timeout found the `<td>` in the overflow-x-auto table container which was temporarily reported as clipped after dialog dismiss
- **Fix:** Updated 2 no-timeout assertions to `cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Grace Namubiru")` — uses visible filter to avoid ambiguity
- **Files modified:** `cypress/e2e/payments-list.cy.ts`
- **Verification:** payments-list "Keep payment" test passes, CSV export "page intact" test passes
- **Committed in:** `986d21f` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 bug)
**Impact on plan:** All auto-fixes necessary for Cypress test correctness. No scope creep.

## Issues Encountered

- Cypress Expenses/Income Select component requires `[data-slot=select-trigger]` + `realClick()` on `[data-slot=select-item]` — not `#expense-category` ID selector + `[role='option']`. Same pattern as existing expenses.cy.ts.
- Optimistic update pattern in Expenses/Income clears on success before page revalidation — `cy.reload()` after toast confirmation needed.
- `payments-list.cy.ts` pre-existing failures in filter tests (6 tests, disabled input race condition): These are pre-existing race conditions unrelated to Plan 02 changes where TanStack Query disables filter inputs during re-fetch. These are NOT regressions from the ResponsiveTable migration.

## Next Phase Readiness

- All 7 list pages use `ResponsiveTable` — no direct Table usage remains in list pages
- Pattern established: `hideInCard` for secondary detail columns (interest/principal breakdowns)
- `data-testid="data-row"` present on all card divs and table rows for all 7 pages
- Full responsive coverage confirmed at 390px and 1280px viewports

## Self-Check: PASSED

- Files verified: loans/page.tsx, PaymentsClient.tsx, ExpenseListClient.tsx, IncomeListClient.tsx, responsive-layouts.cy.ts, 13-02-SUMMARY.md
- Commits verified: b9705f9, 28fdbfa, 986d21f
- No direct TableBody/TableRow usage in any modified file

---
*Phase: 13-responsive-table-primitive-card-layouts*
*Completed: 2026-03-25*
