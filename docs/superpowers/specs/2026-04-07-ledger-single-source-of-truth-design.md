# Ledger as Single Source of Truth — Eliminate Cached Payment Columns

**Date:** 2026-04-07
**Status:** Approved

## Problem

The codebase maintains a parallel chain of cached financial columns on the `payments` and `creditor_repayments` tables (`interestPortion`, `principalPortion`, `principalBalanceBefore`, `principalBalanceAfter`) that duplicate data already recorded in the ledger (transactions table). This creates:

1. **Dual-write complexity** — `recalculateFromPayment` + `reconcileDownstreamJournals` exist solely to keep cached columns in sync with ledger journals when upstream payments change.
2. **Divergence risk** — The `editPayment` cross-check is advisory only (`console.warn`), so silent drift is possible.
3. **Several bugs** tied to reading cached columns instead of the ledger.

Additionally, `creditorInvestments.principalBalance` is a dead column (set on insert, never updated).

## Scope

### In Scope
1. Remove cached columns from `payments` table schema
2. Remove cached columns from `creditor_repayments` table schema
3. Remove `principalBalance` from `creditor_investments` table schema
4. Add `getPaymentPortionsFromLedger()` helper to derive interest/principal split per payment from journal entries
5. Update all read paths (list payments, payment history, daily collections, CSV export, receipts) to derive from ledger
6. Remove `recalculateFromPayment()` and `reconcileDownstreamJournals()` functions entirely
7. Simplify `editPayment` and `deletePayment` — reverse old journals, repost new ones, no chain recalculation
8. Fix collateral settlement double-counting (missing `reverseInterestAccrual`)
9. Fix `markPaymentWrong` / `unmarkPaymentWrong` to reverse/repost ledger entries
10. Fix Active Loans "Total Amount" bug (`principalAmount` vs `outstandingBalance`)
11. Update all TypeScript types (`Payment`, `PaymentWithCustomer`, `DailyCollectionRow`, `CreditorRepayment`)
12. Database migration to drop columns

### Out of Scope
- Write-off / bad debt mechanism (future feature)
- Late fee / penalty mechanism (future feature)
- Rate change ledger audit trail (acceptable as-is)

## Design

### 1. New Ledger Query: `getPaymentPortionsFromLedger(paymentIds: string[])`

Add to `transaction.service.ts`. Queries transactions where `referenceType = 'payment'` and `referenceId IN (paymentIds)`, grouped by `referenceId`.

Returns `Map<paymentId, { interestPortion: string, principalPortion: string }>` by:
- Interest portion = sum of credits to "Interest Earned" category for each payment's referenceId
- Principal portion = sum of credits to "Loans Receivable" category for each payment's referenceId

This replaces reading `payments.interestPortion` and `payments.principalPortion` everywhere.

For `principalBalanceAfter`, the approach differs by context:
- **Payment history display**: Compute a running balance by starting with `getLoanBalanceFromLedger(loanId, asOf: loanStartDate)` (which equals the disbursed principal) and subtracting each payment's `principalPortion` in date order. This gives `principalBalanceAfter` for every payment without storing it.
- **Loan status check (fully paid)**: Use `getLoanBalanceFromLedger(loanId)` — if zero, loan is fully paid.

### 2. Similar for Creditor Repayments: `getCreditorRepaymentPortionsFromLedger(repaymentIds: string[])`

Same pattern. Queries transactions where `referenceType = 'creditor_repayment'` and `referenceId IN (repaymentIds)`.

Returns `Map<repaymentId, { interestPortion: string, principalPortion: string }>`.

### 3. Schema Changes

#### `payments` table — drop 4 columns:
- `interestPortion`
- `principalPortion`
- `principalBalanceBefore`
- `principalBalanceAfter`

#### `creditor_repayments` table — drop 4 columns:
- `interestPortion`
- `principalPortion`
- `principalBalanceBefore`
- `principalBalanceAfter`

#### `creditor_investments` table — drop 1 column:
- `principalBalance`

### 4. Write Path Simplification

#### `recordPayment` — minimal changes
- Still computes allocation via `allocatePayment()` (needed to determine interest vs principal split for journal posting).
- Still posts `autoPostInterestEarned` and `autoPostPrincipalRepayment` journals.
- No longer writes `interestPortion`, `principalPortion`, `principalBalanceBefore`, `principalBalanceAfter` to the payments row.
- For loan fully-paid check: use `getLoanBalanceFromLedger(loanId)` after posting journals. If zero, mark fully paid.

#### `editPayment` — major simplification
- Reverse old journals for this payment (using amounts from the ledger via `getPaymentPortionsFromLedger`).
- Recompute allocation with new amount/date.
- Post new journals.
- Check `getLoanBalanceFromLedger` for fully-paid status.
- **Remove**: `recalculateFromPayment` call, `reconcileDownstreamJournals` call, payments chain cross-check.

Why no downstream recalculation is needed: Each payment's journal entries record the actual interest and principal at the time. When a payment is edited, only its own journals change. Downstream payments' journals already reflect their own allocations at their recording time. The ledger balance is always the net of all journals, so it stays correct without replaying the chain.

**Important caveat**: This changes the financial semantics slightly. Currently, editing an earlier payment ripples through and re-allocates all later payments (because the principal balance changes, affecting interest calculations). With ledger-only, each payment's allocation is frozen at recording time. This is actually the correct accounting treatment — a payment recorded on March 1 should reflect the interest accrued as of March 1, regardless of later edits to a January payment. If the business requires retroactive re-allocation, a separate "restate" operation should be built. For now, editing a payment reverses and reposts only that payment's journals.

#### `deletePayment` — major simplification
- Reverse this payment's journals (amounts from ledger).
- Soft-delete the row.
- Check `getLoanBalanceFromLedger` for status update.
- **Remove**: `recalculateFromPayment` call, `reconcileDownstreamJournals` call.

Same semantic note as edit: deleting a payment removes its journals from the ledger, which automatically adjusts the outstanding balance. Downstream payments' allocations are unaffected.

#### `recordCreditorRepayment` — minimal changes
- Still computes allocation, posts journals.
- No longer writes cached columns to `creditor_repayments` row.

### 5. Read Path Changes

#### `listPayments` (payment.service.ts)
- Query payments as before (no cached columns in select).
- Batch-fetch `getPaymentPortionsFromLedger(paymentIds)` for the page of results.
- Merge interest/principal portions into the response.
- For `principalBalanceAfter`: group payments by loanId, fetch `getLoanBalancesFromLedger(loanIds)` for current balances, then compute running balances per loan.

#### `getPaymentsForLoan` (payment.service.ts)
- Same approach: fetch payments, then enrich with ledger-derived portions.

#### `getDailyCollections` (daily-collections.service.ts)
- Fetch payments for the date, batch-fetch portions from ledger, merge.

#### Loan detail payment history (loan-detail-client.tsx)
- Server passes ledger-derived portions alongside payments. The client renders them.
- Remove `paymentsChainBalance` fallback — use `ledgerBalance` only.

#### Payment receipts
- The receipt is shown immediately after recording. The server action returns the allocation from `allocatePayment()` (which it already computes for journal posting). Pass these values back in the response as computed fields (not stored columns).

#### CSV export (PaymentsClient.tsx)
- Uses the same ledger-derived data already in the UI rows.

#### Creditor profile (CreditorProfileClient.tsx)
- Server enriches creditor repayments with ledger-derived portions before passing to client.

### 6. Bug Fixes

#### Fix 1: Collateral settlement double-counting (HIGH)
In `settleWithCollateral` (collateral-settlement.service.ts), add `reverseInterestAccrual(tx, { loanId, paymentDate, actorId })` before posting the interest earned journal entry. This matches the pattern already used in `recordPayment`.

#### Fix 2: `markPaymentWrong` ledger reversal (MEDIUM)
In `markPaymentWrongAction`:
- Fetch the payment's journal amounts from `getPaymentPortionsFromLedger([paymentId])`.
- Post reversal journals (same pattern as `deletePayment`).
- This ensures "wrong" payments don't inflate financial statements.

In `unmarkPaymentWrongAction`:
- Recompute allocation via `allocatePayment()` using current loan state.
- Repost interest earned and principal repayment journals.

#### Fix 3: Active Loans "Total Amount" bug (MEDIUM)
In `ActiveLoansClient.tsx:64`, change:
```tsx
// Before (bug):
const total = new BigNumber(row.principalAmount).plus(new BigNumber(row.unpaidInterest))
// After (fix):
const total = new BigNumber(row.outstandingBalance).plus(new BigNumber(row.unpaidInterest))
```

### 7. Type Changes

```typescript
// Payment — remove 4 fields (they come from InferSelectModel)
// The schema change handles this automatically since Payment = InferSelectModel<typeof payments>

// PaymentWithCustomer — remove interestPortion, principalPortion, principalBalanceAfter
// Replace with a new enriched type:
export interface PaymentWithLedgerData {
  id: string
  loanId: string
  customerId: string
  customerName: string
  paymentDate: Date
  amount: string
  interestPortion: string    // derived from ledger at query time
  principalPortion: string   // derived from ledger at query time
  principalBalanceAfter: string // computed running balance from ledger
  recordedBy: string
  depositLocation: DepositLocation
  createdAt: Date
}

// DailyCollectionRow — same change
export interface DailyCollectionRow {
  paymentId: string
  loanId: string
  customerName: string
  amount: string
  interestPortion: string    // derived from ledger
  principalPortion: string   // derived from ledger
  paymentDate: Date
  depositLocation: DepositLocation
}
```

The interface shapes stay the same from the UI's perspective — the only difference is where the data comes from (ledger join vs stored column).

### 8. Migration Strategy

1. Add the new ledger query helpers.
2. Update all read paths to use ledger-derived values.
3. Update write paths to stop writing cached columns.
4. Remove `recalculateFromPayment` and `reconcileDownstreamJournals`.
5. Generate Drizzle migration to drop columns.
6. Run migration.

The migration is backwards-compatible because:
- We update all code to stop reading/writing the columns before dropping them.
- No data is lost — all financial data is in the ledger.

### 9. Functions to Delete

- `recalculateFromPayment()` — payment.service.ts
- `reconcileDownstreamJournals()` — payment.service.ts
- The ledger cross-check block in `editPayment` (lines 516-527)

### 10. Testing

- All existing Vitest tests for payment recording, editing, deletion must be updated.
- Verify that `listPayments`, `getPaymentsForLoan`, `getDailyCollections` return correct ledger-derived values.
- Verify collateral settlement doesn't double-count interest.
- Verify `markPaymentWrong` reverses ledger entries and `unmarkPaymentWrong` reposts them.
- Verify Active Loans report shows correct "Total Amount" using outstanding balance.
