---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Payments
status: unknown
stopped_at: Completed 09-01-PLAN.md
last_updated: "2026-03-23T18:05:21.197Z"
last_activity: 2026-03-23
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 12
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.
**Current focus:** Phase 09 — design-system-overhaul-apply-sovereign-ledger-design-system-across-the-entire-app

## Current Position

Phase: 09 (design-system-overhaul-apply-sovereign-ledger-design-system-across-the-entire-app) — EXECUTING
Plan: 1 of 6

## Performance Metrics

**Velocity:**

- Total plans completed: 1 (v1.1)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 6. Global Payments List | 0/2 | — | — |
| 7. Daily Collections View | 0/2 | — | — |
| 8. Quick-Record Workflow | 1/2 | 7min | 7min |
| Phase 06 P01 | 6 | 2 tasks | 8 files |
| Phase 06 P02 | 3 | 1 tasks | 3 files |
| Phase 07 P01 | 3 | 2 tasks | 6 files |
| Phase 07 P02 | 28 | 2 tasks | 4 files |
| Phase 08 P02 | 7min | 2 tasks | 4 files |
| Phase 09 P01 | 12min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key decisions relevant to v1.1:

- No new npm packages — entire feature set covered by existing stack (Drizzle, TanStack Query, date-fns, shadcn/ui base-ui, Effect.js, BigNumber.js, Server Actions)
- No `cmdk` — loan search combobox built from `<Popover>` + `<Input>` to avoid Radix peer-dependency conflicts
- `listPayments` service must always apply `isNull(deletedAt)` — `getPaymentsForLoan` intentionally includes soft-deleted rows (different contract)
- All date-grouping queries must use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` — never bare `DATE(payment_date)`
- Sidebar `disabled: true` removal is the last step of Phase 8, not the first
- [Phase 06]: Partial index defined inside pgTable second arg array — standalone export causes JSON.parse error on undefined defaultConfig in drizzle 0.45.1
- [Phase 06]: listPayments always applies isNull(deletedAt) as first condition; getPaymentsForLoan intentionally includes soft-deleted rows (different contracts)
- [Phase 06]: dateTo inclusive boundary: append T23:59:59.999Z to include same-day payments
- [Phase 07]: getLoansDueToday uses loan.startDate as anchor when loan has zero payments — consistent with watchlist.service.ts
- [Phase 07]: Integration test timestamps use T09:00:00Z (noon Kampala UTC+3) to avoid date boundary ambiguity in PGlite
- [Phase 07]: useLoansDueToday staleTime 5 minutes — due-today list is date-independent
- [Phase 07]: base-ui PopoverTrigger uses render prop pattern, not asChild — fix applied to DailyCollectionsTab
- [Phase 07]: Cypress date navigation tests use URL-param-visit approach — router.push does not update headless browser URL from nested components
- [Phase 08]: drizzle postgres-js db.execute returns RowList directly — use Array.from(rows), not result.rows
- [Phase 08]: searchActiveLoans guards against < 2 char queries to prevent costly full-table ilike scans
- [Phase 08]: getRecentlyCollectedLoansAction takes no parameters — userId always from server session to prevent spoofing
- [Phase 08]: LoanSearchCombobox uses plain div dropdown instead of base-ui Popover — PopoverTrigger render prop intercepts input onChange events in headless environments
- [Phase 08]: QuickRecordDialog success state replaces form content inline (same dialog, no auto-close) — Record another resets all state
- [Phase 09]: Canvas pixel-read used in Cypress to convert OKLCH/lab computed colors to sRGB — browser resolves oklch to lab() not rgb() in Electron/Chromium
- [Phase 09]: Print @media block adds :root token reset for --background/--foreground to pure white/black for receipt printing

### Pending Todos

None.

### Roadmap Evolution

- Phase 9 added: Design System Overhaul — Apply Sovereign Ledger design system across the entire app

### Blockers/Concerns

- [v1.0]: @react-pdf/renderer React 19 compatibility is unverified — must test before relying on it further
- [Phase 7]: "Due today" aggregation query (MAX(paymentDate) per active loan, 30+ days) has no existing Drizzle analogue — prototype syntax against PGlite during planning
- [Phase 7]: AT TIME ZONE 'Africa/Kampala' cast behavior in PGlite (UTC) test environment must be verified — integration tests may need UTC-pinned assertions

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260322-s7a | Remove pending loan status - loans are active immediately on creation | 2026-03-22 | 2343065 | [260322-s7a-remove-pending-loan-status-loans-are-act](./quick/260322-s7a-remove-pending-loan-status-loans-are-act/) |
| 260322-sl5 | Admin edit/delete loans with temporary loan officer window | 2026-03-22 | 59e3500 | [260322-sl5-admin-edit-delete-loans-with-temporary-l](./quick/260322-sl5-admin-edit-delete-loans-with-temporary-l/) |

## Session Continuity

Last session: 2026-03-23T18:05:21.195Z
Last activity: 2026-03-23
Stopped at: Completed 09-01-PLAN.md
Resume file: None
