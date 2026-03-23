---
phase: 09-design-system-overhaul
plan: "04"
subsystem: typography
tags: [design-system, typography, font-mono, tracking-tight, sovereign-ledger]
dependency_graph:
  requires: [09-03]
  provides: [core-page-typography]
  affects: [dashboard, customers, loans, payments, watchlist]
tech_stack:
  added: []
  patterns:
    - "font-mono tabular-nums on all currency/numeric/timestamp values"
    - "tracking-tight on all h1 page headings"
    - "text-xs font-semibold uppercase tracking-wider text-muted-foreground on page subtitles"
    - "text-right on amount table column headers and cells"
key_files:
  created: []
  modified:
    - src/components/dashboard/kpi-card.tsx
    - src/app/(app)/dashboard/page.tsx
    - src/app/(app)/customers/page.tsx
    - src/app/(app)/customers/[id]/page.tsx
    - src/app/(app)/customers/new/page.tsx
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/new/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/payments/PaymentsClient.tsx
    - src/app/(app)/payments/DailyCollectionsTab.tsx
    - src/app/(app)/payments/QuickRecordDialog.tsx
    - src/app/(app)/watchlist/page.tsx
    - cypress/e2e/customer-crud.cy.ts
    - cypress/e2e/watchlist.cy.ts
decisions:
  - "Watchlist heading renamed from 'Borrower Watchlist' to 'Watchlist' per design spec subtitle copy table"
  - "Cypress tests updated to match new heading copy — not a bug, intentional design system change"
  - "payments-list.cy.ts has 9 pre-existing failures unrelated to typography changes (test setup/teardown issues)"
metrics:
  duration: "32 minutes"
  completed_date: "2026-03-23"
  tasks: 2
  files: 14
---

# Phase 09 Plan 04: Core Page Typography Summary

Sovereign Ledger typography applied across all core user-facing pages: Dashboard, Customers, Loans (list, detail, new), Payments (list, daily, quick-record), and Watchlist. KpiCard component also updated.

## What Was Built

### Task 1: KpiCard + Dashboard
- **kpi-card.tsx**: Label changed to `text-xs font-semibold uppercase tracking-wider text-muted-foreground` (label typography). Value changed to `font-mono tracking-tight tabular-nums` (numeric typography).
- **dashboard/page.tsx**: h1 updated with `tracking-tight`. Subtitle changed from `text-sm text-muted-foreground` to label typography (`text-xs font-semibold uppercase tracking-wider text-muted-foreground`). Activity feed timestamps now use `font-mono`. Activity detail numeric values (amount, interestRate, interestPortion, principalPortion) use `font-mono tabular-nums`.

### Task 2: Core Pages Typography (10 files)
- **customers/page.tsx**: h1 `tracking-tight`, subtitle added ("Customer portfolio overview" in label style). Pagination counts wrapped in `font-mono tabular-nums`.
- **customers/[id]/page.tsx**: h1 `tracking-tight`, subtitle "Customer profile" in label style. Loan principal amount: `font-mono tracking-tight tabular-nums`. Interest rate: `font-mono tabular-nums`. Payment table cells: `text-right font-mono tabular-nums`. Issued date: `font-mono`.
- **customers/new/page.tsx**: h1 `tracking-tight` (form page — no subtitle).
- **loans/page.tsx**: h1 `tracking-tight`, subtitle added ("Active and historical loans"). Amount column header `text-right`. Principal and interest rate cells: `text-right font-mono tabular-nums`. Date cell: `font-mono tabular-nums`. Loan ID slug: `font-mono text-xs tabular-nums`.
- **loans/new/page.tsx**: h1 `tracking-tight`. Review step numeric values (principal, dates, interest rate, calculated amounts): `font-mono tabular-nums`.
- **loan-detail-client.tsx**: Customer name heading: `tracking-tight`. Summary fields (principal, interest rate, date): `font-mono tabular-nums`. Outstanding balance: `font-mono tracking-tight tabular-nums`. Payment table: amount column headers `text-right`, all amount/date cells `font-mono tabular-nums`.
- **PaymentsClient.tsx**: h1 `tracking-tight`, subtitle added ("Payment history and collections"). Payment table: amount headers `text-right`, amount/date/loan-ref cells `font-mono tabular-nums`. Pagination counts: `font-mono tabular-nums`.
- **DailyCollectionsTab.tsx**: Collections table: amount headers `text-right`, amount/time cells `font-mono tabular-nums`. Due Today table: balance header `text-right`, balance/date cells `font-mono tabular-nums`.
- **QuickRecordDialog.tsx**: Success state payment amount wrapped in `font-mono tabular-nums`.
- **watchlist/page.tsx**: h1 renamed to "Watchlist" (from "Borrower Watchlist") and given `tracking-tight`. Subtitle added ("Overdue and at-risk loans" in label style). Amount column headers `text-right`. All amount/date cells `font-mono tabular-nums`.

## Test Results

All 25 tests pass across 4 Cypress spec files:
- `dashboard.cy.ts`: 6/6 passing
- `customer-crud.cy.ts`: 12/12 passing (updated assertion for "Customer profile" lowercase)
- `loans-list.cy.ts`: 3/3 passing
- `watchlist.cy.ts`: 4/4 passing (updated assertions for "Watchlist" heading)

Note: `payments-list.cy.ts` has 9 pre-existing failures (test setup/teardown issues with disabled inputs and overflow-clipped elements) that existed before this plan's execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cypress test text assertions updated to match new design system copy**
- **Found during:** Task 2 verification
- **Issue:** `customer-crud.cy.ts` checked for "Customer Profile" (capital P) but the design spec uses "Customer profile" (lowercase). `watchlist.cy.ts` checked for "Borrower Watchlist" but the design spec uses "Watchlist" as the heading text.
- **Fix:** Updated both test files to use the correct subtitle/heading text per the design spec.
- **Files modified:** `cypress/e2e/customer-crud.cy.ts`, `cypress/e2e/watchlist.cy.ts`
- **Commit:** aa332f4

## Self-Check: PASSED

All modified files confirmed present on disk. Both task commits confirmed in git history:
- `4ad6f8c`: Task 1 (KpiCard + Dashboard)
- `aa332f4`: Task 2 (Core page typography)
- SUMMARY.md created at expected path
