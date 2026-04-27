# Perpetual Threshold — Include Rollover Amount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an active loan is being rolled over, compare `entered + outstandingPrincipal + accruedInterest` against `PERPETUAL_LOAN_MIN_AMOUNT` instead of just the entered principal, so a rollover that totals ≥ 2,000,000 UGX correctly enables the "Perpetual" loan type.

**Architecture:** UI-only change inside the `LoanTypeSelector` sub-component of the new-loan wizard's step 1. Pass the existing `activeLoanData` (already a prop on `LoanDetailsStep`) into `LoanTypeSelector` and switch the threshold compare to a BigNumber sum so it survives precision concerns. No server, schema, or service changes — there is no server-side check on `PERPETUAL_LOAN_MIN_AMOUNT`.

**Tech Stack:** Next.js (App Router), React Hook Form, BigNumber.js, Cypress E2E.

**Spec:** `docs/superpowers/specs/2026-04-27-perpetual-threshold-rollover-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/app/(app)/loans/new/_components/loan-details-step.tsx` | Modify | Add `activeLoanData` to `LoanTypeSelector` props; replace threshold compare with BigNumber-based effective amount; update hint text. |
| `cypress/e2e/perpetual-threshold-rollover.cy.ts` | Create | E2E coverage for the new threshold behavior + regression coverage for the no-rollover path. |

No new shared modules or helpers. The existing `PERPETUAL_LOAN_MIN_AMOUNT` constant in `src/lib/constants.ts` is reused.

---

## Task 1: Cypress E2E Tests (RED)

Write the failing tests first. They drive the change in Task 2.

**Files:**
- Create: `cypress/e2e/perpetual-threshold-rollover.cy.ts`

- [ ] **Step 1: Create the spec with the full test suite**

Create `cypress/e2e/perpetual-threshold-rollover.cy.ts` with the following content:

```ts
/**
 * E2E tests for the perpetual loan threshold check with rollover support.
 *
 * The threshold (PERPETUAL_LOAN_MIN_AMOUNT = 2,000,000 UGX) must consider
 * the carried rollover amount (outstandingPrincipal + accruedInterest) when
 * a customer has an active loan being rolled over into a new one.
 */

const PERPETUAL_RADIO = "input[name='loanType'][value='perpetual']"

function registerCustomer(name: string, contact: string): Cypress.Chainable<string> {
  cy.visit("/customers/new")
  cy.get("#fullName").type(name)
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)
  return cy.url().then((url) => url.split("/customers/")[1])
}

function issueInitialLoan(customerId: string, principal: string): void {
  cy.visit(`/loans/new?customerId=${customerId}`)
  cy.get("#principalAmount").type(principal)
  cy.get("#issuanceFee").type("50000")
  cy.contains("button", "Next").click()

  // Step 2: Collateral
  cy.get("#collateralNature").type("Land Title")
  cy.contains("button", "Next").click()

  // Step 3: Issue
  cy.contains("button", "Issue Loan").click()
  cy.dismissReceiptModal()
}

describe("Perpetual loan threshold — rollover-aware", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Threshold Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("No active loan (regression)", () => {
    beforeEach(() => {
      registerCustomer("Threshold Borrower", "0771300001").then((id) => {
        customerId = id
      })
    })

    it("hides Perpetual when entered principal is below 2,000,000 UGX", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Loan Details")
      cy.get("#principalAmount").type("1500000")

      cy.get(PERPETUAL_RADIO).should("not.exist")
      cy.contains("Perpetual loans require a minimum of 2,000,000 UGX").should("be.visible")
    })

    it("shows Perpetual when entered principal is at or above 2,000,000 UGX", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Loan Details")
      cy.get("#principalAmount").type("2000000")

      cy.get(PERPETUAL_RADIO).should("exist")
      cy.get(PERPETUAL_RADIO).should("be.checked")
    })
  })

  describe("Active loan present (rollover)", () => {
    it("shows Perpetual when entered + carried >= 2,000,000 UGX even though entered alone is less", () => {
      // Carried >= 1.5M (loan principal). Even with zero accrued interest the
      // effective amount is 1.5M + 1M = 2.5M, comfortably above the threshold.
      registerCustomer("Rollover Threshold Borrower A", "0771300002").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "1500000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("1000000")

        // Without the fix: 1,000,000 < 2,000,000 -> Perpetual hidden.
        // With the fix: 1,000,000 + 1,500,000 (+ accrued) >= 2,500,000 -> Perpetual visible.
        cy.get(PERPETUAL_RADIO).should("exist")
      })
    })

    it("hides Perpetual when entered + carried is still below 2,000,000 UGX", () => {
      // Initial loan principal 200k. Even with the minimum-period interest
      // accrual on top, 200k carried + 500k entered stays well below 2M.
      registerCustomer("Rollover Threshold Borrower B", "0771300003").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "200000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("500000")

        cy.get(PERPETUAL_RADIO).should("not.exist")
        cy.contains("Perpetual loans require an effective principal").should("be.visible")
      })
    })

    it("does not show any threshold hint while the principal field is empty", () => {
      registerCustomer("Rollover Threshold Borrower C", "0771300004").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "200000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        // Field empty: no hint should be shown (matches existing UX of
        // hiding the hint until the user types something).
        cy.contains("Perpetual loans require").should("not.exist")
      })
    })

    it("keeps Perpetual visible when rolling over a perpetual loan even with a small fresh entry", () => {
      // Regression guard: old loan was perpetual (>= 2M), so the form prefills
      // loanType=perpetual. With a small fresh entry the entered amount alone
      // is < 2M but the effective amount remains >= 2M and Perpetual must stay
      // in the rendered options for the prefilled selection to be reflected.
      registerCustomer("Rollover Threshold Borrower D", "0771300005").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "2000000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("100000")

        cy.get(PERPETUAL_RADIO).should("exist")
        cy.get(PERPETUAL_RADIO).should("be.checked")
      })
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail in the expected way**

Run: `npx cypress run --spec cypress/e2e/perpetual-threshold-rollover.cy.ts`

Expected:
- "No active loan (regression)" tests PASS (current behavior already matches what we assert).
- "shows Perpetual when entered + carried >= 2,000,000 UGX..." FAILS — current code hides Perpetual because it only sees the 1,000,000 entered.
- "hides Perpetual when entered + carried is still below 2,000,000 UGX" — the assertion `should("not.exist")` will PASS, but the hint-text assertion `should("be.visible")` will FAIL because the new "effective principal" copy doesn't exist yet.
- "keeps Perpetual visible when rolling over a perpetual loan..." FAILS — current code drops Perpetual from `availableOptions` whenever entered alone is < 2M.
- The empty-field test PASSES.

If the rollover-positive test PASSES today, stop and re-check the implementation — the change wouldn't be needed.

- [ ] **Step 3: Commit the failing tests**

```bash
git add cypress/e2e/perpetual-threshold-rollover.cy.ts
git commit -m "test: e2e for perpetual threshold including rollover amount"
```

---

## Task 2: Make the Tests Pass

**Files:**
- Modify: `src/app/(app)/loans/new/_components/loan-details-step.tsx`

- [ ] **Step 1: Add the BigNumber import**

Open `src/app/(app)/loans/new/_components/loan-details-step.tsx`. The file does not currently import BigNumber. Add this import after the existing third-party imports (alongside line 1's React import block):

```ts
import BigNumber from "bignumber.js"
```

Place it near the other library imports — match the file's existing import ordering (React first, then types, then third-party, then local). The `bignumber.js` package is already a project dependency (see `package.json`).

- [ ] **Step 2: Pass `activeLoanData` into `LoanTypeSelector`**

In `LoanDetailsStep`'s render (around line 116–122), the existing JSX is:

```tsx
<LoanTypeSelector
  loanType={loanType}
  setLoanType={setLoanType}
  disabled={!!activeLoanData}
  principalAmount={principalAmount}
  userRole={userRole}
/>
```

Add the `activeLoanData` prop:

```tsx
<LoanTypeSelector
  loanType={loanType}
  setLoanType={setLoanType}
  disabled={!!activeLoanData}
  principalAmount={principalAmount}
  userRole={userRole}
  activeLoanData={activeLoanData}
/>
```

- [ ] **Step 3: Update `LoanTypeSelector` props**

Find the `LoanTypeSelector` function (starts around line 178). Update its prop type to accept `activeLoanData`:

```tsx
function LoanTypeSelector({
  loanType,
  setLoanType,
  disabled,
  principalAmount,
  userRole,
  activeLoanData,
}: {
  loanType: LoanType
  setLoanType: (t: LoanType) => void
  disabled: boolean
  principalAmount: string
  userRole: UserRole
  activeLoanData: ActiveLoanInfo | null | undefined
}) {
```

`ActiveLoanInfo` is already declared at the top of this file (around line 20) — no new type needed.

- [ ] **Step 4: Replace the threshold computation**

Currently lines 191–192 read:

```tsx
const amount = parseFloat(principalAmount?.replace(/,/g, "") || "0")
const perpetualAllowed = amount >= PERPETUAL_LOAN_MIN_AMOUNT
```

Replace with:

```tsx
const enteredAmount = new BigNumber(principalAmount?.replace(/,/g, "") || "0")
const effectiveAmount = activeLoanData
  ? enteredAmount
      .plus(new BigNumber(activeLoanData.outstandingPrincipal))
      .plus(new BigNumber(activeLoanData.accruedInterest))
  : enteredAmount
const perpetualAllowed = effectiveAmount.gte(PERPETUAL_LOAN_MIN_AMOUNT)
```

- [ ] **Step 5: Update the hint text**

Currently lines 266–269 read:

```tsx
{!perpetualAllowed && amount > 0 && (
  <p className="text-xs text-muted-foreground">
    Perpetual loans require a minimum of 2,000,000 UGX.
  </p>
)}
```

Replace with:

```tsx
{!perpetualAllowed && effectiveAmount.gt(0) && (
  <p className="text-xs text-muted-foreground">
    {activeLoanData
      ? "Perpetual loans require an effective principal (entered + rollover) of 2,000,000 UGX or more."
      : "Perpetual loans require a minimum of 2,000,000 UGX."}
  </p>
)}
```

- [ ] **Step 6: Run the Cypress spec to verify all tests pass**

Run: `npx cypress run --spec cypress/e2e/perpetual-threshold-rollover.cy.ts`

Expected: ALL tests PASS (6 tests total: 2 regression + 4 rollover).

If any test still fails:
- Re-read the assertion. If the threshold compare is still using `parseFloat`, Step 4 was not applied.
- If the hint text test fails, double-check Step 5 — the substring `"Perpetual loans require an effective principal"` must appear verbatim in the rendered hint when `activeLoanData` is truthy and the effective amount is below threshold.

- [ ] **Step 7: Run typecheck and lint**

Run: `npm run typecheck`
Expected: no errors. The new prop and BigNumber math should type-check cleanly.

Run: `npm run lint`
Expected: no errors. Fix any new warnings introduced by the change before moving on.

- [ ] **Step 8: Commit the fix**

```bash
git add src/app/(app)/loans/new/_components/loan-details-step.tsx
git commit -m "fix(loans): include rollover amount in perpetual threshold check"
```

---

## Task 3: Final verification

- [ ] **Step 1: Re-run the full new-loan E2E specs to catch regressions**

Run: `npx cypress run --spec "cypress/e2e/perpetual-threshold-rollover.cy.ts,cypress/e2e/loan-types.cy.ts,cypress/e2e/loan-wizard.cy.ts,cypress/e2e/collateral-settlement.cy.ts"`

Expected: ALL specs PASS. These cover (a) the new threshold behavior, (b) the existing default-to-perpetual behavior, (c) the wizard flow, and (d) the rollover banner + rollover loan issuance flow.

If `loan-wizard.cy.ts` or `collateral-settlement.cy.ts` regress, inspect the failure — most likely cause is a stale assumption about which radio options are present. Adjust the implementation, not the existing tests, unless the existing test was masking the bug being fixed.

- [ ] **Step 2: Run unit tests**

Run: `npm run test`
Expected: PASS. Vitest does not cover this UI logic, but run it to catch any unrelated breakage.

- [ ] **Step 3: Final commit if any follow-up changes were needed**

If Step 1 surfaced an issue requiring an additional code change, commit it as a separate fix commit:

```bash
git add <changed-files>
git commit -m "fix(loans): <describe the follow-up>"
```

If no follow-up was needed, skip this step — Task 2's commit is sufficient.
