# Perpetual Loan Threshold — Include Rollover Amount

**Date:** 2026-04-27
**Status:** Approved

## Problem

A perpetual loan requires principal ≥ 2,000,000 UGX (`PERPETUAL_LOAN_MIN_AMOUNT`). When a customer has an active loan being rolled over into a new loan, the threshold check on the new-loan form considers only the freshly entered principal and ignores the carried rollover balance — even though the new loan's saved `principalAmount` actually equals `entered + carriedPrincipal + carriedInterest`.

Concrete case: customer has 1,000,000 UGX of outstanding principal + accrued interest being rolled over, the loan officer enters 1,000,000 UGX of fresh principal. The new loan's stored principal will be 2,000,000 UGX, which qualifies for perpetual — but today's UI hides the "Perpetual" option because the gate sees only the 1,000,000 UGX entered.

This also produces a hidden UX wart: when an old perpetual loan is rolled over with < 2M fresh principal, the form prefills `loanType=perpetual` but the radio group filters that option out, leaving nothing visibly selected.

## Goal

When an active loan is being rolled over, the perpetual gate compares the **effective** principal (entered + outstanding principal + accrued interest) against `PERPETUAL_LOAN_MIN_AMOUNT`. When there is no rollover, behavior is unchanged.

## Scope

- UI only. No server-side check exists for `PERPETUAL_LOAN_MIN_AMOUNT`, so no service, action, schema, or DB changes are needed.
- Affects the new-loan flow at `/loans/new`.

## Design

### Effective amount formula

```
effectiveAmount = enteredPrincipal + outstandingPrincipal + accruedInterest    // when activeLoanData exists
effectiveAmount = enteredPrincipal                                              // otherwise
```

This mirrors:
- The existing `effectivePrincipal` computation at `src/app/(app)/loans/new/page.tsx:207-213`.
- The new loan's stored `principalAmount` at `src/services/loan.service.ts:107-112`.

Use `BigNumber` for the addition (consistent with surrounding code) and convert to `number` for the threshold compare.

### Component change

File: `src/app/(app)/loans/new/_components/loan-details-step.tsx`

1. Add `activeLoanData: ActiveLoanInfo | null | undefined` to `LoanTypeSelector`'s props.
2. Pass `activeLoanData` from `LoanDetailsStep` into `LoanTypeSelector` (already on `LoanDetailsStepProps`).
3. Replace the threshold computation (currently lines 191–192):

   ```ts
   const amount = parseFloat(principalAmount?.replace(/,/g, "") || "0")
   const perpetualAllowed = amount >= PERPETUAL_LOAN_MIN_AMOUNT
   ```

   with:

   ```ts
   const enteredAmount = new BigNumber(principalAmount?.replace(/,/g, "") || "0")
   const effectiveAmount = activeLoanData
     ? enteredAmount
         .plus(new BigNumber(activeLoanData.outstandingPrincipal))
         .plus(new BigNumber(activeLoanData.accruedInterest))
     : enteredAmount
   const perpetualAllowed = effectiveAmount.gte(PERPETUAL_LOAN_MIN_AMOUNT)
   ```

4. Update the inline hint (currently lines 266–269) to be accurate in both modes:
   - No rollover, below threshold: "Perpetual loans require a minimum of 2,000,000 UGX." (unchanged)
   - Rollover, below threshold: "Perpetual loans require an effective principal (entered + rollover) of 2,000,000 UGX or more."

   Show the hint only when `effectiveAmount > 0` and `!perpetualAllowed`, matching today's `amount > 0 && !perpetualAllowed` gate.

### Behavior unchanged elsewhere

- Loan-type prefill on rollover (`page.tsx:182-193`) still sets `loanType` from the old loan.
- The radio is `disabled` whenever `activeLoanData` is present (line 119), so the user cannot change the type during rollover. The threshold change matters because it controls which options appear in `availableOptions` and thus whether the prefilled "perpetual" value is reflected as selected.
- Loan-officer 4M cap (line 112–114) is not touched; it already uses the entered amount, which is correct (the cap is on what the officer disburses fresh).

## Tests

E2E coverage via Cypress, in a new spec `cypress/e2e/perpetual-threshold-rollover.cy.ts` (or extending `cypress/e2e/loan-types.cy.ts` if it already exercises the new-loan form):

1. **No rollover, < 2M entered** → "Perpetual" radio not rendered; hint reads "minimum of 2,000,000 UGX".
2. **No rollover, ≥ 2M entered** → "Perpetual" radio rendered.
3. **Rollover with carried 1,000,000 + entered 1,000,000** → "Perpetual" radio rendered; loan submits with `loanType=perpetual`.
4. **Rollover with carried 500,000 + entered 1,000,000** → "Perpetual" radio not rendered; hint reads "effective principal (entered + rollover) of 2,000,000 UGX or more".
5. **Rollover where old loan was perpetual and effective amount qualifies** → form retains perpetual selection and submits successfully (regression guard for the previously hidden UX wart).

## Out of scope

- Adding a server-side guard for `PERPETUAL_LOAN_MIN_AMOUNT`. None exists today and the user did not ask for one. Can be revisited later if abuse via direct action calls becomes a concern.
- Changing the threshold value (`2,000,000`).
- Changing rollover mechanics, ledger postings, or the rollover banner.
