---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: Phase 4 context gathered
last_updated: "2026-03-21T06:58:28.507Z"
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 15
  completed_plans: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.
**Current focus:** Phase 03 — operational-management

## Current Position

Phase: 03 (operational-management) — EXECUTING
Plan: 4 of 4 (COMPLETE)

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: 7 min
- Total execution time: 0.45 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 4 | 27 min | 7 min |

**Recent Trend:**

- Last 5 plans: 8 min
- Trend: on track

*Updated after each plan completion*
| Phase 01-foundation P05 | 5 | 2 tasks | 5 files |
| Phase 01-foundation P06 | 6 | 2 tasks | 22 files |
| Phase 01-foundation P07 | 18 | 2 tasks | 6 files |
| Phase 02-loan-operations P01 | 7 | 2 tasks | 10 files |
| Phase 02-loan-operations P03 | 3 | 2 tasks | 5 files |
| Phase 02-loan-operations P04 | 8 | 2 tasks | 5 files |
| Phase 02-loan-operations P02 | 6 | 2 tasks | 7 files |
| Phase 03-operational-management P01 | 15 | 3 tasks | 18 files |
| Phase 03-operational-management P04 | 9 | 2 tasks | 7 files |
| Phase 03-operational-management P02 | 25 | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-phase]: Better Auth replaces Clerk — self-hosted RBAC plugin, no vendor lock-in; all auth middleware must use Better Auth session API
- [Pre-phase]: Interest is calculated on-demand from loan history (no daily accrual rows) — cron handles overdue detection and alerts only, not financial math
- [Pre-phase]: All monetary arithmetic uses BigNumber library — no native JS float operations on money values anywhere in the codebase
- [Phase 1]: Loans are perpetual — no term_days, no due_date. Payment table is the rate-period source of truth with principal_balance_before/after columns.
- [01-01]: No Zod installed — Server Actions use TypeScript types; only Better Auth catch-all Route Handler handles its own validation.
- [01-01]: Collateral is a separate table (collateral.ts) with loanId FK, not inline columns on loans.
- [01-01]: INFR-06 Layer deferral — services return Effect<S,E,never> with db closed over module scope; full Context.Tag/Layer wiring deferred to Phase 2.
- [01-02]: Math.max is acceptable for integer day-count comparison (non-monetary) — BigNumber used exclusively for monetary arithmetic.
- [01-02]: calculateLoanSummary fields use totalInterestAtMinPeriod/totalOwedAtMinPeriod naming (not 30Days suffix) because min period is overridable per LOAN-11.
- [01-02]: calculateDaysOverdue returns BigNumber(0) when unpaid interest <= 0 — correct business behavior for fully current loan.
- [01-03]: First-user-superadmin via databaseHooks.user.create.after using raw SQL count — avoids circular deps and missing request headers inside hook.
- [01-03]: proxy.ts uses auth.api.getSession (full DB lookup) not cookie-only — required for session.user.role check; cookieCache (5-min) mitigates cost.
- [01-03]: AUTH-04 satisfied by Better Auth session table — each login creates a row with userId and createdAt; no extra audit hook needed.
- [01-03]: RESOLVED — Better Auth RBAC plugin API verified; unassignedRole requires 'as any' cast for empty newRole({}) due to TypeScript Subset<never> inference.
- [01-04]: writeAuditLog is plain async (not Effect) — Effect.runPromise inside Drizzle tx callbacks causes runtime errors (RESEARCH.md Pitfall 7).
- [01-04]: No Zod in customer Server Actions — TypeScript types + runtime string guards satisfy INFR-02 per user decision.
- [Phase 01-foundation]: LOAN-11 vs AUTH-03 resolved: per-loan overrides are admin+, global system defaults require superAdmin per AUTH-03 capability table
- [Phase 01-foundation]: [01-05]: writeAuditLog called with direct await inside db.transaction -- not Effect.runPromise to avoid Pitfall 7
- [Phase 01-foundation]: shadcn@latest uses @base-ui/react primitives (not Radix) -- TooltipTrigger has no asChild prop; render prop pattern required
- [Phase 01-foundation]: Better Auth password reset client method is authClient.requestPasswordReset (not forgetPassword)
- [Phase 01-foundation]: buttonVariants used with Link for link-button elements — base-ui Button has no asChild prop
- [Phase 01-foundation]: Admin page uses authClient.admin.listUsers with result.data cast via (result.data as any)?.users due to Better Auth type complexity
- [Phase 01-foundation]: Email verification enabled via Better Auth requireEmailVerification + Resend integration — registration flow requires email verification before login; CYPRESS=true bypasses to in-memory store for E2E tests
- [Phase 02-loan-operations]: allocatePayment takes params object (not positional args) for clarity with 5 inputs
- [Phase 02-loan-operations]: recalculateFromPayment is internal (not exported) — called only from editPayment and deletePayment
- [Phase 02-loan-operations]: deletePayment reverts loan to pending if no active payments remain after deletion
- [Phase 02-loan-operations]: PrintButton extracted as 'use client' component — window.print() requires browser context; receipt page is a Server Component
- [Phase 02-loan-operations]: Repayment receipt imports PrintButton from disbursement folder — single source of truth for print trigger
- [Phase 02-loan-operations]: sendAdminNotification is fire-and-forget (void, never await) -- email failure never blocks user Server Action
- [Phase 02-loan-operations]: Cron endpoint /api/cron/overdue is detection-only (no DB writes) -- Phase 3 stores flagged results for watchlist UI
- [Phase 02-loan-operations]: Server component + client island: page.tsx fetches via Effect.runPromise, passes props to LoanDetailClient
- [Phase 02-loan-operations]: base-ui MenuItem uses onClick not onSelect -- DropdownMenuItems use onClick handler
- [Phase 03-operational-management]: Migration applied via psql directly — drizzle-kit migrate hangs on pooled Neon connection; unpooled URL used for psql; migration records inserted into drizzle.__drizzle_migrations manually
- [Phase 03-operational-management]: tsconfig.json excludes cypress/ directory to prevent Next.js TypeScript build from checking Cypress specs (it.todo is Cypress-only API)
- [Phase 03]: Outstanding balance calculated per-loan via principalBalanceAfter of last payment — matches loan detail page pattern and payment table source of truth
- [Phase 03]: Watchlist >= 30 day threshold uses identical calculateDaysOverdue engine calls as cron endpoint for RISK-04 compliance — no calculation drift
- [Phase 03]: capitalInSystem hardcoded to 0.00 with Phase 4 subtitle — creditor data not yet available
- [Phase 03-operational-management]: SimulatorPanel uses allocatePayment and calculateDaysOverdue from engine.ts directly — same implementation as real payment recording (RISK-04 compliance)
- [Phase 03-operational-management]: createNotificationsForLoan is plain async (not Effect) — called from Route Handler, same pattern as writeAuditLog [01-04]
- [Phase 03-operational-management]: Notification dedup: check userId + loanId + dueDate before insert prevents duplicate alerts on repeated cron runs
- [Phase 03-operational-management]: getPaymentsByLoanAction added for customer profile loan history lazy-load (includes soft-deleted payments)

### Pending Todos

None yet.

### Blockers/Concerns

- RESOLVED [Phase 1]: Better Auth RBAC plugin API verified against installed package docs; implemented correctly in 01-03
- [Phase 2]: @react-pdf/renderer React 19 compatibility is unverified — must test in the actual Next.js 16 + React 19 environment before committing to it for receipt generation
- RESOLVED [Pre-phase]: Client's operating timezone confirmed as Africa/Kampala — set in .env and .env.example
- RESOLVED [Phase 1]: Drizzle ORM version confirmed as 0.45.1 and migration API confirmed — schema written

## Session Continuity

Last session: 2026-03-21T06:58:28.504Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-financial-reporting/04-CONTEXT.md
