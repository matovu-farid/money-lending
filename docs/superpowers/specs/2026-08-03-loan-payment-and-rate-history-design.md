# Payment Submission Guard and Loan Rate History

## Goal

Prevent duplicate payment submissions while the receipt is being prepared, and give administrators a direct, audited way to adjust a loan's interest rate while exposing applied-rate history to every user who can read the loan.

## Current context

- Payment entry exists in both the loan-specific `RecordPaymentForm` and the global `QuickRecordDialog`.
- Both forms persist through the TanStack DB payment collection and wait for `tx.isPersisted.promise` before opening the receipt.
- Rate changes already use a transactional service and write `audit_log` rows for immediate and approved changes. The existing approval workflow must remain intact for non-admin users.
- `loans.interestRateOverride` is nullable and is already the effective-rate marker after a rate change.

## Design

### Payment submission

Each payment form gets a local `isRecording` state with a synchronous early-return guard in the confirmation handler. The guard is set before any asynchronous work and the actual payment button (`Confirm & Record`) is disabled for the complete persistence/receipt handoff. The confirmation dialog's cancel/back controls and the underlying form controls are also disabled while recording so the user cannot start a second submission or mutate the pending details. On persistence failure the guard is cleared and the user can retry; on success the receipt modal replaces the form. Both entry surfaces use the same behavior.

This is a user-interface race guard. The existing server transaction remains the source of truth and continues to validate and lock the loan while recording.

### Administrator rate adjustment

Add a dedicated `loan:rate-adjust` permission granted only to `admin` and `superAdmin`. Remove it from `MANAGING_SUPERVISOR_ELEVATED` so delegated supervisors do not inherit this administrator-only capability. Add a server action protected by that permission that validates a decimal rate strictly between 0 and 1, locks an operational loan, rejects a no-op, updates `interestRateOverride`, resets the accrual baseline through the existing auto-post service, and writes one audit row in the same transaction. The audit entry stores the previous effective rate, new rate, actor ID, and database timestamp.

The existing rate-change request/approval path remains available and is updated to use the same applied-change audit shape where appropriate, so the history query covers both existing changes and new admin adjustments.

### Rate history and UI

Add a loan-specific read action that queries `audit_log` for applied loan-rate-change actions, joins the actor to the user table, parses the stored before/after JSON, and returns newest-first `{ id, fromRate, toRate, actorId, actorName, changedAt }` records. It is protected by `loan:read` and does not expose unrelated audit data.

On the loan detail rate card:

- show an explicit “Rate changed” note when applied history is non-empty;
- show “View rate history” only when applied history is non-empty;
- show an administrator-only “Adjust Interest Rate” action that opens a validated rate form;
- render a history dialog with old rate, new rate, actor, and timestamp.

On the main loans list, show the current monthly rate and a compact “Rate changed” indicator when `interestRateOverride` is non-null. Existing exports and filtering remain unchanged.

### Error handling and consistency

- Non-admin direct calls to the adjustment action return `Forbidden` through the permission wrapper.
- Invalid, unchanged, deleted, or non-operational loans return user-facing validation/not-found errors without changing the loan or writing an audit row.
- Rate update, accrual-baseline adjustment, and audit write occur in one database transaction.
- Query/cache invalidation refreshes the loan list, loan detail, and rate history after an adjustment.

## Testing

- Unit tests prove the new permission mapping and administrator-only action boundary.
- Service tests prove the rate update, exact audit payload, baseline reset, no-op validation, and history mapping for immediate/admin and approved changes.
- Component tests prove both payment confirmation buttons disable during a pending persistence promise, prevent a second call, and re-enable after failure.
- Cypress tests cover payment duplicate-click protection, admin adjustment, non-admin control visibility, list/detail “Rate changed” indicators, conditional history-button visibility, and history contents including actor and timestamp.

## Non-goals

- No new rate-history table or migration; the existing immutable audit log is the source of truth.
- No change to the existing supervisor approval thresholds or request/review workflow.
- No server-side idempotency redesign beyond the existing transaction and client ID behavior.
