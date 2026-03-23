---
phase: 05-add-optimistic-updates-for-form-submits-loading-animations-and-tanstack-query-integration
plan: "02"
subsystem: ui-forms
tags: [useTransition, loading-states, ux, auth, forms]
dependency_graph:
  requires: ["05-01"]
  provides: [form-loading-spinners, useTransition-pattern]
  affects: [login, register, forgot-password, customers-new, loans-new, creditors-new, record-payment-form]
tech_stack:
  added: []
  patterns: [useTransition, Loader2-spinner, startTransition-async-wrapper]
key_files:
  created: []
  modified:
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/register/page.tsx
    - src/app/(auth)/forgot-password/page.tsx
    - src/app/(app)/customers/new/page.tsx
    - src/app/(app)/loans/new/page.tsx
    - src/app/(app)/creditors/new/page.tsx
    - src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx
decisions:
  - "useTransition replaces useState(loading/submitting) in all navigate-away and auth forms — React 19 scheduler-aware pending, no manual boolean toggle"
  - "Client-side validation runs outside startTransition (before async, allows early return without starting transition)"
  - "Auth forms use no optimistic updates — spinner only, per RESEARCH.md Pitfall 4"
  - "Loan wizard: only final createLoanAction call uses useTransition; step navigation buttons remain synchronous"
  - "creditors/new: window.location.href replaced with router.push for consistency within transition"
metrics:
  duration: 3 min
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 7
---

# Phase 05 Plan 02: useTransition Loading Spinners for All Forms Summary

All 7 navigate-away and auth forms upgraded from manual `useState(loading/submitting)` to `useTransition` with Loader2 spinner animations, providing React 19 scheduler-aware loading feedback across every form in the app.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Upgrade auth forms to useTransition | 94b1326 | login/page.tsx, register/page.tsx, forgot-password/page.tsx |
| 2 | Upgrade navigate-away app forms to useTransition | c2d5757 | customers/new, loans/new, creditors/new, record-payment-form |

## What Was Built

**Pattern applied to all 7 forms:**
- `const [isPending, startTransition] = useTransition()` replaces `useState(false)`
- Async action call wrapped in `startTransition(async () => { ... })`
- Submit button: `disabled={isPending}` + Loader2 spinner + pending text
- Client-side validation runs outside `startTransition` (synchronous early return preserved)

**Button pending text per form:**
- Login: "Signing in..."
- Register: "Creating account..."
- Forgot password: "Sending..."
- New customer: "Registering..."
- New loan (step 3): "Issuing Loan..."
- New creditor: "Registering..."
- Record payment: "Recording..."

## Verification

- `grep -rn "setSubmitting|setLoading"` returns nothing in all modified auth and app form directories
- All 6 named form files show `useTransition` in both import and usage (count: 2 per file)
- `npx vitest run` — 97 tests pass, 6 test files pass

## Deviations from Plan

**1. [Rule 1 - Bug] creditors/new: replaced window.location.href with router.push**
- **Found during:** Task 2
- **Issue:** `window.location.href = "/creditors"` inside `startTransition` causes a full page navigation that bypasses React's transition tracking; `router.push` is the correct Next.js navigation method inside transitions
- **Fix:** Replaced `window.location.href = "/creditors"` with `router.push("/creditors")` — requires adding `useRouter` import (which was missing from the original file)
- **Files modified:** `src/app/(app)/creditors/new/page.tsx`
- **Commit:** c2d5757

## Self-Check: PASSED
