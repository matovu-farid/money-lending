---
phase: 02-loan-operations
plan: "02"
subsystem: payments-ui
tags: [ui, loan-detail, payment-recording, payment-edit, payment-delete, shadcn]
dependency_graph:
  requires: [02-01]
  provides: [loan-detail-page, record-payment-form, edit-delete-dialogs]
  affects: [loan-operations-flow]
tech_stack:
  added: [textarea (shadcn), alert (shadcn), form.tsx (custom layout primitives)]
  patterns: [server-component-with-client-island, effect-runpromise-in-server-component, controlled-form-state]
key_files:
  created:
    - src/app/(app)/loans/[loanId]/page.tsx
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/app/(app)/loans/[loanId]/payments/new/page.tsx
    - src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx
    - src/components/ui/textarea.tsx
    - src/components/ui/form.tsx
    - src/components/ui/alert.tsx
  modified: []
decisions:
  - "Server component pattern: page.tsx fetches data via Effect.runPromise, passes to client component island"
  - "Dialog controlled state: open prop tied to editingPayment/deletingPayment state rather than DialogTrigger"
  - "base-ui MenuItem uses onClick not onSelect — corrected during implementation"
  - "form.tsx created as layout primitives (not react-hook-form) since controlled state is used throughout"
metrics:
  duration: "6 min"
  completed_date: "2026-03-21"
  tasks_completed: 2
  files_created: 7
---

# Phase 02 Plan 02: Loan Detail Page and Payment Recording Summary

Loan detail page at `/loans/[loanId]` with full payment history, edit/delete dialogs, and record-payment form at `/loans/[loanId]/payments/new` — the primary daily transaction loop UI.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Install shadcn components + record-payment form | 43570c2 | textarea.tsx, form.tsx, alert.tsx, page.tsx, record-payment-form.tsx |
| 2 | Loan detail page with payments table + edit/delete dialogs | f755ad7 | page.tsx, loan-detail-client.tsx |

## What Was Built

### Task 1: Record Payment Form

- `/loans/[loanId]/payments/new/page.tsx` — server component that awaits params (Next.js 16 async params) and renders `RecordPaymentForm`
- `record-payment-form.tsx` — client component with Payment Date (defaulting to today), Amount (UGX prefix inline, regex validation), optional Note textarea
- Loading state: Loader2 spinner + "Recording..." text during submission
- On success: `toast.success("Payment recorded successfully")` + router redirect to loan detail
- On error: `toast.error(result.error)` with form preserved

### Task 2: Loan Detail Page

- `/loans/[loanId]/page.tsx` — server component: fetches loan via `getLoan`, payments via `getPaymentsForLoan`, customer name via direct DB query; 404s on LoanNotFound
- `loan-detail-client.tsx` — client component island with full interactivity:
  - Loan header: ref in `font-mono text-xs`, status badge, principal, interest rate, start date, customer name
  - Outstanding balance focal point: `text-2xl font-semibold`, label `text-xs text-muted-foreground`, above payments table
  - Record Payment and Print Receipt CTAs
  - Payments table: 7 columns (Date, Amount, Interest Paid, Principal Paid, Balance After, Recorded By, Actions)
  - Soft-deleted rows: `opacity-60 line-through` on all cells, "Deleted" label in actions column
  - DropdownMenu per active row with `aria-label="Payment actions"` on trigger
  - Edit dialog: Amount + Date fields + required "Reason for edit" textarea, Discard Changes/Save Changes buttons
  - Delete dialog: "Delete payment?" heading + required "Reason for deletion" textarea, Keep Payment/Delete Payment buttons
  - Empty state: "No payments recorded" heading, body text, Record Payment CTA

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui MenuItem uses onClick not onSelect**
- **Found during:** Task 2 implementation
- **Issue:** The plan spec showed `onSelect` prop on DropdownMenuItem. base-ui/react `MenuItem` only accepts `onClick` (no onSelect prop)
- **Fix:** Changed `onSelect` to `onClick` on both DropdownMenuItems
- **Files modified:** loan-detail-client.tsx
- **Commit:** f755ad7

**2. [Rule 2 - Missing] shadcn form component not available in registry**
- **Found during:** Task 1 installation
- **Issue:** `npx shadcn@latest add form` returned no files — form component not in base-nova registry
- **Fix:** Created `form.tsx` as minimal layout primitives (FormItem, FormLabel, FormMessage) since controlled state is used throughout the codebase
- **Files modified:** src/components/ui/form.tsx
- **Commit:** 43570c2

## Verification

- `npx tsc --noEmit` exits 0 (excluding pre-existing errors in cypress/ and api/test/)
- All acceptance criteria for both tasks verified via grep checks
- Copywriting matches UI-SPEC contract exactly (Outstanding Balance, No payments recorded, Delete payment?, Reason for deletion, Reason for edit, Keep Payment, Discard Changes, Save Changes)

## Self-Check: PASSED

Files verified:
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/loans/[loanId]/page.tsx` — EXISTS
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/loans/[loanId]/loan-detail-client.tsx` — EXISTS
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/loans/[loanId]/payments/new/page.tsx` — EXISTS
- `/Users/faridmatovu/projects/money-lending/src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` — EXISTS
- `/Users/faridmatovu/projects/money-lending/src/components/ui/textarea.tsx` — EXISTS
- `/Users/faridmatovu/projects/money-lending/src/components/ui/form.tsx` — EXISTS

Commits verified:
- `43570c2` — feat(02-02): install shadcn components and build record-payment form page
- `f755ad7` — feat(02-02): loan detail page with payments table, edit/delete dialogs
