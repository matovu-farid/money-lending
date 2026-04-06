# Double-Entry Ledger Design

## Problem

The current transaction ledger is single-entry. Each business event posts only one side (either a debit or credit), and the balance sheet compensates by querying operational tables (payments, loans, fund_transfers, creditorInvestments) directly for cash positions. This causes:

1. Every new cash-affecting flow requires a new query in `getBalanceSheetData`
2. The ledger and the direct table queries can drift out of sync
3. No enforced accounting equation (A = L + SE + Rev - Exp)
4. No way to verify that every transaction has a balancing counterpart

## Solution

Convert to true double-entry bookkeeping:
- Every event posts a DR + CR pair linked by a shared `journalGroupId`
- Add proper accounting classification to categories (`asset | liability | equity | revenue | expense`)
- Derive the entire balance sheet from the ledger — no more direct table queries for cash

## Schema Changes

### `transaction_categories` table

Replace the `category_type` enum values:

**Before:** `expense | income | balance_sheet`
**After:** `asset | liability | equity | revenue | expense`

The `type` field directly encodes the accounting classification. Normal balance is derived:
- **DR normal:** asset, expense (increases with debits)
- **CR normal:** liability, equity, revenue (increases with credits)

### `transactions` table

Add one column:

```
journalGroupId: uuid("journal_group_id")  -- nullable, links DR + CR pair
```

Index on `journalGroupId` for pair lookups.

All existing columns remain unchanged: `id`, `type`, `amount`, `categoryId`, `referenceType`, `referenceId`, `description`, `transactionDate`, `recordedBy`, `depositLocation`, `createdAt`.

## Chart of Accounts

### New categories to create

| Category Name | Type | Normal Balance | Purpose |
|---|---|---|---|
| Cash | asset | DR | All physical cash movements (on hand, bank, strong room via depositLocation) |
| Loans Receivable | asset | DR | Outstanding loan principal (replaces "Loan Disbursement") |
| Seized Collateral | asset | DR | Collateral seized from settled loans (replaces "Principal Recovery") |

### Existing categories — type migration

| Category Name | Old Type | New Type |
|---|---|---|
| Interest Earned | income | revenue |
| Issuance Fees | income | revenue |
| Bonuses | income | revenue |
| Share Capital | balance_sheet | equity |
| Rent | expense | expense (unchanged concept) |
| Salaries | expense | expense (unchanged concept) |
| Office Expenses | expense | expense (unchanged concept) |
| Interest Payments | expense | expense (unchanged concept) |
| DStv | expense | expense (unchanged concept) |
| Creditor Investment | balance_sheet | liability |

### Categories to remove

| Category Name | Reason |
|---|---|
| Loan Disbursement | Replaced by "Loans Receivable" (asset) |
| Principal Repayment | Now a CR to "Loans Receivable" (reduces asset) |
| Principal Recovery | Replaced by "Seized Collateral" (asset) |
| Creditor Principal Repaid | Now a DR to "Creditor Investment" (reduces liability) |
| Fund Transfer | Now two Cash entries (DR Cash@to, CR Cash@from) |

"Remove" means: migrate existing transactions to the replacement category, then delete the old category if unused. If there are existing transactions referencing it, keep it but update its type.

## Double-Entry Posting Rules

Every event inserts **two rows** sharing the same `journalGroupId` (a fresh UUID per event). The total DR amount must equal the total CR amount within each group.

### Loan Disbursement (createLoan)

```
DR  Loans Receivable    principalAmount    (depositLocation: disbursementSource)
CR  Cash                principalAmount    (depositLocation: disbursementSource)
```

Cash leaves the location, loan asset is created.

### Issuance Fee (createLoan)

```
DR  Cash                issuanceFee        (depositLocation: disbursementSource)
CR  Issuance Fees       issuanceFee
```

Fee is collected at disbursement — cash comes in, revenue recorded. Only posted if issuanceFee > 0.

### Payment Received — Interest Portion (recordPayment)

```
DR  Cash                interestPortion    (depositLocation: payment.depositLocation)
CR  Interest Earned     interestPortion
```

Only posted if interestPortion > 0.

### Payment Received — Principal Portion (recordPayment)

```
DR  Cash                principalPortion   (depositLocation: payment.depositLocation)
CR  Loans Receivable    principalPortion
```

Cash comes in, loan asset decreases. Only posted if principalPortion > 0.

### Creditor Investment (addInvestment)

```
DR  Cash                amount             (depositLocation: input.depositLocation)
CR  Creditor Investment amount
```

Cash comes in, liability increases.

### Creditor Repayment — Principal (recordCreditorRepayment)

```
DR  Creditor Investment principalPortion
CR  Cash                principalPortion   (depositLocation: input.sourceLocation)
```

Liability decreases, cash goes out. Only posted if principalPortion > 0.

### Creditor Repayment — Interest (recordCreditorRepayment)

```
DR  Interest Payments   interestPortion
CR  Cash                interestPortion    (depositLocation: input.sourceLocation)
```

Expense recorded, cash goes out. Only posted if interestPortion > 0.

### Manual Expense (recordExpense)

```
DR  [Expense Category]  amount
CR  Cash                 amount            (depositLocation: input.depositLocation)
```

Expense recorded, cash goes out.

### Manual Income (recordIncome)

```
DR  Cash                amount             (depositLocation: input.depositLocation)
CR  [Income Category]   amount
```

Cash comes in, revenue recorded.

### Fund Transfer (createFundTransfer)

```
DR  Cash                amount             (depositLocation: toLocation)
CR  Cash                amount             (depositLocation: fromLocation)
```

Cash moves between locations. Same category, different depositLocation.

### Collateral Settlement — Principal (settleWithCollateral)

```
DR  Seized Collateral   outstandingPrincipal
CR  Loans Receivable    outstandingPrincipal
```

Loan asset converts to collateral asset. No cash movement.

### Collateral Settlement — Accrued Interest (settleWithCollateral)

```
DR  Seized Collateral   accruedInterest
CR  Interest Earned     accruedInterest
```

Interest earned recognized, backed by collateral asset. Only posted if accruedInterest > 0.

### Share Capital Contribution

```
DR  Cash                amount             (depositLocation)
CR  Share Capital       amount
```

Cash comes in, equity increases.

### Reversals (delete/edit payment, delete loan)

Post the mirror image of the original pair with the same `journalGroupId` pattern:

```
Original:  DR Cash / CR Interest Earned
Reversal:  DR Interest Earned / CR Cash
```

Reversal entries use `referenceType: "payment_reversal"` or `"loan_reversal"` and the original entry's `transactionDate` (not current date).

### Rollover

Old loan closure — post accrued interest:
```
DR  Loans Receivable    carriedInterest    (new loan absorbs it)
CR  Interest Earned     carriedInterest
```

New loan disbursement — only the fresh cash amount:
```
DR  Loans Receivable    freshAmount + carriedPrincipal + carriedInterest
CR  Cash                freshAmount        (only actual cash disbursed)
CR  Loans Receivable    carriedPrincipal   (old loan principal transferred)
```

Note: the old loan's Loans Receivable balance is zeroed by the CR, and the new loan's full amount is established by the DR. Only `freshAmount` affects Cash.

## Balance Sheet — Ledger-Derived

Replace the entire multi-table `getBalanceSheetData` query with ledger aggregation:

```typescript
// Single query: group by category type and name, apply normal balance rules
const rows = await db
  .select({
    categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
    type: transactions.type,
    depositLocation: transactions.depositLocation,
    totalAmount: sql<string>`SUM(${transactions.amount})`,
  })
  .from(transactions)
  .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
  .where(lte(transactions.transactionDate, asOfDate))
  .groupBy(transactionCategories.name, transactionCategories.type, transactions.type, transactions.depositLocation)

// Apply normal balance rules:
// asset/expense:     balance = SUM(debits) - SUM(credits)
// liability/equity/revenue: balance = SUM(credits) - SUM(debits)
```

### Specific derivations

**Cash** (by location): Filter `categoryName = "Cash"`, group by `depositLocation`. DR adds, CR subtracts (asset normal = DR).

**Loans Outstanding**: Filter `categoryName = "Loans Receivable"`. Net DR - CR balance.

**Seized Collateral**: Filter `categoryName = "Seized Collateral"`. Net DR - CR balance.

**Total Assets**: Cash + Loans Outstanding + Seized Collateral.

**Total Creditor Balances**: Filter `categoryName = "Creditor Investment"`. Net CR - DR balance (liability normal = CR).

**Share Capital**: Filter `categoryName = "Share Capital"`. Net CR - DR balance.

**Retained Earnings**: SUM of all `revenue` type net balances minus SUM of all `expense` type net balances.

**Total Equity**: Share Capital + Retained Earnings.

**Validation**: Total Assets must equal Total Liabilities + Total Equity.

### What this replaces

The current `getBalanceSheetData` queries these tables directly:
- `payments` (for cash received by location)
- `loans` (for disbursements by location and outstanding balances)
- `fundTransfers` (for location-to-location movements)
- `creditorInvestments` / `creditorRepayments` (via `getSystemCapital()`)
- `transactions` (for share capital and retained earnings)

All of these are replaced by a single ledger query. The operational tables remain for business logic but are no longer used for financial reporting.

## P&L Changes

Current P&L queries `inArray(transactionCategories.type, ["income", "expense"])`.

Change to: `inArray(transactionCategories.type, ["revenue", "expense"])`.

Revenue replaces income in the filter. Everything else stays the same.

## Retained Earnings Report Changes

Same change: `["income", "expense"]` → `["revenue", "expense"]`.

## autoPost Functions — Refactoring

### Current functions (single-entry)

Each function inserts one row. They will be replaced by a unified `postJournalEntry` function.

### New function: `postJournalEntry`

```typescript
async function postJournalEntry(
  tx: DrizzleTransaction,
  params: {
    debitCategoryName: string
    debitCategoryType: "asset" | "liability" | "equity" | "revenue" | "expense"
    creditCategoryName: string
    creditCategoryType: "asset" | "liability" | "equity" | "revenue" | "expense"
    amount: string
    referenceType: string
    referenceId: string
    description: string
    transactionDate: Date
    recordedBy: string
    debitDepositLocation?: "cash" | "bank" | "strong_room"
    creditDepositLocation?: "cash" | "bank" | "strong_room"
  }
): Promise<string>  // returns journalGroupId
```

This function:
1. Gets or creates both categories
2. Generates a `journalGroupId`
3. Inserts the DR row
4. Inserts the CR row
5. Returns the `journalGroupId`

### Existing autoPost functions

Replace each with a call to `postJournalEntry`:

| Old Function | Replacement Call |
|---|---|
| `autoPostPrincipalDisbursement` | `postJournalEntry(DR: "Loans Receivable"/asset, CR: "Cash"/asset)` |
| `autoPostInterestEarned` | `postJournalEntry(DR: "Cash"/asset, CR: "Interest Earned"/revenue)` |
| `autoPostPrincipalRepayment` | `postJournalEntry(DR: "Cash"/asset, CR: "Loans Receivable"/asset)` |
| `autoPostPrincipalRecovery` | `postJournalEntry(DR: "Seized Collateral"/asset, CR: "Loans Receivable"/asset)` |
| `autoPostCreditorInvestment` | `postJournalEntry(DR: "Cash"/asset, CR: "Creditor Investment"/liability)` |
| `autoPostCreditorPrincipalRepaid` | `postJournalEntry(DR: "Creditor Investment"/liability, CR: "Cash"/asset)` |
| `autoPostInterestExpense` | `postJournalEntry(DR: "Interest Payments"/expense, CR: "Cash"/asset)` |
| `autoPostFundTransfer` | `postJournalEntry(DR: "Cash"/asset@to, CR: "Cash"/asset@from)` |

The old function signatures are kept as thin wrappers for backward compatibility during migration, then removed.

## Manual Income/Expense Changes

`recordExpense` and `recordIncome` currently post single entries. They must be updated to:

- `recordExpense`: post DR [expense category] / CR Cash, with `depositLocation` for the Cash side
- `recordIncome`: post DR Cash / CR [revenue category], with `depositLocation` for the Cash side

This requires adding a `depositLocation` field to `CreateExpenseInput` and `CreateIncomeInput` types.

## Validation

### Journal group integrity check

A utility function to verify ledger health:

```typescript
// For every journalGroupId: SUM(debits) must equal SUM(credits)
// Flag any groups where they don't match
```

This can be exposed as a "Ledger Health Check" in the reports section or run as a periodic audit.

### Trial Balance

With proper double-entry, a trial balance report becomes trivial:
- Sum all DR normal balances (assets + expenses)
- Sum all CR normal balances (liabilities + equity + revenue)
- They must be equal

## Migration Strategy

1. Add `journalGroupId` column to `transactions` table (nullable)
2. Replace `category_type` enum: add new values, then update existing rows
3. Create new categories ("Cash", "Loans Receivable", "Seized Collateral")
4. Map existing categories to new types
5. Existing single-entry rows keep `journalGroupId = null` (legacy data)
6. All new operations post proper double-entry pairs going forward
7. Update `getBalanceSheetData` to use ledger-derived computation
8. Update P&L and Retained Earnings to use `revenue`/`expense` types
9. Update `recordExpense`/`recordIncome` to require `depositLocation` and post pairs
10. Replace all `autoPost*` functions with `postJournalEntry` calls

## Files Affected

- `src/lib/db/schema/transactions.ts` — add `journalGroupId`
- `src/lib/db/schema/transaction-categories.ts` — update enum
- `src/services/transaction.service.ts` — new `postJournalEntry`, update all autoPost functions, update recordExpense/recordIncome
- `src/services/report.service.ts` — rewrite `getBalanceSheetData`, update P&L/RE type filters
- `src/services/loan.service.ts` — update createLoan, updateLoan, deleteLoan to use new posting
- `src/services/payment.service.ts` — update recordPayment, editPayment, deletePayment, reconcileDownstreamJournals
- `src/services/creditor.service.ts` — update addInvestment, recordCreditorRepayment
- `src/services/collateral-settlement.service.ts` — update settleWithCollateral
- `src/services/fund-transfer.service.ts` — update to post Cash-to-Cash pair
- `src/services/category.service.ts` — update seed defaults, enum references
- `src/types/index.ts` — update CreateExpenseInput, CreateIncomeInput, category type unions
- `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx` — may need minor updates
- `src/app/(app)/reports/pnl/PnlClient.tsx` — no changes needed
- `drizzle/` — new migration file
- Test files — update mocks and assertions

## What Does NOT Change

- `payments`, `loans`, `creditorInvestments`, `creditorRepayments`, `fundTransfers` tables — operational data unchanged
- Payment allocation engine (`src/lib/interest/engine.ts`) — pure math, no ledger awareness
- Loan lifecycle logic (status transitions, rollover, collateral settlement business rules)
- Transaction Log UI — still shows all entries, now with paired entries visible
- Audit log — unchanged
