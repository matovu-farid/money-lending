# Loan Type Abstraction Design

## Summary

Extend the loan model to support three loan types: **Perpetual** (existing), **Fixed Rate**, and **Reducing Balance**. Uses a single-table approach with a `loanType` enum and nullable `termMonths` column. Interest calculation dispatches to type-specific strategies.

## Loan Types

### Perpetual (existing, default)
- No fixed term — loan rolls forward in 30-day cycles until fully paid
- Interest = `balance x dailyRate x max(daysElapsed, minInterestDays)`
- Daily rate = `monthlyRate / 30`
- 30-day minimum interest enforced per period
- No maturity date

### Fixed Rate
- Fixed term of `m` months
- Monthly interest = `originalPrincipal x monthlyRate` (always on original amount, never reduces)
- Monthly principal = `originalPrincipal / termMonths`
- Monthly installment = monthly principal + monthly interest (constant every month)
- Early payoff: remaining principal is due, **plus all remaining interest for the full term**
- At term end: remaining balance due immediately as lump sum

### Reducing Balance
- Fixed term of `m` months
- Monthly interest = `currentBalance x monthlyRate` (recalculated on remaining balance)
- Monthly principal = `originalPrincipal / termMonths` (fixed)
- Monthly installment = monthly principal + monthly interest (decreases over time)
- Early payoff: only owe interest on current balance — paying ahead saves money
- At term end: remaining balance due immediately as lump sum

## Schema Changes

### `loans` table additions

| Column | Type | Notes |
|--------|------|-------|
| `loanType` | enum(`perpetual`, `fixed_rate`, `reducing_balance`) | Default `perpetual` |
| `termMonths` | integer, nullable | Required for fixed_rate and reducing_balance, null for perpetual |

- Migration sets existing loans to `loanType = 'perpetual'`, `termMonths = null`
- Validation: `termMonths` > 0 required for fixed_rate/reducing_balance, must be null for perpetual
- `minInterestDays` and `minPeriodOverride` remain but are only relevant for perpetual loans

### `payments` table — no changes

Existing columns (`interestPortion`, `principalPortion`, `principalBalanceBefore`, `principalBalanceAfter`) work for all three types.

## Interest Engine Strategy

### `allocatePayment()` dispatch

Gains a `loanType` parameter and delegates to:
- `allocatePerpetualPayment()` — existing logic, unchanged
- `allocateFixedRatePayment()` — interest-first on fixed monthly interest amount
- `allocateReducingBalancePayment()` — interest-first on current-balance interest

All three use interest-first allocation. Partial payments accepted; shortfall carries forward.

### New functions

- `calculateSchedule(principal, rate, termMonths, loanType)` — returns full amortization schedule as array of `ScheduleEntry` objects
- `allocateFixedRatePayment(params)` — fixed rate allocation logic
- `allocateReducingBalancePayment(params)` — reducing balance allocation logic

### Updated functions

- `calculateLoanSummary()` — becomes type-aware, returns different preview data per type
- `allocatePayment()` — dispatches to type-specific function

## Service Layer Changes

### Loan Service
- `createLoan()` accepts `loanType` and `termMonths`
- Validates `termMonths` required and > 0 for fixed_rate/reducing_balance, null for perpetual
- All other creation logic unchanged (collateral, issuance fee, audit)

### Payment Service
- `recordPayment()` fetches `loanType`/`termMonths`, passes to `allocatePayment()`
- For fixed_rate/reducing_balance: derives installment number from existing payment count
- `editPayment()` / `deletePayment()` recalculation becomes type-aware
- Overpayment validation per type:
  - **Perpetual:** can't exceed principal + accrued interest
  - **Fixed rate:** can't exceed remaining principal + all remaining term interest
  - **Reducing balance:** can't exceed remaining principal + current period interest

### Dashboard / Overdue Calculations
- `computeOverdue()` becomes type-aware:
  - **Perpetual:** unchanged (`daysOverdue = unpaidInterest / dailyRate`)
  - **Fixed rate / reducing balance:** overdue based on missed installments (payments received < expected for elapsed months)
- Watchlist threshold stays at 30 days

## Types

### New types
```typescript
export type LoanType = "perpetual" | "fixed_rate" | "reducing_balance"

export interface ScheduleEntry {
  month: number
  monthlyPrincipal: string
  monthlyInterest: string
  monthlyInstallment: string
  balanceAfter: string
}
```

### Updated types
- `CreateLoanInput` — add `loanType: LoanType`, `termMonths?: number`
- `LoanListEntry` — add `loanType: LoanType`, `termMonths: number | null`

## UI Changes

### New Loan Form
- Step 1: add **Loan Type** selector (default: Perpetual)
- When fixed_rate/reducing_balance selected: show **Term (months)** input, hide `minInterestDays`
- When perpetual selected: hide term field, show `minInterestDays`
- Step 3 preview adapts:
  - Perpetual: current behavior (daily interest, total at 30-day min)
  - Fixed rate / reducing balance: full amortization schedule table

### Loan List
- Add loan type column/badge to table
- Overdue display works same, calculated differently per type

### Loan Detail
- Show loan type and term months
- For fixed_rate/reducing_balance: show amortization schedule alongside payment history (expected vs actual)

### Customer Detail
- Loan cards show loan type badge
- Payment table within cards unchanged
