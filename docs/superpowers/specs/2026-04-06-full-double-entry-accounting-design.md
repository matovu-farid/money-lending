# Full Double-Entry Accounting Ledger

## Overview

Upgrade the transaction ledger from a hybrid single/double-entry model to full double-entry. Every financial event posts both debit AND credit entries. Principal movements use a new `"balance_sheet"` category type so they appear in the journal but are excluded from P&L.

The project is in dev — all data tables will be truncated as part of this change.

## Category Type Extension

Add `"balance_sheet"` to the existing `category_type` enum (`"income" | "expense"` → `"income" | "expense" | "balance_sheet"`).

- **income**: Revenue items (Interest Earned, Issuance Fees) — appear on P&L
- **expense**: Cost items (Salaries, Rent, Interest Payments) — appear on P&L
- **balance_sheet**: Asset/liability movements (disbursements, principal repayments, creditor investments) — appear in transaction journal only, excluded from P&L

## Transaction Entries by Event

### Loan Created

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | debit | Loan Disbursement | balance_sheet | principalAmount | referenceType: "loan" |
| 2 | credit | Issuance Fees | income | issuanceFee | referenceType: "loan" |

The debit represents cash leaving the organization. The credit is fee revenue.

### Payment Received

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | credit | Interest Earned | income | interestPortion | referenceType: "payment" |
| 2 | credit | Principal Repayment | balance_sheet | principalPortion | referenceType: "payment" |

Both entries are credits (money coming in). Interest is income; principal is asset recovery.

### Collateral Settlement

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | credit | Interest Earned | income | accruedInterest | referenceType: "collateral_settlement" |
| 2 | credit | Principal Recovery | balance_sheet | outstandingPrincipal | referenceType: "collateral_settlement" |

Replaces the old "Collateral Recovery" income category with "Principal Recovery" (balance_sheet) for accuracy.

### Loan Rollover

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | credit | Interest Earned | income | carriedInterest | referenceType: "rollover" (old loan) |
| 2 | debit | Loan Disbursement | balance_sheet | new loan principalAmount | referenceType: "loan" (new loan) |

The old loan's interest is recognized as income. The new loan's full principal (fresh + carried) is a new disbursement.

### Creditor Investment Received

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | credit | Creditor Investment | balance_sheet | investmentAmount | referenceType: "creditor_investment" |

Cash received from creditor — liability increase.

### Creditor Repayment

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | debit | Creditor Principal Repaid | balance_sheet | principalPortion | referenceType: "creditor_repayment" |
| 2 | debit | Interest Payments | expense | interestPortion | referenceType: "creditor_repayment" |

Principal repayment reduces liability. Interest is an expense.

### Fund Transfer

| # | Type | Category | Category Type | Amount | Reference |
|---|------|----------|---------------|--------|-----------|
| 1 | debit | Fund Transfer | balance_sheet | amount | referenceType: "fund_transfer" |
| 2 | credit | Fund Transfer | balance_sheet | amount | referenceType: "fund_transfer" |

Self-cancelling pair — net zero effect on totals. Debit = source location, credit = destination.

### Reversals (Deletion / Edit)

All reversals flip the original entry type:
- Original credit → reversal is debit (same category, same amount)
- Original debit → reversal is credit (same category, same amount)

**Loan Deletion**: Reverse disbursement debit + reverse issuance fee credit + reverse all payment entries (interest + principal)

**Payment Deletion**: Reverse interest credit + reverse principal credit. Downstream payments are recalculated and their journal entries reconciled.

**Payment Edit**: Reverse old interest + principal entries, post new entries with recalculated amounts.

## Schema Changes

### 1. category_type enum

```sql
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'balance_sheet';
```

### 2. transactions table — add deposit_location

```sql
ALTER TABLE "transactions" ADD COLUMN "deposit_location" deposit_location;
```

This tracks which fund location (cash/bank/strong_room) is affected by the transaction.

### 3. Truncate all data tables

Since the project is in dev with no production data:

```sql
TRUNCATE TABLE transactions, payments, collateral, loans, creditor_repayments, creditor_investments, creditors, fund_transfers, audit_log, notifications, rate_change_requests CASCADE;
```

## New Default Categories

**Balance Sheet type:**
- Loan Disbursement
- Principal Repayment
- Principal Recovery
- Creditor Investment
- Creditor Principal Repaid
- Fund Transfer

These are auto-created with `isDefault: true` alongside existing income/expense defaults.

## P&L Report Changes

The P&L query in `report.service.ts` must filter to only income and expense categories:

```typescript
// Before: includes ALL transactions
// After: only income/expense
.where(inArray(transactionCategories.type, ["income", "expense"]))
```

Balance sheet entries are excluded from P&L automatically.

## Balance Sheet Validation (Optional)

With full double-entry, the balance sheet can now be cross-validated:

```
Total Credits - Total Debits = Net Position
```

This should approximately equal `Assets - Liabilities` computed from state tables. Any significant discrepancy indicates a data integrity issue.

## Files to Modify

| File | Change |
|------|--------|
| `drizzle/0018_full_double_entry.sql` | Migration: enum value, column, truncate |
| `src/lib/db/schema/transaction-categories.ts` | Add "balance_sheet" to enum |
| `src/lib/db/schema/transactions.ts` | Add depositLocation column |
| `src/types/index.ts` | Update CategoryType union |
| `src/services/loan.service.ts` | Post principal disbursement on create; reverse on delete |
| `src/services/payment.service.ts` | Post principal repayment on payment; reverse on delete/edit; reconcile downstream principal journals |
| `src/services/collateral-settlement.service.ts` | Change "Collateral Recovery" → "Principal Recovery" (balance_sheet) |
| `src/services/creditor.service.ts` | Post creditor investment + principal repayment entries |
| `src/services/fund-transfer.service.ts` | Post paired debit/credit fund transfer entries |
| `src/services/report.service.ts` | Filter P&L to exclude balance_sheet categories |
| `src/services/category.service.ts` | Add new default balance_sheet categories |
| `src/services/transaction.service.ts` | Update autoPostInterestEarned pattern; add autoPostPrincipal helpers |

## Authorization

No new authorization requirements — all transactions are auto-posted by existing authorized actions.
