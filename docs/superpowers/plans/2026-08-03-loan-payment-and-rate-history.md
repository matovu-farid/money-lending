# Payment Guard and Loan Rate History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate payment clicks, give admins an audited direct interest-rate adjustment, and expose applied rate history with conditional UI indicators.

**Architecture:** Keep the existing transactional loan rate-change service and approval workflow. Add a dedicated administrator-only action that shares the transactional apply path, use the existing immutable `audit_log` as the history source, and fetch loan-specific history through a `loan:read` server action. Add local in-flight guards to both payment forms so the confirmation dialog remains locked until persistence completes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle/Postgres, Effect, TanStack DB/Query, React Hook Form, Vitest, Testing Library, Cypress.

---

## Scope map

| Area | Files to create or modify | Responsibility |
|---|---|---|
| Permissions/types | `src/types/common.ts`, `src/lib/permissions.ts`, `src/types/rate-change.ts`, permission tests | Define the admin-only adjustment boundary and history DTO. |
| Server rate workflow | `src/services/rate-change-request.service.ts`, `src/actions/rate-change-request.actions.ts`, `src/actions/__tests__/rate-change-request.actions.test.ts`, `src/services/__tests__/rate-change-request.service.test.ts` | Apply admin changes transactionally, retain approval behavior, and read only applied rate audit rows. |
| Client query wiring | `src/lib/query-keys.ts`, `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | Fetch, invalidate, and supply rate history/adjustment state. |
| Rate UI | `src/app/(app)/loans/[loanId]/loan-info-cards.tsx`, `src/app/(app)/loans/[loanId]/loan-rate-history-dialog.tsx`, `src/app/(app)/loans/[loanId]/admin-rate-adjustment-dialog.tsx`, component tests | Show the conditional indicator/history and admin-only editor. |
| Loans list | `src/app/(app)/loans/page.tsx`, `src/components/loans/loan-interest-rate-cell.tsx`, rate-cell test | Show current rate and a compact changed marker without changing filters/exports. |
| Payment guard | `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`, `src/app/(app)/payments/QuickRecordDialog.tsx`, component tests | Lock the confirmation action and form while the receipt transaction is pending. |
| E2E | `cypress/e2e/quick-record.cy.ts`, `cypress/e2e/rate-change-approval.cy.ts` | Verify the user-visible behavior and authorization end to end alongside existing workflow coverage. |

## Adversarial review requirements

After each implementation task, inspect the diff and ask:

1. Can a second click, keyboard submit, or closing/reopening the confirmation dialog start another payment before the first persistence promise settles?
2. Can a non-admin invoke the admin adjustment action directly, or can a delegated managing supervisor inherit the new permission?
3. Does every applied rate change (immediate, approved, and admin-direct) have an audit row with the actual old effective rate, new rate, actor, and timestamp?
4. Can a stale pending request overwrite a newer rate while producing a misleading audit history?
5. Does the history button appear for pending/rejected requests or disappear after a successful change because of stale client data?
6. Are unrelated audit rows or creditor data exposed by the new read action?

Fix findings before moving to the next task. At the end, run a final adversarial pass against the complete requirement checklist and the full verification commands.

### Task 1: Add the permission and public history types

**Files:**
- Modify: `src/types/common.ts`
- Modify: `src/lib/permissions.ts`
- Modify: `src/types/rate-change.ts`
- Test: `src/lib/__tests__/permissions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Add assertions that `admin` and `superAdmin` have `loan:rate-adjust`, while `loanOfficer`, `supervisor`, `unassigned`, and `MANAGING_SUPERVISOR_ELEVATED` do not. Keep existing rate-change approval assertions unchanged.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run src/lib/__tests__/permissions.test.ts`

Expected: FAIL because the permission literal and mapping do not exist.

- [ ] **Step 3: Add the permission and DTO types**

Extend `Permission` with `loan:rate-adjust`; add it to `adminExtras`, and explicitly filter it from `MANAGING_SUPERVISOR_ELEVATED`. Add these types to `src/types/rate-change.ts`:

```ts
export type AdminRateAdjustmentInput = {
  loanId: string
  requestedRate: string
}

export type LoanRateChangeHistoryEntry = {
  id: string
  fromRate: string
  toRate: string
  actorId: string | null
  actorName: string | null
  changedAt: Date
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm vitest run src/lib/__tests__/permissions.test.ts`

Expected: PASS with the new admin-only boundary covered.

- [ ] **Step 5: Review the diff adversarially**

Verify no delegated role receives the new permission through set construction and that the type is exported by `src/types/index.ts`.

### Task 2: Make applied rate changes auditable and queryable

**Files:**
- Modify: `src/services/rate-change-request.service.ts`
- Modify: `src/actions/rate-change-request.actions.ts`
- Modify: `src/actions/__tests__/rate-change-request.actions.test.ts`
- Modify: `src/services/__tests__/rate-change-request.service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests for the new exported service functions using the existing `db` transaction mocks already used in this file. The implementation contract is `applyAdminRateAdjustment({ loanId, newRate, actorId })` returning `Effect<void, LoanNotFound | ValidationError | DatabaseError>`. The admin apply test must return a locked `mockLoan` from the transaction's `select().from().where().for()` chain, return the updated row from `update().set().where().returning()`, and assert these exact calls. Import `Effect` and `Exit` in the test file and define the transaction-chain spies alongside the existing `mockedDb` spies.

```ts
it("applies an admin rate adjustment using the locked loan's effective rate", async () => {
  const result = await Effect.runPromise(
    applyAdminRateAdjustment({ loanId: "loan-1", newRate: "0.12", actorId: "admin-1" }),
  )
  expect(result).toBeUndefined()
  expect(mockedUpdateSet).toHaveBeenCalledWith({ interestRateOverride: "0.12", updatedAt: expect.any(Date) })
  expect(mockAutoPostRateChangeAdjustment).toHaveBeenCalledWith(expect.anything(), {
    loanId: "loan-1", oldRate: "0.10", newRate: "0.12", actorId: "admin-1",
  })
  expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    actorId: "admin-1", action: "loan.rate_change.admin_adjusted", entityType: "loan", entityId: "loan-1",
    beforeValue: { interestRate: "0.10" }, afterValue: { interestRateOverride: "0.12" },
  }))
})

it("rejects an unchanged or out-of-range admin rate before writing", async () => {
  for (const newRate of ["0", "1", "0.10"]) {
    const exit = await Effect.runPromiseExit(
      applyAdminRateAdjustment({ loanId: "loan-1", newRate, actorId: "admin-1" }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }
  expect(mockedUpdateSet).not.toHaveBeenCalled()
  expect(mockWriteAuditLog).not.toHaveBeenCalled()
})

it("maps only applied loan rate audit rows into newest-first history", async () => {
  const history = await listLoanRateChangeHistory("loan-1")
  expect(history).toEqual([
    { id: "audit-admin", fromRate: "0.11", toRate: "0.12", actorId: "admin-1", actorName: "Admin User", changedAt: expect.any(Date) },
    { id: "audit-approved", fromRate: "0.10", toRate: "0.11", actorId: "supervisor-1", actorName: "Supervisor User", changedAt: expect.any(Date) },
    { id: "audit-immediate", fromRate: "0.09", toRate: "0.10", actorId: "officer-1", actorName: "Loan Officer", changedAt: expect.any(Date) },
  ])
})
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `pnpm vitest run src/services/__tests__/rate-change-request.service.test.ts`

Expected: FAIL because the admin apply/history functions do not exist.

- [ ] **Step 3: Implement one transactional apply path**

Refactor the existing immediate apply logic into a service function with the exact signature `applyAdminRateAdjustment({ loanId, newRate, actorId })` that locks the non-deleted loan, derives `oldRate = getBaseRate(loan)` from the locked row, validates operational status and `newRate !== oldRate`, updates `interestRateOverride`, calls `autoPostRateChangeAdjustment`, and writes exactly one audit entry. Use `loan.rate_change.admin_adjusted` for the new direct action and retain `loan.rate_change.immediate` for the existing threshold path. In the approval path, derive the old rate from the locked loan instead of trusting the stale `request.currentRate`, and use that same value for the baseline adjustment and audit payload. Add a no-op check for an approval whose requested rate is already the current effective rate.

Implement `listLoanRateChangeHistory(loanId)` in the same service. Query `auditLog` joined with `user`, filter `entityType = "loan"`, `entityId = loanId`, and the three applied actions, order by `occurredAt DESC`, parse `beforeValue`/`afterValue`, and map `fromRate` from `before.interestRateOverride ?? before.interestRate` and `toRate` from `after.interestRateOverride ?? after.interestRate`. Return only `LoanRateChangeHistoryEntry` values.

- [ ] **Step 4: Add server actions and action tests**

Add:

```ts
export const adjustLoanInterestRateAction = withAction<
  AdminRateAdjustmentInput,
  void
>({
  permission: "loan:rate-adjust",
  action: async (session, input) => {
    // validate non-empty loanId and decimal 0 < requestedRate < 1,
    // run the transactional admin apply service with session.user.id,
    // revalidate /loans and /loans/<loanId>, and map expected errors.
  },
})

export const listLoanRateHistoryAction = withAction({
  permission: "loan:read",
  effect: (_session, loanId: string) => listLoanRateChangeHistory(loanId),
})
```

Test unauthenticated, forbidden, invalid, successful, and history-read calls. Mock the service module in the action test so the test isolates permission and response mapping.

- [ ] **Step 5: Run focused service/action tests and confirm GREEN**

Run: `pnpm vitest run src/services/__tests__/rate-change-request.service.test.ts src/actions/__tests__/rate-change-request.actions.test.ts`

Expected: PASS, including existing request/approval tests.

- [ ] **Step 6: Review the diff adversarially**

Confirm every successful applied path writes an actor ID and relies on `audit_log.occurred_at`, history filters unrelated actions, and no raw audit JSON or unrelated entity is returned.

### Task 3: Wire query invalidation and build the rate UI

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-info-cards.tsx`
- Create: `src/app/(app)/loans/[loanId]/loan-rate-history-dialog.tsx`
- Create: `src/app/(app)/loans/[loanId]/admin-rate-adjustment-dialog.tsx`
- Test: component tests next to the two new dialog components

- [ ] **Step 1: Write failing component tests**

Test that the history dialog renders old/new rate, actor, and localized timestamp; the adjustment dialog validates a rate and disables save while pending; and the history trigger is absent for an empty history array and present for a non-empty one.

- [ ] **Step 2: Run component tests and confirm RED**

Run: `pnpm vitest run 'src/app/(app)/loans/[loanId]/loan-rate-history-dialog.test.tsx' 'src/app/(app)/loans/[loanId]/admin-rate-adjustment-dialog.test.tsx'`

Expected: FAIL because the dialog components and props do not exist.

- [ ] **Step 3: Add the query key and dialogs**

Add `queryKeys.loans.rateHistory(loanId) => ["loans", "rate-history", loanId]`. Create focused client components: a read-only history dialog accepting `LoanRateChangeHistoryEntry[]`, and an admin adjustment dialog accepting `open`, `currentRate`, `isPending`, `onSubmit`, and `onClose`. The form displays rates as percentages, converts the submitted percentage to a decimal with four fractional digits, rejects non-numeric values, values `<= 0` or `>= 100`, and the unchanged current rate.

- [ ] **Step 4: Integrate detail-page behavior**

Use `useQuery` with `listLoanRateHistoryAction` and the new key. Add `isAdjustingRate`, `adjustRateOpen`, and `adjustRateInput` state. On successful `adjustLoanInterestRateAction`, invalidate the rate-history query, invalidate lending projections, emit the loans table change, close the dialog, and show a success toast; on failure keep the form open and show the returned error. Pass history/handlers to `LoanInfoCards`; show “Rate changed” and the history button only when history length is greater than zero, and show the admin adjustment trigger only when `has("loan:rate-adjust")` and the loan is active.

- [ ] **Step 5: Run component tests and confirm GREEN**

Run: `pnpm vitest run 'src/app/(app)/loans/[loanId]/loan-rate-history-dialog.test.tsx' 'src/app/(app)/loans/[loanId]/admin-rate-adjustment-dialog.test.tsx'`

Expected: PASS with the conditional history and admin-only editor behavior.

- [ ] **Step 6: Review the diff adversarially**

Verify history loading does not cause the button to appear for pending/rejected requests, a failed adjustment does not close the form, inactive loans cannot be adjusted, and the server action remains authoritative even if the UI permission cache is stale.

### Task 4: Add the changed-rate marker to the main loans page

**Files:**
- Modify: `src/app/(app)/loans/page.tsx`
- Create: `src/components/loans/loan-interest-rate-cell.tsx`
- Test: `src/components/loans/loan-interest-rate-cell.test.tsx`

- [ ] **Step 1: Add a focused failing render assertion**

Create a focused rate-cell test with `// @vitest-environment jsdom` that renders one changed and one unchanged cell, and assert the changed cell contains the formatted rate and `Rate changed` while the unchanged cell does not contain the marker. The page integration remains covered by the loans-list and rate-history Cypress flows.

- [ ] **Step 2: Run it and confirm RED**

Run: `pnpm vitest run src/components/loans/loan-interest-rate-cell.test.tsx`

Expected: FAIL because the list has no rate column/marker.

- [ ] **Step 3: Implement the list column**

Add an Interest Rate column using `getBaseRate(e)`/`formatRate`, with a compact `Rate changed` badge when `e.interestRateOverride !== null`. Keep the row click, filters, export data, and responsive card behavior unchanged.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm vitest run src/components/loans/loan-interest-rate-cell.test.tsx`

Expected: PASS for both changed and unchanged rows.

- [ ] **Step 5: Review the diff adversarially**

Check that the marker is based on the persisted override, not on a pending request or client-only history result, and that list exports are not accidentally changed.

### Task 5: Add the payment in-flight guard

**Files:**
- Modify: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`
- Modify: `src/app/(app)/payments/QuickRecordDialog.tsx`
- Test: component tests adjacent to each payment form

- [ ] **Step 1: Write failing component tests**

Mock `insertPaymentWithInput` to return a transaction whose `isPersisted.promise` is manually resolved/rejected. For both forms, open the confirmation state, click `Confirm & Record`, assert the button becomes disabled and the collection insert is called once after a second click, then reject and assert the button becomes enabled again.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm vitest run 'src/app/(app)/loans/[loanId]/payments/new/*test.tsx' 'src/app/(app)/payments/*test.tsx'`

Expected: FAIL because the confirmation buttons are not guarded.

- [ ] **Step 3: Implement the guard**

Replace QuickRecordDialog’s unused `useTransition` flag with `const [isRecording, setIsRecording] = useState(false)`. In each confirmation handler, begin with `if (isRecording || !requiredData) return`, immediately set `isRecording(true)`, keep the confirmation UI open while awaiting `tx.isPersisted.promise`, disable its confirm/back/cancel controls and form controls, and use `finally` to clear the flag after failure or receipt data creation. Reset the flag whenever the dialog/form is reset. Disable the loan-specific page’s main submit button while recording as well, so closing/underlying clicks cannot open another confirmation state.

- [ ] **Step 4: Run component tests and confirm GREEN**

Run the focused payment component tests again.

Expected: PASS for both forms, including failure recovery and exactly one collection insertion.

- [ ] **Step 5: Review the diff adversarially**

Check mouse double-click, keyboard submit, rapid cancel/back clicks, and a persistence failure. Confirm the button is disabled for the entire receipt handoff and that a failure leaves the user able to retry without stale pending data.

### Task 6: Add Cypress coverage and complete verification

**Files:**
- Modify: `cypress/e2e/quick-record.cy.ts`
- Modify: `cypress/e2e/rate-change-approval.cy.ts`

- [ ] **Step 1: Write Cypress tests before final implementation claims**

Cover:

1. Loan payment confirmation renders, disables `Confirm & Record` after the first click while the persistence request is delayed, and does not create a second payment.
2. Quick Record has the same disabled state and single-payment result.
3. Admin sees `Adjust Interest Rate`, changes a rate, sees the success toast, sees the list/detail `Rate changed` marker, and opens history showing old rate, new rate, actor, and time.
4. A loan with no applied change has no history button; a pending/rejected request alone does not show it.
5. A non-admin can read history but does not see the admin adjustment control, and direct server authorization remains forbidden.

Use existing Cypress registration, database, and role-switching helpers; use network/database synchronization rather than arbitrary sleeps.

- [ ] **Step 2: Run targeted Cypress specs**

Run: `pnpm cypress run --spec cypress/e2e/quick-record.cy.ts --spec cypress/e2e/rate-change-approval.cy.ts`

Expected: all targeted scenarios pass.

- [ ] **Step 3: Run full static and unit verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
```

Expected: exit 0, no TypeScript errors, lint errors, or failed tests.

- [ ] **Step 4: Run the full Cypress suite**

Run: `pnpm cypress run`

Expected: exit 0 with all existing and new E2E specs passing.

- [ ] **Step 5: Perform the final adversarial review**

Re-read this plan and the design spec, inspect the final diff, and verify each explicit requirement: payment button lock, administrator-only adjustment, atomic audit of actor/time, visible changed-rate note, conditional history control, readable history contents, and non-admin server enforcement. Fix any finding and repeat the relevant failing/green verification command before declaring completion.
