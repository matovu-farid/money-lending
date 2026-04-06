# Collateral Settlement & Loan Rollover

## Overview

Two features that work together to close out loans through non-cash means and enforce a single active loan per customer.

1. **Collateral Settlement** — close a loan by seizing collateral, writing off the full outstanding balance
2. **Loan Rollover** — close an existing loan by rolling its outstanding balance into a new loan
3. **Single Active Loan Constraint** — prevent a customer from having more than one active loan at a time

## Loan Status Changes

Expand `loan_status` enum from 3 to 5 values:

```
pending | active | fully_paid | settled_with_collateral | rolled_over
```

- `settled_with_collateral` — loan closed by seizing collateral
- `rolled_over` — loan closed by rolling balance into a new loan

Update `LoanStatus` type in `src/types/index.ts` to include new statuses.

## Feature 1: Collateral Settlement

### Flow

1. Supervisor+ navigates to an active loan's detail page
2. Clicks "Settle with Collateral" button
3. Confirmation dialog shows:
   - Outstanding principal balance
   - Accrued unpaid interest
   - Total being written off
   - Collateral nature and description
4. On confirm, a single database transaction executes:
   - Loan status set to `settled_with_collateral`
   - Collateral record updated with `seizedAt` timestamp and `seizedBy` user ID
   - Accrued unpaid interest posted as "Interest Earned" income (credit transaction)
   - Outstanding principal posted as "Collateral Recovery" income (credit transaction, category auto-created if missing)
   - Audit log entry with full breakdown

### Schema Changes

**`collateral` table** — add two columns:

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `seized_at` | `timestamp with time zone` | yes | null |
| `seized_by` | `text` | yes | null |

**`loan_status` enum** — add `settled_with_collateral` value.

### Accounting Entries

| Transaction | Type | Category | Amount | Reference |
|-------------|------|----------|--------|-----------|
| Interest recognized | credit | Interest Earned | accrued unpaid interest | `referenceType: "collateral_settlement"`, `referenceId: loanId` |
| Principal recovered | credit | Collateral Recovery | outstanding principal | `referenceType: "collateral_settlement"`, `referenceId: loanId` |

### Authorization

Requires `supervisor+` role (`ROLE_LEVELS.supervisor` or higher).

## Feature 2: Loan Rollover

### Flow

1. Loan officer starts creating a new loan, selects a customer
2. System detects the customer has an active loan
3. UI shows a banner: "This customer has an active loan (#{loanId}). The existing loan must be rolled over into the new one."
4. Banner displays: outstanding principal, accrued interest, total carry-over amount
5. Officer fills in fresh loan details (new amount, fee, collateral, etc.)
6. On submit (requires supervisor+ for the rollover), a single database transaction executes:
   - **Old loan:**
     - Accrued unpaid interest posted as "Interest Earned" income (credit)
     - Status set to `rolled_over`
     - Audit log: "Rolled over into loan {newLoanId}. Carried principal: X, carried interest: Y"
   - **New loan:**
     - `principalAmount` = fresh disbursement + old outstanding balance (principal + accrued interest)
     - Issuance fee applies to the flat amount entered by officer (unaffected by rollover)
     - Issuance fee posted as "Issuance Fees" income (credit)
     - Collateral created for new loan
     - Audit log: "Created via rollover from loan {oldLoanId}. Fresh amount: X, rolled-over amount: Y"

### Accounting Entries

| Transaction | Type | Category | Amount | Reference |
|-------------|------|----------|--------|-----------|
| Old loan interest recognized | credit | Interest Earned | accrued unpaid interest | `referenceType: "rollover"`, `referenceId: oldLoanId` |
| New loan issuance fee | credit | Issuance Fees | new loan fee | `referenceType: "loan"`, `referenceId: newLoanId` |

The rolled-over principal + interest are not separate transactions — they become part of the new loan's principal amount. The old loan's accounting is closed out by the interest entry, and the new loan carries the combined balance forward.

### Schema Changes

**`loan_status` enum** — add `rolled_over` value.

**`loans` table** — add optional columns for rollover tracking:

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `rolled_over_from` | `uuid` | yes | null | References the old loan this was rolled over from |
| `rollover_amount` | `numeric(15,2)` | yes | null | Amount carried over from old loan (principal + interest) |

These columns are null for non-rollover loans.

### Authorization

Requires `supervisor+` role for the rollover action. If the creating user is only a `loanOfficer`, the UI should indicate that a supervisor must approve/perform the rollover.

## Feature 3: Single Active Loan Constraint

### Enforcement

- **Service layer check** in `createLoan()`: query for existing active loans for the customer
- If an active loan exists and no rollover data is provided: throw `ValidationError` with message directing the user to settle or roll over the existing loan
- If an active loan exists and rollover data is provided: proceed with rollover flow
- If no active loan exists: proceed with normal creation
- Not enforced via DB unique constraint (customer can have multiple historical closed loans)

### UI Behavior

- **New loan form (Step 1):** After customer is selected, check for active loans
- If active loan found: show info banner with loan details and rollover option
- Loan officer can proceed with rollover (if supervisor+) or must ask a supervisor
- If no active loan: proceed normally with no changes to existing flow

## UI Touchpoints

### Loan Detail Page

- "Settle with Collateral" button in the actions area (visible to supervisor+ only, active loans only)
- Confirmation dialog with balance breakdown before executing
- After settlement: status badge shows "Settled with Collateral", collateral section shows seizure date

### New Loan Form

- After customer selection in Step 1: check for active loans
- If active loan exists: rollover banner with balance details and "Include Rollover" toggle
- Review step (Step 3) shows rollover breakdown: fresh amount, carried amount, total principal

### Loan List & Reports

- New status badges: "Settled with Collateral" and "Rolled Over"
- Reports page: filter/group by settlement method
- Rolled-over loans show link to the new loan they were rolled into

### Customer Profile

- Loan history shows all statuses including new ones
- Clear visual distinction between cash-repaid, collateral-settled, and rolled-over loans

## Types

```typescript
// New status values
export type LoanStatus = "active" | "fully_paid" | "settled_with_collateral" | "rolled_over"

// Collateral settlement input
export interface SettleWithCollateralInput {
  loanId: string
  reason: string // required for audit
}

// Rollover data included in CreateLoanInput
export interface RolloverData {
  fromLoanId: string
  carriedPrincipal: string  // outstanding principal from old loan
  carriedInterest: string   // accrued unpaid interest from old loan
}

// Extended CreateLoanInput
export interface CreateLoanInput {
  // ... existing fields ...
  rollover?: RolloverData  // present when rolling over an existing loan
}
```
