---
phase: 02-loan-operations
plan: "04"
subsystem: infra
tags: [resend, email, cron, notifications, overdue-detection]

# Dependency graph
requires:
  - phase: 02-loan-operations
    provides: payment Server Actions (recordPaymentAction, editPaymentAction, deletePaymentAction) and createLoanAction

provides:
  - src/lib/email.ts with sendAdminNotification for fire-and-forget admin alerts
  - /api/cron/overdue GET endpoint for overdue loan detection (INFR-04)
  - Email wired into all 4 financial event Server Actions

affects:
  - 03-reporting (watchlist will call /api/cron/overdue and display flagged loans)
  - any future Server Action (pattern: fire-and-forget email notification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget: void sendAdminNotification() — never await, never blocks user tx"
    - "Dynamic admin recipient query: fetch admin/superAdmin emails at send time"
    - "Cron secret auth: x-cron-secret header checked against CRON_SECRET env var"

key-files:
  created:
    - src/lib/email.ts
    - src/app/api/cron/overdue/route.ts
  modified:
    - src/actions/payment.actions.ts
    - src/actions/loan.actions.ts
    - .env.example

key-decisions:
  - "Used db.execute(sql`...`) for admin user query — avoids needing Better Auth table types"
  - "Cast db.execute result as Array<{email: string}> via unknown — consistent with auth.ts raw SQL pattern"
  - "Cron endpoint is read-only (no DB writes) — Phase 3 stores flagged results for watchlist UI"
  - "calculateInterest used for total interest accrued approximation — same engine as payment allocation (RISK-04)"

patterns-established:
  - "Email notification: always void (fire-and-forget), never await, catch inside utility"
  - "Cron endpoint pattern: header auth check first, then business logic, then structured JSON response"

requirements-completed: [ALRT-02, INFR-04]

# Metrics
duration: 8min
completed: 2026-03-20
---

# Phase 02 Plan 04: Email Notifications and Cron Overdue Detection Summary

**Resend-based admin email notifications wired fire-and-forget into all 4 financial Server Actions, plus INFR-04 cron endpoint detecting loans with 30+ days overdue using the shared interest engine**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-20T21:40:00Z
- **Completed:** 2026-03-20T21:48:16Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created shared email utility `src/lib/email.ts` with `sendAdminNotification` that queries DB dynamically for admin/superAdmin recipients
- Wired fire-and-forget email calls into all 4 financial Server Actions (payment.created, payment.updated, payment.deleted, loan.disbursed)
- Created `/api/cron/overdue` GET Route Handler with x-cron-secret auth, returning flagged loan IDs for Phase 3 watchlist consumption

## Task Commits

Each task was committed atomically:

1. **Task 1: Email notification utility** - `3ff674e` (feat) — email.ts created
2. **Task 1: Wire into Server Actions** - `59f6d44` (feat) — payment.actions.ts, loan.actions.ts, .env.example
3. **Task 2: INFR-04 cron endpoint** - `764110b` (feat) — route.ts created

## Files Created/Modified

- `src/lib/email.ts` - sendAdminNotification utility using Resend; dynamically queries admin/superAdmin emails; fire-and-forget error handling
- `src/app/api/cron/overdue/route.ts` - INFR-04 cron endpoint; x-cron-secret auth; uses calculateDaysOverdue + calculateDailyRate + calculateInterest from shared engine; flags loans with >= 30 days overdue
- `src/actions/payment.actions.ts` - Added fire-and-forget notifications for payment.created, payment.updated, payment.deleted
- `src/actions/loan.actions.ts` - Added fire-and-forget notification for loan.disbursed
- `.env.example` - Added CRON_SECRET variable

## Decisions Made

- Used `db.execute(sql\`...\`)` for admin user query in email.ts — matches the raw SQL pattern established in auth.ts databaseHooks; avoids needing Better Auth user table Drizzle schema types
- Cron endpoint is detection-only (no DB writes) — Phase 3 will store flagged results and surface in watchlist UI
- calculateInterest used for total interest accrued approximation over full loan lifespan — sufficient for flagging purposes; matches RISK-04 pattern (one engine, not duplicate)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

`CRON_SECRET` must be set in `.env` before the cron endpoint can be called by an external scheduler. Added to `.env.example` and also set a dev value in `.env`.

## Next Phase Readiness

- Phase 3 (reporting/watchlist) can call `GET /api/cron/overdue` with `x-cron-secret` header to get flagged loan IDs
- `sendAdminNotification` is available for any future financial events that require admin alerting

---
*Phase: 02-loan-operations*
*Completed: 2026-03-20*
