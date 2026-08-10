# Loan Waiver Review and Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a review-before-save waiver flow and an authorized per-waiver undo that reverses ledger effects and reopens a settled loan when a balance remains.

**Architecture:** Keep review state local to the existing waiver drawer and persist only after explicit confirmation. Add a transactional `undoLoanWaiver` service/action that reverses the original ledger portions, soft-deletes the waiver, and conditionally changes `fully_paid` to `active`; update the TanStack collection/UI to invalidate and render the result.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM/PostgreSQL, TanStack DB collections, Vitest, Cypress, existing ledger and permission services.

---

## File map

- Modify `src/types/loan-waiver.ts`: add the undo input and service result types.
- Modify `src/services/loan-waiver.service.ts`: add the transactional undo operation and exact ledger reversal.
- Modify `src/actions/loan-waiver.actions.ts`: expose and authorize undo, validate the undo input, and revalidate the loan route.
- Modify `src/collections/loan-waivers.ts`: expose shared invalidation and a persisted undo helper for the UI.
- Modify `src/components/loans/waive-loan-dialog.tsx`: split edit/review state, add undo confirmation, and render undo controls in history.
- Modify `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`: show waiver history for authorized admins on `fully_paid` loans and wire undo/create permissions separately.
- Modify `src/services/__integration__/loan-waiver.service.test.ts`: add red/green service tests for reversal, status restoration, and rejection cases.
- Modify `src/actions/__tests__/authorization.test.ts`: add undo permission and validation coverage.
- Modify `cypress/e2e/loan-detail.cy.ts`: add end-to-end waiver review, amount display, undo, and active-loan restoration coverage.

## Task 1: Define the undo contract and write failing service tests

**Files:**
- Modify: `src/types/loan-waiver.ts`
- Test: `src/services/__integration__/loan-waiver.service.test.ts`

- [ ] **Step 1: Add the typed undo input and result.**

Add:

```ts
import type { LoanStatus } from "./loan"

export interface UndoLoanWaiverInput {
  waiverId: string
  reason: string
}

export interface UndoLoanWaiverResult {
  loanId: string
  waiverId: string
  reversedAmount: string
  interestPortion: string
  principalPortion: string
  previousStatus: LoanStatus
  status: LoanStatus
  txid: number
}
```

- [ ] **Step 2: Write the full-waiver undo integration test.**

Seed a `1,000,000` loan, waive `1,000,000`, assert the loan is `fully_paid`, call `undoLoanWaiver({ waiverId, reason: "Customer settlement correction reviewed" }, actor)`, then assert:

```ts
expect(result.waiverId).toBe(waiver.id)
expect(result.reversedAmount).toBe("1000000.00")
expect(result.previousStatus).toBe("fully_paid")
expect(result.status).toBe("active")
expect((await getLoanBalancesFromLedger([loan.id])).get(loan.id)?.toFixed(0)).toBe("1000000")
```

Also query the waiver and assert `deletedAt` is not null.

- [ ] **Step 3: Write the partial interest/principal reversal test.**

Create an accrued-interest loan, waive an amount spanning interest and principal, undo it, query `getWaiverPortionsFromLedger` and the transaction rows, and assert the active waiver is gone and two `loan_waiver_reversal` journal groups exist with the exact interest/principal amounts and inverse category/type pairs.

- [ ] **Step 4: Write rejection tests before implementation.**

Add tests that undoing a missing waiver, an already-deleted waiver, or a waiver on `rolled_over`/`settled_with_collateral` returns the corresponding validation/not-found error and creates no reversal transactions.

- [ ] **Step 5: Run the new tests and verify they fail for the missing service.**

Run:

```bash
pnpm exec vitest run --config vitest.integration.config.ts src/services/__integration__/loan-waiver.service.test.ts
```

Expected: the new tests fail because `undoLoanWaiver` is not exported/implemented; existing waiver tests remain runnable.

## Task 2: Implement the transactional undo service

**Files:**
- Modify: `src/services/loan-waiver.service.ts`
- Test: `src/services/__integration__/loan-waiver.service.test.ts`

- [ ] **Step 1: Add the locked loan/waiver lookup.**

Inside `db.transaction`, select the non-deleted loan by waiver’s loan id and the non-deleted waiver by id with `for("update")`. Throw `{ _tag: "LoanNotFound" }` for a missing/deleted loan, `{ _tag: "WaiverNotFound" }` for a missing/deleted waiver, and `{ _tag: "ValidationError", message: "Loan waiver can only be undone on active or fully paid loans", field: "status" }` for historical statuses.

- [ ] **Step 2: Reverse exact stored portions.**

Call `getWaiverPortionsFromLedger([waiver.id], tx)`. For a positive interest portion call `postJournalEntry` with:

```ts
{
  debitCategory: { name: "Interest Earned", type: "revenue" },
  creditCategory: { name: "Loan Losses", type: "expense" },
  amount: portion.interestPortion,
  referenceType: "loan_waiver_reversal",
  referenceId: waiver.id,
  description: `Reversal - interest waiver for loan ${shortId(loan.id).toUpperCase()}: ${input.reason.trim()}`,
  transactionDate: new Date(waiver.waiverDate),
  recordedBy: actorId,
  loanId: loan.id,
}
```

For a positive principal portion, use the same shape with debit `Loans Receivable`, credit `Loan Losses`, and a principal description.

If the ledger lookup has no entry for the waiver, throw `{ _tag: "ValidationError", message: "Waiver ledger entries could not be found", field: "waiverId" }` before changing the waiver row. This prevents an old or corrupt waiver from being soft-deleted without a matching financial reversal.

- [ ] **Step 3: Soft-delete, restore status when needed, and audit.**

Set `deletedAt: now` on the waiver. If the prior loan status is `fully_paid` and `isLoanEconomicallyFullyPaid(loan.id, now, tx)` is false, call `maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId)`. Read the updated loan status, then call `writeAuditLog` with action `loan.waiver.undo`, the prior status/amount/portions, the undo reason, and resulting status.

- [ ] **Step 4: Return a stable result and txid.**

Return `{ loanId, waiverId, reversedAmount, interestPortion, principalPortion, previousStatus, status, txid }`, using the same `pg_current_xact_id()` pattern as waiver creation. The `loanId` is required by the action to revalidate the correct loan route.

- [ ] **Step 5: Run the integration tests green.**

Run the command from Task 1. Expected: all existing and new loan-waiver integration tests pass.

## Task 3: Expose and authorize the undo action

**Files:**
- Modify: `src/actions/loan-waiver.actions.ts`
- Test: `src/actions/__tests__/authorization.test.ts`

- [ ] **Step 1: Add action validation and service mocking.**

Validate `waiverId` as a non-empty UUID and `reason.trim().length >= 10`, returning `Waiver ID is required` or `Reason must be at least 10 characters` before the service call. Add an `undoLoanWaiver` mock to the action authorization test module.

- [ ] **Step 2: Add `undoLoanWaiverAction` with `loan:waiver`.**

Wrap the action with `withAction<UndoLoanWaiverInput, UndoLoanWaiverResult>`, use forbidden text `Only admins can undo loan waivers`, call the service with `session.user.id`, revalidate `/loans/${result.loanId}`, and return `{ data: result }`. Map `LoanNotFound`/`WaiverNotFound` to user-facing not-found errors and `ValidationError` to its message; capture unexpected errors.

- [ ] **Step 3: Add authorization and validation tests.**

Assert an unprivileged session gets the forbidden response without calling the service, an admin can invoke the action, and a short undo reason returns the validation error without invoking the service.

- [ ] **Step 4: Run action tests.**

Run:

```bash
pnpm exec vitest run src/actions/__tests__/authorization.test.ts
```

Expected: the authorization suite passes.

## Task 4: Add collection invalidation and client undo plumbing

**Files:**
- Modify: `src/collections/loan-waivers.ts`
- Modify: `src/components/loans/waive-loan-dialog.tsx`

- [ ] **Step 1: Export a loan-waiver invalidation helper.**

Refactor the existing private `invalidateCrossCutting(loanId)` into an exported `invalidateLoanWaiverMutation(loanId)` function that invalidates lending projections, `queryKeys.loanWaivers.all`, `queryKeys.loanWaivers.byLoan(loanId)`, and emits `loan_waivers`, `transactions`, and `loans` table changes.

- [ ] **Step 2: Add a client undo handler.**

From the history component, call `undoLoanWaiverAction({ waiverId, reason })`; on success call `invalidateLoanWaiverMutation(loanId)`, `getLoanWaiversCollection(loanId).utils.writeDelete(waiverId)`, show a success toast, and close the undo dialog. On error preserve the dialog and display the returned error.

- [ ] **Step 3: Keep undo controls independent from the create CTA.**

Give `WaiverHistorySection` an `canUndo` prop and render it for authorized users on `fully_paid` loans. Do not render Undo for deleted rows because the collection query excludes them.

## Task 5: Write failing automated UI coverage

**Files:**
- Test: `cypress/e2e/loan-detail.cy.ts`

- [ ] **Step 1: Add a review-without-persistence test.**

Create an active loan, open `Waive Amount`, enter a valid amount/reason, click `Review Waiver`, assert `Amount Waived` and the formatted amount are visible, click `Back`, and assert the review summary is gone and no waiver history row exists. Run the focused Cypress spec and confirm this test fails because the current dialog has no review step.

- [ ] **Step 2: Add a confirmation and amount-display test.**

Complete the review, click `Confirm & Waive`, wait for the success toast, reload/navigate to the loan, and assert waiver history contains an `Amount Waived` label with the exact formatted amount. The test must fail before the UI change because the current flow saves directly and has no amount label in history.

- [ ] **Step 3: Add a full-waiver undo test.**

Create a loan whose total due is known, waive the full due amount, assert `Fully Paid`, click `Undo`, assert the amount and warning, submit a short reason first and assert the validation error, then submit a valid reason. Assert the success toast, `Active` status, and that the loan appears in the active-loan report/list. Run the focused Cypress spec and confirm it fails before the UI change.

- [ ] **Step 4: Keep the UI tests fully automated.**

Use Cypress assertions for rendering, formatted amount, review/back navigation, persistence, validation, undo, status restoration, and active-loan visibility; do not add a human verification checkpoint.

## Task 6: Implement the two-step waiver review and undo UI

**Files:**
- Modify: `src/components/loans/waive-loan-dialog.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`

- [ ] **Step 1: Add local review state.**

Add `reviewStep` and `pendingData` state. Replace `handleSubmit` with validation that sets `{ amount, reason, preview }` and `reviewStep: true`; do not call `insertWaiverWithInput` from the edit step.

- [ ] **Step 2: Render the review summary.**

When review state is active, render `ConfirmSummaryDialog` with lines for `Amount Waived`, `Interest Waived`, `Principal Waived`, `Balance After Waiver`, and `Reason`; use `CurrencyCell`/`formatCurrency` for monetary values, emphasize the total amount, and use `Back` to clear review state only. Confirm calls the existing insert flow and closes only after `tx.isPersisted.promise` resolves.

- [ ] **Step 3: Render amount and undo confirmation.**

Add a visible `Amount Waived` label in each history row, an Undo button, and a second confirmation drawer with amount, reason textarea, minimum-length validation, Cancel, and `Undo Waiver`. Disable controls during persistence and prevent duplicate submissions with a ref/state guard.

- [ ] **Step 4: Fix loan-detail visibility conditions.**

Use `canWaiveAmount = !readOnly && has("loan:waiver")` for the create CTA, but use `canViewWaivers = has("loan:waiver")` for history. Pass `canUndo: canViewWaivers` so a fully paid loan still exposes an authorized undo path.

- [ ] **Step 5: Run the UI tests and type check.**

Run:

```bash
pnpm exec tsc --noEmit
npx cypress run --spec cypress/e2e/loan-detail.cy.ts
```

Expected: the type check and all focused Cypress assertions pass.

## Task 7: Adversarial review and final verification

**Files:**
- Review all changed files and the plan/spec against the requirements.

- [ ] **Step 1: Review the diff for financial and lifecycle hazards.**

   Check specifically that review mode cannot call a collection insert, undo uses stored portions rather than current allocation, missing ledger portions abort before soft-delete, undo is idempotent under retries, historical loans cannot be reopened, fully paid history is visible, and all cache/table invalidations are present.

- [ ] **Step 2: Run the full relevant verification set.**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/services/__integration__/loan-waiver.service.test.ts src/actions/__tests__/authorization.test.ts
npx cypress run --spec cypress/e2e/loan-detail.cy.ts
```

Expected: all commands exit with status 0 and report no failures.

- [ ] **Step 3: Inspect the final worktree.**

Run `git diff --check` and `git status --short`; ensure only the intended feature files and documentation are changed, while pre-existing unrelated untracked files remain untouched.
