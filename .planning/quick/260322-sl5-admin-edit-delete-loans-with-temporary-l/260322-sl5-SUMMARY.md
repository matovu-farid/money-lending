---
phase: quick-260322-sl5
plan: 01
subsystem: loans
tags: [loans, permissions, rbac, audit, edit, delete, server-actions]
dependency_graph:
  requires: []
  provides: [updateLoan, deleteLoan, updateLoanAction, deleteLoanAction, getCurrentUserRoleAction]
  affects: [loan-detail-client, loans-list, loan.service, loan.actions, permissions]
tech_stack:
  added: []
  patterns: [Effect.tryPromise, db.transaction, writeAuditLog, useTransition, canModify-prop-drilling]
key_files:
  created: []
  modified:
    - src/lib/permissions.ts
    - src/types/index.ts
    - src/services/loan.service.ts
    - src/actions/loan.actions.ts
    - src/app/(app)/loans/page.tsx
    - src/app/(app)/loans/[loanId]/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/loans/new/page.tsx
decisions:
  - "Temporary loan officer edit privilege is UI-only (via ?new=1 URL param) — server actions enforce admin+ role check only; no server-side session token for the window"
  - "deleteLoan is a hard delete in FK order: payments -> collateral -> loan; audit log written before deletion to preserve entity data"
  - "Redirect after loan creation changed from /customers/[id] to /loans/[id]?new=1 to enable temporary edit window"
  - "openEditOnMount prop added to LoanDetailClient to auto-open edit dialog when navigating from list with ?edit=1"
metrics:
  duration: "4 min"
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 8
---

# Quick Task 260322-sl5: Admin Edit/Delete Loans with Temporary Loan Officer Window Summary

**One-liner:** Role-gated loan edit/delete with admin+ full access and loan officer temporary one-time window via URL param, backed by hard-delete service functions with FK-ordered deletion and audit logging.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add loan update/delete service functions and server actions | 5c4d607 | permissions.ts, types/index.ts, loan.service.ts, loan.actions.ts |
| 2 | Add edit/delete UI to loans list and loan detail pages | 59e3500 | loans/page.tsx, loans/[loanId]/page.tsx, loan-detail-client.tsx, loans/new/page.tsx |

## What Was Built

### Service Layer (loan.service.ts)

- `updateLoan(input, actorId)` — Effect function that fetches the existing loan, builds a partial set object from provided fields only (principalAmount, interestRate, startDate), runs in `db.transaction` with `writeAuditLog` (action: "loan.update", beforeValue: old loan, afterValue: changed fields + reason), returns updated loan.

- `deleteLoan(input, actorId)` — Effect function that performs a hard delete in FK dependency order: writes audit log first (to capture entity data before deletion), then `DELETE payments`, `DELETE collateral`, `DELETE loans`. Returns the loan that was deleted.

### Server Actions (loan.actions.ts)

- `getCurrentUserRoleAction()` — Returns the session user's role string for client-side role detection without exposing sensitive session data.
- `updateLoanAction(input)` — Admin+ role check, runtime validation (loanId, reason, principalAmount format), calls `updateLoan` Effect.
- `deleteLoanAction(input)` — Admin+ role check, runtime validation (loanId, reason), calls `deleteLoan` Effect.

### Permissions (permissions.ts)

Added "delete" to loan statement and `loanOfficerRole` loan permissions array. adminRole and superAdminRole inherit via spread.

### Types (types/index.ts)

Added `UpdateLoanInput` and `DeleteLoanInput` interfaces.

### UI (loans/page.tsx)

Loans list page now:
- Fetches user role alongside loans via `getCurrentUserRoleAction()`
- Shows an "Actions" column with a MoreHorizontal dropdown (View / Edit / Delete) for admin+ users only
- Includes an inline delete confirmation dialog with reason textarea and optimistic removal from local state

### UI (loans/[loanId]/page.tsx)

Loan detail server component now:
- Gets session and computes `canModify`: true for admin+, true for loan officers only when `?new=1` param is present AND the loan's `issuedBy` matches the current user
- Passes `canModify` and `openEditOnMount` (when `?edit=1` param present) to `LoanDetailClient`

### UI (loans/[loanId]/loan-detail-client.tsx)

Loan detail client now:
- Accepts `canModify` and `openEditOnMount` props
- Shows "Edit Loan" and "Delete Loan" buttons next to "Record Payment" when `canModify` is true
- Edit Loan dialog: pre-fills principalAmount, interestRate (as % display), startDate; requires reason; converts rate back to decimal on submit; toasts + `router.refresh()` on success
- Delete Loan dialog: requires reason; toasts + `router.push("/loans")` on success
- Auto-opens edit dialog on mount if `openEditOnMount` is true
- Uses two separate `useTransition` hooks (loanEdit, loanDelete) for independent in-flight tracking

### New Loan Redirect (loans/new/page.tsx)

After successful loan creation, redirects to `/loans/[id]?new=1` (previously redirected to `/customers/[customerId]`). This enables the loan officer's temporary edit window — once they navigate away or refresh without `?new=1`, the buttons disappear.

## Deviations from Plan

None — plan executed exactly as written with one minor addition: `openEditOnMount` prop to auto-open the edit dialog when navigating from the loans list "Edit" action (`?edit=1`), which was implied by the plan's design but not explicitly spelled out.

## Self-Check: PASSED

All 8 modified files exist on disk. Both task commits (5c4d607, 59e3500) verified in git log. TypeScript compiles clean. 97 Vitest tests pass.
