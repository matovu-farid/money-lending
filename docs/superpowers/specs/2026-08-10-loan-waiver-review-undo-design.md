# Loan Waiver Review and Undo Design

**Date:** 2026-08-10

## Goal

Require an explicit review before a loan amount waiver is saved, display the exact amount and allocation being waived, and let an authorized user undo an individual waiver while restoring a settled loan to the active-loan portfolio when a balance remains.

## Current context

`src/components/loans/waive-loan-dialog.tsx` currently validates the waiver form and immediately inserts an optimistic waiver through `insertWaiverWithInput`. The component already calculates an interest-first/principal-second allocation preview. `src/services/loan-waiver.service.ts` posts the corresponding non-cash ledger entries and moves an economically settled loan to `fully_paid`. The loan deletion service already demonstrates the inverse ledger postings, but there is no individual waiver undo action.

## Design

### Review-before-save flow

The existing drawer becomes a two-state local flow:

1. **Edit:** Enter the waiver amount and required reason. The existing amount validation and allocation preview remain available. Clicking `Review Waiver` only stores the validated values in component state.
2. **Review:** Render a confirmation summary showing the customer/loan context, `Amount Waived` as the emphasized amount, interest portion, principal portion, reason, and the resulting balance impact. `Back` returns to the edit state without writing anything. `Confirm & Waive` is the only action that creates the optimistic row and waits for persistence.

The review summary uses the same client allocation preview already shown in the form. The server continues to validate and allocate again inside the transaction, so the review is advisory and cannot bypass authoritative validation.

### Undo flow

Every active waiver displayed in waiver history has an `Undo` action for users with `loan:waiver`. The action opens a destructive confirmation drawer containing the waiver amount and a warning that the write-down will be reversed. Undo requires a reason of at least 10 characters, matching the existing waiver-reason policy.

The client calls a dedicated `undoLoanWaiverAction` rather than deleting ledger rows. On success it removes the waiver from the live collection, invalidates lending/financial projections, and reports success. Fully paid loans continue to render waiver history for authorized users even though they no longer show the active-loan waiver CTA.

### Transactional service behavior

`undoLoanWaiver` runs in one database transaction:

1. Lock the non-deleted loan row and the non-deleted waiver row with `FOR UPDATE`.
2. Allow only `active` and `fully_paid` loan statuses. Reject missing loans, missing waivers, already-undone waivers, and historical statuses such as `rolled_over` or `settled_with_collateral`.
3. Read the exact interest/principal portions originally posted for the waiver from the ledger.
4. Post inverse journal entries with `referenceType: "loan_waiver_reversal"`:
   - interest: debit `Interest Earned`, credit `Loan Losses`;
   - principal: debit `Loans Receivable`, credit `Loan Losses`.
5. Set the waiver `deletedAt` timestamp so it no longer participates in settlement calculations.
6. If the loan was `fully_paid` and is no longer economically fully paid after the reversal, use `maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId)`.
7. Write an audit entry containing the waiver id, reversed amount, reversal reason, previous status, and resulting status.

The reversal uses stored ledger portions, never a fresh allocation, so later payments or waivers cannot cause an undo to reverse the wrong categories. The row lock and active-row predicate make double-click and retry behavior safe.

### Authorization and cache behavior

The new server action uses the existing `loan:waiver` permission and returns stable user-facing errors for validation and missing/already-undone records. The waiver history read/undo control remains admin-permissioned. After create or undo, invalidate loan balances, operational loans, loan status counts, financial reports, the per-loan waiver query, and emit `loan_waivers`, `transactions`, and `loans` table changes using the established collection invalidation pattern.

## Testing

- Service integration tests prove undo restores principal ledger balance, reverses both ledger portions, marks the waiver deleted, reopens a fully paid loan when appropriate, and rejects undo on a historical loan or an already-undone waiver.
- Action authorization tests prove only users with `loan:waiver` can call undo and validation errors are returned without invoking the service.
- Component tests prove review is shown before collection insertion, Back returns to edit, and the review includes the waived amount.
- Cypress tests cover rendering the waiver CTA/history, review/back/confirm behavior, displayed waived amount, undo confirmation/reason validation, and the loan returning to Active after undoing a full settlement.

## Scope exclusions

No pending-waiver database state is introduced. No new waiver status enum or schema migration is needed; the existing `deletedAt` soft-delete field remains the source of truth for undo history, while the audit log preserves the undo reason.
