# POS Receipts (Thermal Printer Style)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Auto-display a narrow thermal-printer-style receipt in a modal after loan issuance and payment registration, with a print button that triggers browser print at 80mm width. Existing PDF receipts remain as a separate option.

**Architecture:** New `<PosReceipt>` client component with `@media print` CSS for 80mm width. Two variants: disbursement and repayment. Integrated into existing flows via modal that auto-opens on success. Receipt number format: `RCP-YYYYMMDD-XXXX`.

**Tech Stack:** Next.js, React, shadcn/ui Dialog, CSS @media print

---

## Existing Code Context

### Loan creation flow
- **Hook:** `src/hooks/use-create-loan.ts` — `useCreateLoan()` returns a TanStack `useMutation`. On success, the `result` is `{ data: { ...loan, collateral } }` (a Loan record with collateral joined). Currently calls `toast.success` then `router.push(/customers/${input.customerId})`.
- **Page:** `src/app/(app)/loans/new/page.tsx` — Multi-step form. Calls `createLoan.mutate(input)`. Has access to `customerName` (from query), `collateralNature`, `collateralDescription`, `principalAmount`, `interestRateDisplay`, `startDate` via form state.

### Payment registration flow
- **Form:** `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` — Calls `recordPaymentAction(input)` in `startTransition`. Result is `{ data: Payment }` where Payment has `id, amount, interestPortion, principalPortion, principalBalanceBefore, principalBalanceAfter, paymentDate, loanId`. Currently calls `toast.success` then `router.push(/loans/${loanId})`.
- **Page:** `src/app/(app)/loans/[loanId]/payments/new/page.tsx` — Server component, only passes `loanId` to the form. Customer name and officer name are NOT currently available in this component.

### Existing PDF receipts (untouched by this plan)
- `src/app/(app)/receipts/disbursement/[loanId]/page.tsx` — Server component, full-page receipt
- `src/app/(app)/receipts/repayment/[paymentId]/page.tsx` — Server component, full-page receipt

### Shared utilities
- `formatCurrency` and `formatDate` from `@/lib/utils`
- shadcn/ui: Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button
- lucide-react icons: `Printer`, `X`

---

## Tasks

### Task 1: POS receipt print styles

- [ ] **File:** `src/app/globals.css` (append to existing file)
- [ ] Add a `@media print` block gated by `.pos-receipt-print-active` on `<body>`:
  - Hide everything except `.pos-receipt` container
  - Set page width to 80mm, zero margins (`@page { size: 80mm auto; margin: 0; }`)
  - `.pos-receipt` gets: `width: 80mm`, `font-family: monospace`, `font-size: 11px`, `padding: 4mm`
  - All other elements: `display: none !important`
  - `.pos-receipt` and its children: `display: block !important` (override the hide-all)
- [ ] Verify: styles only activate when body has `.pos-receipt-print-active` class, no effect on normal screen rendering

```css
/* POS Receipt Print Styles */
@media print {
  body.pos-receipt-print-active * {
    display: none !important;
  }
  body.pos-receipt-print-active .pos-receipt,
  body.pos-receipt-print-active .pos-receipt * {
    display: block !important;
  }
  body.pos-receipt-print-active .pos-receipt {
    position: fixed;
    top: 0;
    left: 0;
    width: 80mm;
    font-family: "Courier New", Courier, monospace;
    font-size: 11px;
    padding: 4mm;
    background: white;
    color: black;
  }
  @page {
    size: 80mm auto;
    margin: 0;
  }
}
```

---

### Task 2: POS Receipt component — Disbursement variant

- [ ] **New file:** `src/components/receipts/pos-receipt-disbursement.tsx`
- [ ] `"use client"` component
- [ ] Props interface:

```typescript
interface PosReceiptDisbursementProps {
  receiptNumber: string         // RCP-YYYYMMDD-XXXX
  date: string                  // ISO date string
  customerName: string
  customerNin?: string
  loanAmount: string            // numeric string
  interestRate: string          // display string e.g. "10%"
  collateralNature: string
  collateralDescription?: string
  officerName: string
}
```

- [ ] Render narrow receipt layout (`max-w-[300px] mx-auto` on screen, `pos-receipt` class for print):
  - **Header:** "SOVEREIGN LEDGER" centered, uppercase, bold monospace. Below: "LOAN DISBURSEMENT" subtitle
  - **Dashed separator:** `border-dashed border-t border-black` between sections (simulates thermal printer perforation)
  - **Receipt #:** Left-aligned, date right-aligned on same line
  - **Customer section:** Name, NIN (if provided)
  - **Loan section:** Amount (formatted with `formatCurrency`), Interest Rate, Collateral nature + description
  - **Officer:** "Issued by: {name}"
  - **Footer dashed line**, then "Thank you for your business" centered, then "--- Sovereign Ledger ---"
- [ ] Use `formatCurrency` from `@/lib/utils` for money formatting
- [ ] Use `formatDate` from `@/lib/utils` for date formatting
- [ ] All text monospace, tight line-height, mimicking thermal printer output

---

### Task 3: POS Receipt component — Repayment variant

- [ ] **New file:** `src/components/receipts/pos-receipt-repayment.tsx`
- [ ] `"use client"` component
- [ ] Props interface:

```typescript
interface PosReceiptRepaymentProps {
  receiptNumber: string         // RCP-YYYYMMDD-XXXX
  date: string                  // ISO date string
  customerName: string
  loanReference: string         // e.g. "LOAN-AB12CD34"
  amountPaid: string            // numeric string
  interestPortion: string       // numeric string
  principalPortion: string      // numeric string
  balanceAfter: string          // numeric string
  officerName: string
}
```

- [ ] Same narrow layout as disbursement variant with `pos-receipt` class
- [ ] Sections:
  - **Header:** "SOVEREIGN LEDGER" + "PAYMENT RECEIPT"
  - **Receipt # + date**
  - **Customer:** Name, Loan Ref
  - **Payment breakdown:** Amount Paid, Interest Portion, Principal Portion (each on own line with label left, value right)
  - **Balance after:** Prominently displayed
  - **Officer:** "Received by: {name}"
  - **Footer:** "Thank you" + "--- Sovereign Ledger ---"

---

### Task 4: Receipt number generator utility

- [ ] **New file:** `src/lib/receipt-number.ts`
- [ ] Export function `generateReceiptNumber(): string`
  - Format: `RCP-YYYYMMDD-XXXX` where XXXX is random alphanumeric (uppercase)
  - Uses current date
- [ ] Pure function, no side effects, easy to test

```typescript
export function generateReceiptNumber(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `RCP-${date}-${rand}`
}
```

---

### Task 5: POS Receipt Modal wrapper

- [ ] **New file:** `src/components/receipts/pos-receipt-modal.tsx`
- [ ] `"use client"` component
- [ ] Props:

```typescript
interface PosReceiptModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode     // the PosReceipt variant component
  title?: string                // dialog accessible title
}
```

- [ ] Uses shadcn `Dialog` (`DialogContent`, `DialogHeader`, `DialogTitle`)
- [ ] Dialog content: scrollable area with the receipt centered, max-h for overflow
- [ ] **Footer buttons:**
  - "Print Receipt" button (Printer icon): adds `pos-receipt-print-active` class to `document.body`, calls `window.print()`, removes class in `afterprint` listener
  - "Close" button: calls `onClose`
- [ ] `onOpenChange` mapped to `onClose` when closing
- [ ] The Dialog should NOT be dismissible by clicking outside (user must explicitly close) — use `onInteractOutside={(e) => e.preventDefault()}`

---

### Task 6: Integrate into loan creation flow

- [ ] **Modify:** `src/hooks/use-create-loan.ts`
  - Remove `router.push` from `onSuccess` — the navigation now happens after modal close
  - Instead, make `onSuccess` return/store the created loan data so the page can react
  - Change approach: add a callback-based pattern. Accept an optional `onSuccessCallback` that receives `result.data` (the loan with collateral). The hook calls this callback instead of navigating.
  - Keep `toast.success`

- [ ] **Modify:** `src/app/(app)/loans/new/page.tsx`
  - Add state: `const [receiptData, setReceiptData] = useState<{...} | null>(null)`
  - Pass success callback to `useCreateLoan` or handle in `.mutate()` `onSuccess`:
    ```typescript
    createLoan.mutate(input, {
      onSuccess: (result) => {
        if (!("error" in result)) {
          setReceiptData({
            loan: result.data,
            customerName,
            collateralNature,
            collateralDescription,
            interestRateDisplay,
          })
        }
      }
    })
    ```
  - Render `<PosReceiptModal>` with `<PosReceiptDisbursement>` when `receiptData` is set
  - On modal close: `router.push(/customers/${receiptData.loan.customerId})` then `setReceiptData(null)`
  - Generate receipt number with `generateReceiptNumber()` when setting receipt data
  - Officer name: use session user name. Fetch via `useSession()` from better-auth client, or pass from a context. Check what auth hook is available.

- [ ] **Check auth client:** Look for existing `useSession` usage in the codebase to get current user name for the officer field. If not available client-side, the `createLoanAction` return value has the loan but not the officer name — may need to include `session.user.name` in the action response, or fetch it separately.

---

### Task 7: Integrate into payment registration flow

- [ ] **Modify:** `src/app/(app)/loans/[loanId]/payments/new/page.tsx`
  - Fetch loan + customer data server-side (loan to get customerId, customer to get name)
  - Pass `customerName` and `loanReference` (formatted) as props to `RecordPaymentForm`

- [ ] **Modify:** `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`
  - Add props: `customerName: string`, `loanReference: string`
  - Add state: `const [receiptData, setReceiptData] = useState<Payment | null>(null)`
  - After successful `recordPaymentAction`, instead of navigating, store `result.data` in state
  - Keep `toast.success` and cache invalidation
  - Render `<PosReceiptModal>` with `<PosReceiptRepayment>` when `receiptData` is set
  - On modal close: `router.push(/loans/${loanId})`
  - Officer name: same approach as Task 6 — use session user name
  - Generate receipt number with `generateReceiptNumber()`

---

### Task 8: Cypress E2E tests

- [ ] **New file:** `cypress/e2e/pos-receipts.cy.ts`
- [ ] Tests:

```
describe("POS Receipts", () => {
  describe("Loan Disbursement Receipt", () => {
    - it("shows POS receipt modal after successful loan creation")
      // Seed a customer, fill loan form through all steps, submit
      // Assert: Dialog is visible with "SOVEREIGN LEDGER" and "LOAN DISBURSEMENT"
      // Assert: Receipt number matches RCP-XXXXXXXX-XXXX pattern
      // Assert: Customer name, loan amount, interest rate, collateral visible
      // Assert: "Print Receipt" button exists
      // Assert: "Close" button exists

    - it("navigates to customer page after closing receipt modal")
      // Create loan, wait for modal, click Close
      // Assert: URL is /customers/{customerId}

    - it("print button exists and is clickable")
      // Create loan, wait for modal
      // Assert: Print Receipt button is not disabled
  })

  describe("Payment Receipt", () => {
    - it("shows POS receipt modal after successful payment recording")
      // Seed loan with active status, navigate to record payment
      // Fill amount + date, submit
      // Assert: Dialog visible with "SOVEREIGN LEDGER" and "PAYMENT RECEIPT"
      // Assert: Amount paid, interest portion, principal portion, balance visible
      // Assert: Print and Close buttons exist

    - it("navigates to loan detail page after closing receipt modal")
      // Record payment, wait for modal, click Close
      // Assert: URL is /loans/{loanId}
  })
})
```

- [ ] Run: `npx cypress run --spec cypress/e2e/pos-receipts.cy.ts`
- [ ] All tests must pass before this task is complete

---

## File Summary

| Action | Path |
|--------|------|
| Modify | `src/app/globals.css` |
| Create | `src/components/receipts/pos-receipt-disbursement.tsx` |
| Create | `src/components/receipts/pos-receipt-repayment.tsx` |
| Create | `src/lib/receipt-number.ts` |
| Create | `src/components/receipts/pos-receipt-modal.tsx` |
| Modify | `src/hooks/use-create-loan.ts` |
| Modify | `src/app/(app)/loans/new/page.tsx` |
| Modify | `src/app/(app)/loans/[loanId]/payments/new/page.tsx` |
| Modify | `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` |
| Create | `cypress/e2e/pos-receipts.cy.ts` |

## Key Decisions

1. **Receipt number is client-generated** — `RCP-YYYYMMDD-XXXX` with random suffix. Not persisted to DB. This is a display-only value for the thermal printout. The existing PDF receipts use `LOAN-{id}` and `PAY-{id}` formats and remain unchanged.

2. **Modal blocks navigation** — The modal uses `onInteractOutside` prevention. User must explicitly click Close or Print then Close. This ensures they see the receipt and have a chance to print.

3. **Officer name from session** — The current user (who is performing the action) is the officer. Use the auth client's `useSession()` hook to get `session.user.name`. If the hook is not already used in these components, add it.

4. **Payment form needs new server-side props** — The record payment page currently only passes `loanId`. It needs to also fetch and pass `customerName` and a formatted loan reference so the receipt can display them without an extra client fetch.

5. **`useCreateLoan` hook change is minimal** — Instead of restructuring the hook, use TanStack Query's per-call `onSuccess` option in `.mutate(input, { onSuccess })` to intercept the result at the call site. The hook's built-in `onSuccess` still handles toast + cache invalidation, but the `router.push` moves to the modal's `onClose`.
