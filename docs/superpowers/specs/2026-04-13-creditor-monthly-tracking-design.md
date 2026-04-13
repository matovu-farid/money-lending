# Creditor Monthly Payment Tracking

**Date**: 2026-04-13
**Status**: Approved

## Overview

Admins need visibility into monthly obligations to creditors (who are lenders to the business — liabilities). This feature adds a monthly interest due column to the creditors list, a monthly summary tab on each creditor's profile, and fixes the default interest rate and navigation UX.

## Changes

### 1. Default Interest Rate Fix

Change the default `interestRateMonthly` in `creditors/new/page.tsx` from `"10"` to `"3"` (3% per month).

### 2. Back Button on New Creditor Form

Add a back button (with left arrow icon) at the top of the new creditor form page, navigating to `/creditors`. Remove the existing "Cancel" link at the bottom since the back button replaces it.

### 3. "Monthly Interest Due" Column on Creditors List

Add a column to the creditors table showing the interest owed to each creditor this month.

**Calculation**: For each creditor, sum across all their investments: `principal_balance × monthly_rate`. Principal balance is derived from the ledger (same source as the dashboard KPIs).

**Data flow**:
- New service function `getCreditorMonthlyInterestDue()` returns a `Map<creditorId, string>` of monthly interest amounts
- Uses `getCreditorBalancesFromLedger` for principal balances and joins with `creditorInvestments` for rates
- Creditors list page fetches this alongside existing queries
- `CreditorsTable` accepts enriched data with `monthlyInterestDue` field
- New column renders formatted currency

### 4. Monthly Summary Tab on Creditor Profile

Add a third tab "Monthly Summary" to `CreditorProfileClient` alongside "Investments" and "Repayments".

**Table columns**:
| Month | Interest Due | Interest Paid | Principal Paid | Total Paid | Remaining Balance |
|-------|-------------|---------------|----------------|------------|-------------------|

**Computation** — new `getCreditorMonthlySummary(creditorId)` service function:

1. Fetch all investments for the creditor (with their rates and dates)
2. Fetch all repayments with their interest/principal allocation (from ledger transactions)
3. Walk through months from earliest investment date to current month
4. For each month:
   - **Interest Due**: Sum of `principal_balance_at_start_of_month × monthly_rate` across all investments
   - **Interest Paid**: Sum of interest portions of repayments made that month
   - **Principal Paid**: Sum of principal portions of repayments made that month
   - **Total Paid**: Interest Paid + Principal Paid
   - **Remaining Balance**: Previous balance − Principal Paid
5. Return array sorted newest month first

**Repayment allocation**: Repayments apply interest-first, then principal (already handled by the `allocatePayment` engine). The ledger entries from `autoPostInterestExpense` and `autoPostCreditorPrincipalRepaid` are the source of truth for splits.

### 5. Ledger Integration

No new ledger posting logic needed. The existing `recordCreditorRepayment` flow already posts:
- Interest expense via `autoPostInterestExpense`
- Principal reduction via `autoPostCreditorPrincipalRepaid`

Both the monthly summary and the list column read from existing ledger data.

## Files to Modify

- `src/app/(app)/creditors/new/page.tsx` — default rate, back button
- `src/app/(app)/creditors/creditors-table.tsx` — new column
- `src/app/(app)/creditors/page.tsx` — fetch monthly interest due
- `src/app/(app)/creditors/[id]/page.tsx` — pass monthly summary data
- `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx` — new tab
- `src/services/creditor.service.ts` — `getCreditorMonthlyInterestDue`, `getCreditorMonthlySummary`
- `src/actions/creditor.actions.ts` — expose new service functions as actions
- `src/types/creditor.ts` — new types for monthly summary
- `src/hooks/query-keys.ts` — new query key for monthly summary

## Non-Goals

- No new creditor repayment workflow changes (existing flow is correct)
- No changes to how interest is calculated or allocated
- No new reports pages (this lives on existing creditor pages)
