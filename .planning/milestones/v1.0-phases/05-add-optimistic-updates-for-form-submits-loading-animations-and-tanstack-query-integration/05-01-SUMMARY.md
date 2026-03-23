---
phase: 05-add-optimistic-updates-for-form-submits-loading-animations-and-tanstack-query-integration
plan: 01
subsystem: ux-infrastructure
tags: [tanstack-query, loading-ui, providers, spinner, cypress]
dependency_graph:
  requires: []
  provides: [QueryClientProvider, Spinner, loading-skeleton, optimistic-rollback-stubs]
  affects: [src/app/(app)/layout.tsx, all (app) pages]
tech_stack:
  added: ["@tanstack/react-query@5.94.5", "@tanstack/react-query-devtools@5.94.5"]
  patterns: [QueryClientProvider-wrapper, CSS-pulse-skeleton, Loader2-spinner-abstraction]
key_files:
  created:
    - src/components/providers.tsx
    - src/components/ui/spinner.tsx
    - src/app/(app)/loading.tsx
    - cypress/e2e/optimistic-rollback.cy.ts
  modified:
    - src/app/(app)/layout.tsx
    - cypress/e2e/expenses.cy.ts
    - cypress/e2e/income.cy.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "TanStack Query staleTime set to 60s as default for all queries — prevents excessive refetching on navigation"
  - "QueryClientProvider wraps AppShell (not just children) so sidebar/topbar are also within query context"
  - "Spinner adds data-testid='spinner' attribute to enable Cypress assertions in button-disabled stubs"
  - "loading.tsx is a zero-JS CSS-only skeleton using Tailwind animate-pulse — no client component needed"
metrics:
  duration: 2 min
  completed_date: "2026-03-22"
  tasks_completed: 3
  files_changed: 9
---

# Phase 05 Plan 01: TanStack Query Infrastructure and Loading UI Summary

**One-liner:** TanStack Query v5 installed with stable QueryClientProvider wrapper, CSS-only loading skeleton for (app) pages, reusable Loader2 Spinner component, and Wave 0 Cypress test stubs for optimistic rollback.

## What Was Built

### Task 0 — Wave 0 Cypress Test Scaffolds
Created `cypress/e2e/optimistic-rollback.cy.ts` with 4 `it.skip` stubs covering:
- Expense row rollback on server error
- Income row rollback on server error
- Expense delete rollback on server error
- Income delete rollback on server error

Added `it.skip` button-disabled assertion stubs to `expenses.cy.ts` and `income.cy.ts`. These will be un-skipped by plans 05-02 through 05-04.

### Task 1 — TanStack Query + Providers + Spinner
- Installed `@tanstack/react-query@5.94.5` and `@tanstack/react-query-devtools@5.94.5`
- Created `src/components/providers.tsx` — "use client" wrapper with stable QueryClient (staleTime 60s) and ReactQueryDevtools in dev
- Created `src/components/ui/spinner.tsx` — thin Loader2 wrapper with `data-testid="spinner"` for Cypress, `animate-spin` class

### Task 2 — Layout Wiring + Loading Skeleton
- Updated `src/app/(app)/layout.tsx` to wrap `<AppShell>` in `<Providers>` so the entire app shell is within query context
- Created `src/app/(app)/loading.tsx` — zero-JS CSS-only animate-pulse skeleton using bg-muted Tailwind classes

## Verification

All 97 vitest unit tests pass. TanStack Query v5 confirmed installed via `pnpm list`.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 0    | 3fba2c0 | test(05-01): scaffold Wave 0 Cypress stubs for optimistic rollback and button-disabled |
| 1    | 88949ec | feat(05-01): install TanStack Query and create Providers + Spinner components |
| 2    | 2ab81e4 | feat(05-01): wire Providers into app layout and add loading skeleton |
