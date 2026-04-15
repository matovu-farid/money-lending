# Bank Accounts as Sub-Location Ledger Accounts

**Date:** 2026-04-15
**Status:** Draft

## Problem

The app currently treats "Bank" as a single deposit location alongside "Cash on Hand" and "Strong Room". In reality, the business operates multiple bank accounts (e.g., Stanbic Main, Centenary Savings) and needs to track balances, disbursements, payments, and expenses per account. Each bank account should appear as a first-class line item in the ledger and financial documents.

## Requirements

1. Users can create bank accounts with a name/label (e.g., "Stanbic Main Account")
2. Bank accounts are first-class ledger accounts — each has its own balance and appears as a separate line item in financial documents
3. When "Bank" is selected as a deposit location anywhere in the app, an inline dropdown appears to pick the specific bank account
4. Capital can be injected into specific bank accounts via fund transfers
5. Funds can be transferred between bank accounts (and between bank accounts and cash/strong room)
6. All bank account management lives under the Fund Transfers page
7. Follows existing patterns: TanStack DB collections, Effect-based services, server actions, audit logging

## Approach: Sub-Location Model

Bank accounts are modeled as sub-locations within the existing deposit location system. A new `bank_accounts` table stores account metadata. A nullable `subLocationId` column is added to tables that reference deposit locations. When `depositLocation = "bank"`, `subLocationId` points to the specific bank account.

This is extensible — the same pattern could later support sub-locations for cash (e.g., "Office Safe 1") or strong room, though that is out of scope now.

## Data Model

### New `bank_accounts` Table

| Column      | Type      | Constraints              |
|-------------|-----------|--------------------------|
| id          | UUID      | PK, default gen_random   |
| name        | text      | required, unique         |
| isActive    | boolean   | default true             |
| createdBy   | text      | user ID, required        |
| createdAt   | timestamp | default now              |

### New Columns on Existing Tables

**`loans`** — add `subLocationId` (UUID, nullable, FK to `bank_accounts.id`)
- Required when `disbursementSource = "bank"`, null otherwise

**`payments`** — add `subLocationId` (UUID, nullable, FK to `bank_accounts.id`)
- Required when `depositLocation = "bank"`, null otherwise

**`transactions`** — add `subLocationId` (UUID, nullable, FK to `bank_accounts.id`)
- Required when `depositLocation = "bank"`, null otherwise

**`fund_transfers`** — add `fromSubLocationId` and `toSubLocationId` (UUID, nullable, FK to `bank_accounts.id`)
- Required on the respective side when `fromLocation = "bank"` or `toLocation = "bank"`, null otherwise

Constraints are enforced at the application layer (server actions), not DB-level.

## Ledger Treatment

Each bank account is a **first-class ledger account**. They are not grouped under a generic "Bank" row — they appear independently in the ledger, balance sheet, and all financial documents.

Example balance sheet:
```
Assets:
  Cash on Hand        UGX 2,000,000
  Stanbic Main        UGX 5,000,000
  Centenary Savings   UGX 3,000,000
  Strong Room         UGX 1,500,000
```

### Journal Entries

When `depositLocation = "bank"`, journal entries record the specific `subLocationId`. The auto-post functions create entries attributed to the specific bank account. Each bank account's balance is fully traceable through the double-entry system.

### Balance Computation

`getLocationBalances()` is extended to return individual balances per bank account alongside cash and strong room. No aggregate "bank" balance — each account stands alone. Dashboard KPIs and summary views sum them when a total is needed, but the source of truth is per-account.

All balance validation (loan disbursement insufficient funds check, expense recording, fund transfers) checks the specific bank account's individual balance.

## TanStack DB Collection

New `bank-accounts` collection at `src/collections/bank-accounts.ts`:
- Follows existing collection patterns (side-channel maps for pending inserts/updates, `onInsert`/`onUpdate` handlers calling server actions)
- `onInsert` calls `createBankAccountAction`
- `onUpdate` calls `updateBankAccountAction` (rename, deactivate/reactivate)
- Invalidates: `locationBalances`, `bankAccounts`
- Registered in `src/collections/index.ts`
- UI consumes via `useLiveQuery`

## UI Changes

### Fund Transfers Page (`/fund-transfers`)

- New "Bank Accounts" section listing all bank accounts with: name, balance, status (active/inactive), creation date
- "New Bank Account" button (supervisor+) opens dialog with name field
- Each row has "Edit" (rename, supervisor+) and "Deactivate/Reactivate" (admin only) actions
- Inactive accounts show visual indicator (greyed out, badge) but remain visible
- Fund transfer and capital injection dialogs: when "Bank" is selected as from/to location, an inline dropdown appears showing active bank accounts

### Inline Bank Account Dropdown (All Forms)

Everywhere a deposit location select exists, when "Bank" is chosen, a second inline dropdown appears immediately below:

**Affected components:**
- `DisbursementSourceSelect` (loans) — balance validation per-account
- `DepositLocationSelect` (payments, expenses, income)
- Fund transfer dialogs (from and to independently)

**Dropdown behavior:**
- Shows only active bank accounts
- Displays account name and current balance (e.g., "Stanbic Main — UGX 5,000,000")
- If only one active bank account exists, auto-select it but still show the dropdown
- If no bank accounts exist, show message: "No bank accounts configured. Ask a supervisor to create one in Fund Transfers."

### Type Changes

- `DepositLocation` stays as `"cash" | "bank" | "strong_room"` (no enum changes)
- All input types gain optional `subLocationId?: string`:
  - `CreateLoanInput`
  - `RecordPaymentInput`
  - `CreateTransactionInput`
  - `CreateFundTransferInput` (gains `fromSubLocationId?` and `toSubLocationId?`)
  - `CreateCapitalInjectionInput`
- Server actions validate: if `depositLocation = "bank"`, `subLocationId` must be present and reference an active bank account

## Permissions

| Action                    | Required Role |
|---------------------------|---------------|
| Create bank account       | supervisor+   |
| Edit bank account (rename)| supervisor+   |
| Deactivate/Reactivate     | admin only    |
| Select bank account in forms | any role    |

Uses existing `fund-transfer:create` permission for create/edit. Deactivation checks `role === "admin"` directly.

## Audit Logging

All bank account operations logged via `writeAuditLog()`:
- Entity type: `"bank_account"`
- Actions: `create`, `update`, `deactivate`, `reactivate`
- Captures: actor, action, before/after values
- Same pattern as all other entities in the app

## Out of Scope

- Sub-locations for cash or strong room (extensible via the same pattern later)
- Bank reconciliation or automated bank feeds
- Account numbers, account types, branches, or other bank metadata
- Migration of existing data (dev environment — DB can be wiped)
