---
phase: 03-operational-management
plan: 04
subsystem: ui
tags: [bignumber, effect, drizzle, notifications, simulator, cron, popover]

# Dependency graph
requires:
  - phase: 03-01
    provides: notifications schema, Notification type, PopoverUI component, OverdueBadge
  - phase: 02-loan-operations
    provides: Payment type, Loan type, allocatePayment, calculateDaysOverdue from engine.ts
provides:
  - Repayment simulator panel on loan detail page (before/after comparison)
  - NotificationBell client component with unread badge, popover, and mark-all-as-read
  - Notification service (getNotifications, getUnreadCount, markAsRead, markAllAsRead, createNotificationsForLoan)
  - Notification Server Actions with auth guards
  - Extended cron route with per-user notification creation for loans due within 5 days
affects: [phase-04, testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SimulatorPanel as pure client-side calculation using engine.ts (no separate math)
    - Notification dedup pattern: check existing before insert (userId + loanId + dueDate)
    - Plain async createNotificationsForLoan (not Effect) for Route Handler context
    - Lazy load notification list on popover open, unread count fetched on mount

key-files:
  created:
    - src/components/loans/simulator-panel.tsx
    - src/services/notification.service.ts
    - src/actions/notification.actions.ts
    - src/components/notifications/notification-bell.tsx
  modified:
    - src/app/(app)/loans/[loanId]/loan-detail-client.tsx
    - src/components/layout/top-bar.tsx
    - src/app/api/cron/overdue/route.ts

key-decisions:
  - "SimulatorPanel uses allocatePayment and calculateDaysOverdue from engine.ts directly — same implementation as real payment recording (RISK-04 compliance)"
  - "createNotificationsForLoan is plain async (not Effect) — called from Route Handler, same pattern as writeAuditLog per project decision [01-04]"
  - "NotificationBell uses PopoverTrigger render prop with base-ui Button styling via buttonVariants — avoids asChild (not available on base-ui)"
  - "Notification dedup: check userId + loanId + dueDate before insert to prevent duplicates on repeated cron runs"
  - "Target users for notifications queried via raw SQL on user.role column — Better Auth stores role directly in user table"

patterns-established:
  - "Pattern 1: Client-side simulator — all calculation done in browser using same engine functions as server, no API round-trip"
  - "Pattern 2: Notification fan-out — create one row per user per loan per due date, with dedup guard"
  - "Pattern 3: Lazy notification loading — fetch full list only on popover open, unread count on mount only"

requirements-completed: ["RISK-03", "RISK-04", "ALRT-01"]

# Metrics
duration: 9min
completed: 2026-03-21
---

# Phase 3 Plan 04: Simulator and Notifications Summary

**Repayment simulator with before/after comparison using engine.ts allocatePayment, plus in-app notification bell with cron-generated per-user loan due alerts**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-21T06:21:33Z
- **Completed:** 2026-03-21T06:30:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Built SimulatorPanel component using engine.ts allocatePayment and calculateDaysOverdue — same implementation as real payments (RISK-04)
- Created full notification system: service, Server Actions, bell component with popover, unread badge (max 9+), per-item and mark-all-as-read
- Extended cron route to write per-user notifications for loans due within 5 days (ALRT-01) with dedup prevention
- Embedded SimulatorPanel in loan detail page for active loans only with edge-case messaging

## Task Commits

Each task was committed atomically:

1. **Task 1: Build repayment simulator panel and embed in loan detail page** - `60b280f` (feat)
2. **Task 2: Notification service, actions, bell component, top bar integration, and cron extension** - `e573ce0` (feat)

## Files Created/Modified
- `src/components/loans/simulator-panel.tsx` - Client component with before/after repayment simulation using real engine functions
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` - Added SimulatorPanel for active loans
- `src/services/notification.service.ts` - Effect-based notification CRUD + plain async createNotificationsForLoan for cron
- `src/actions/notification.actions.ts` - Server Actions for getNotifications, getUnreadCount, markAsRead, markAllAsRead
- `src/components/notifications/notification-bell.tsx` - Bell icon with unread badge (9+ cap), popover dropdown, lazy load
- `src/components/layout/top-bar.tsx` - Added NotificationBell as client island in server component
- `src/app/api/cron/overdue/route.ts` - Extended to create per-user notifications for loans due within 5 days

## Decisions Made
- SimulatorPanel uses allocatePayment and calculateDaysOverdue from engine.ts directly — single implementation, no separate math
- createNotificationsForLoan is plain async (not Effect) — consistent with writeAuditLog pattern [01-04] for Route Handler context
- Notification dedup: check userId + loanId + dueDate before insert prevents duplicate alerts on repeated cron runs
- Target users for notifications: raw SQL query on user.role IN ('admin', 'loanOfficer', 'superAdmin') — Better Auth stores role directly in "user" table

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `pnpm build` blocked by running dev server (Next.js 16 OS-level file lock on .next/). Resolved by verifying TypeScript compilation with `pnpm tsc --noEmit` which confirmed all files compile cleanly.
- Pre-existing TypeScript errors in `src/app/(app)/customers/[id]/page.tsx` (getPaymentsByLoanAction not exported) — confirmed pre-existing, out of scope for this plan. Logged to deferred items.

## Next Phase Readiness
- Simulator and notification system complete, ready for Phase 04 (reporting/analytics)
- Cron job writes notification rows; UI reads and displays them; full ALRT-01 requirement satisfied
- Pre-existing error in customers/[id]/page.tsx (getPaymentsByLoanAction) should be addressed in a follow-up

---
*Phase: 03-operational-management*
*Completed: 2026-03-21*
