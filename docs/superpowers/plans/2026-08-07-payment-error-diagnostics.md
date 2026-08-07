# Payment Error Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unexpected payment-recording failures visible in the existing toast and send the original error to Sentry with safe context.

**Architecture:** Add a focused server-side diagnostic helper in `src/lib/error-diagnostics.ts` that unwraps Effect/`DatabaseError` layers and sanitizes the underlying cause. `recordPaymentAction` will continue mapping expected business errors, but unexpected failures will send the underlying cause to Sentry with payment context and return a sanitized message. Existing notification, success, and action result shapes remain unchanged.

**Tech Stack:** Next.js server actions, TypeScript, Effect, Sentry, Vitest.

---

### Task 1: Add failing sanitizer tests

**Files:**
- Create: `src/lib/__tests__/error-diagnostics.test.ts`

- [x] **Step 1: Write the failing tests**

Test that a normal error message is preserved, a PostgreSQL connection URL is
redacted, oversized messages are capped, and missing/non-error input returns a
stable fallback.

- [x] **Step 2: Run the focused test**

Run: `pnpm exec vitest run src/lib/__tests__/error-diagnostics.test.ts`

Expected: FAIL because `src/lib/error-diagnostics.ts` does not exist yet.

### Task 2: Implement the diagnostic helper

**Files:**
- Create: `src/lib/error-diagnostics.ts`

- [x] **Step 1: Implement `getDiagnosticErrorCause(error: unknown)` and `getDiagnosticErrorMessage(error: unknown)`**

Unwrap the Effect failure symbol and `DatabaseError.cause` recursively. Use an
`Error.message` when available, otherwise stringify a primitive or use
`Unexpected payment failure`. Replace PostgreSQL URLs and common credential
assignments with `[redacted]`, collapse whitespace, and cap the result at 500
characters.

- [x] **Step 2: Run the focused test**

Run: `pnpm exec vitest run src/lib/__tests__/error-diagnostics.test.ts`

Expected: PASS.

### Task 3: Route unexpected payment errors to Sentry and the toast

**Files:**
- Modify: `src/actions/payment.actions.ts:41-83`
- Modify: `src/actions/__tests__/payment.actions.test.ts`

- [x] **Step 1: Extend the existing payment action test**

Mock `captureServerError` and assert that an unexpected service failure returns
the sanitized message and captures the unwrapped original error with
`source: "recordPaymentAction"`, the loan ID, and the authenticated user ID.

- [x] **Step 2: Run the payment action test to verify the new expectation fails**

Run: `pnpm exec vitest run src/actions/__tests__/payment.actions.test.ts`

Expected: FAIL because the action currently returns `Internal server error` and
does not capture the original exception.

- [x] **Step 3: Implement the action change**

Import `captureServerError`, `getDiagnosticErrorCause`, and
`getDiagnosticErrorMessage`. In the unexpected error branch, call
`getDiagnosticErrorCause(error)`, pass that result to
`captureServerError(diagnosticError, { source: "recordPaymentAction", loanId:
input.loanId, userId: session.user.id })`, and return
`{ error: getDiagnosticErrorMessage(diagnosticError) }`. Leave the existing
`LoanNotFound` and `ValidationError` branches unchanged.

- [x] **Step 4: Run the payment action test**

Run: `pnpm exec vitest run src/actions/__tests__/payment.actions.test.ts`

Expected: PASS, with all existing payment action assertions passing.

### Task 4: Verify the complete change

**Files:**
- Review: `src/lib/error-diagnostics.ts`
- Review: `src/actions/payment.actions.ts`
- Review: `src/lib/__tests__/error-diagnostics.test.ts`
- Review: `src/actions/__tests__/payment.actions.test.ts`

- [x] **Step 1: Run focused tests**

Run: `pnpm exec vitest run src/lib/__tests__/error-diagnostics.test.ts src/actions/__tests__/payment.actions.test.ts`

Expected: PASS.

- [x] **Step 2: Run type checking and diff checks**

Run: `pnpm run typecheck`

Expected: exit 0 with no TypeScript errors.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 3: Confirm scope**

Run: `git status --short`

Expected: only the diagnostic implementation, its tests, and this plan/spec
documentation are attributable to this task; existing unrelated user files
remain untouched.
