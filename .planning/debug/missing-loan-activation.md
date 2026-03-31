---
status: awaiting_human_verify
trigger: "missing-loan-activation — User cannot move a loan from 'pending' to 'active' status. No visible UI action to activate/disburse a pending loan."
created: 2026-03-22T00:00:00.000Z
updated: 2026-03-22T00:10:00.000Z
---

## Current Focus

hypothesis: Loan activation is intentionally implicit (triggered by first payment), but the UI on the loan detail page is broken for pending loans because it shows "Record Payment" unconditionally — yet the loan detail shows "Record Payment" even on pending loans. The REAL problem is the loan detail page shows all action buttons regardless of status, but there is NO explicit "Activate Loan" / "Disburse" button. The pending→active transition IS implemented in the service layer (payment.service.ts line 181-186), but there is no standalone activation path.
test: Confirmed by reading all relevant code paths
expecting: Root cause confirmed — activation happens implicitly when first payment is recorded
next_action: Determine whether implicit activation via first payment is sufficient, or if an explicit Activate button is needed. Given the symptom "no UI to activate", the fix is to make the pending→active path more visible in the UI.

## Symptoms

expected: There should be a UI action (button, menu item, etc.) to move a loan from "pending" to "active" status — i.e., to disburse/approve a loan
actual: No visible way in the UI to change loan status from pending to active
errors: None — functionality appears missing rather than broken
reproduction: Create a new loan → loan is created with "pending" status → no button or action available to activate it
timeline: Likely never implemented — investigating now

## Eliminated

- hypothesis: Activation might happen at loan creation time (createLoan always sets "pending" status, never "active")
  evidence: loan.service.ts line 83: status: "pending" hardcoded on insert. Creation never activates.
  timestamp: 2026-03-22T00:00:00.000Z

- hypothesis: There is a separate activateLoan service function that exists but has no UI
  evidence: loan.service.ts only has createLoan, getLoan, listLoans. No activateLoan function exists anywhere.
  timestamp: 2026-03-22T00:00:00.000Z

- hypothesis: The loan list or customer pages might have activation actions
  evidence: loans/page.tsx has no row actions at all (no clickable rows, no dropdowns). No status change affordances.
  timestamp: 2026-03-22T00:00:00.000Z

## Evidence

- timestamp: 2026-03-22T00:00:00.000Z
  checked: src/services/loan.service.ts
  found: createLoan always inserts with status: "pending". No activateLoan function exists.
  implication: Activation is not handled at creation time and has no dedicated service function.

- timestamp: 2026-03-22T00:00:00.000Z
  checked: src/services/payment.service.ts lines 175-186
  found: recordPayment() transitions pending→active when first payment recorded (if not fully_paid). Comment says "Pitfall 6: pending -> active on first payment". deletePayment() reverts active→pending if all payments deleted.
  implication: Activation IS implemented — but it is implicit, triggered only by recording the first payment. There is no explicit "Activate Loan" pathway.

- timestamp: 2026-03-22T00:00:00.000Z
  checked: src/app/(app)/loans/[loanId]/loan-detail-client.tsx
  found: The loan detail page shows "Record Payment" and "Print Receipt" buttons unconditionally regardless of loan status. The SimulatorPanel is only shown for status === "active". There is no "Activate Loan" button, no pending-state message explaining that recording the first payment activates the loan.
  implication: Users have no indication that "Record Payment" is the activation mechanism. The UX is silent about the pending→active flow.

- timestamp: 2026-03-22T00:00:00.000Z
  checked: src/app/(app)/loans/page.tsx
  found: Loans list table shows status badge but has no row actions, no activation buttons.
  implication: No activation path from the list view either.

- timestamp: 2026-03-22T00:00:00.000Z
  checked: src/actions/loan.actions.ts
  found: Only createLoanAction, listLoansAction, getCollateralNaturesAction. No activateLoanAction.
  implication: The server actions layer also has no explicit activation capability.

## Resolution

root_cause: Loan activation (pending→active) is implemented implicitly in the payment service — it fires when the first payment is recorded. However, there is zero UI indication of this mechanism. The loan detail page for a pending loan shows generic buttons ("Record Payment", "Print Receipt") with no contextual explanation that recording a payment is also how you activate the loan. Users expecting an explicit "Activate" / "Disburse" button find nothing. The fix is a UI-layer change: add a pending-state callout on the loan detail page that explains the flow and makes the "Record Payment" CTA prominent and contextually framed as "disburse/activate".

fix: Added a pending-state amber callout banner at the top of the loan detail page (above the Outstanding Balance card) that renders only when loan.status === "pending". The banner explains that the loan is pending disbursement, that recording the first payment activates it, and provides a clearly labelled CTA button "Record First Payment to Activate". TypeScript compiles clean. Existing Cypress tests unaffected (cy.contains("Record Payment") still matches).
verification: TypeScript clean. Awaiting user confirmation of visual behaviour in browser.
files_changed:
  - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
