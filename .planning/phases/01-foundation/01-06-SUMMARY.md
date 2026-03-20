---
phase: 01-foundation
plan: 06
subsystem: ui
tags: [shadcn, tailwind, next.js, better-auth, app-shell, sidebar, auth-pages]

# Dependency graph
requires:
  - phase: 01-01
    provides: Database schema and project structure
  - phase: 01-03
    provides: Better Auth auth-client.ts with signIn/signUp/signOut/useSession exports

provides:
  - Collapsible sidebar with all nav groups (Dashboard, Operations, Capital, Insights, System)
  - TopBar with "Lending Manager" branding
  - AppShell combining TopBar + Sidebar + main content with Sheet-based mobile drawer
  - Protected (app) route group layout wrapping AppShell
  - Custom login page (email+password only, no Better Auth UI)
  - Custom register page (name/email/password/confirm-password)
  - Custom forgot-password page (email form, success message)
  - Pending-approval page (no sidebar, clear message, signOut button)
  - Dashboard placeholder page

affects: [02-payments, 02-receipts, 03-dashboard, all (app) route group pages]

# Tech tracking
tech-stack:
  added:
    - shadcn/ui components (input, label, card, table, badge, dropdown-menu, dialog, select, separator, sheet, sonner, tooltip)
    - "@base-ui/react (via shadcn components)"
  patterns:
    - App shell pattern with collapsible sidebar + top bar using useState
    - Route group layouts "(app)" for authenticated pages, "(auth)" for login/register
    - TooltipProvider wrapping sidebar navigation for icon-only rail tooltips
    - Sheet component for mobile sidebar drawer

key-files:
  created:
    - src/components/layout/app-shell.tsx
    - src/components/layout/sidebar.tsx
    - src/components/layout/top-bar.tsx
    - src/app/(app)/layout.tsx
    - src/app/(app)/dashboard/page.tsx
    - src/app/(auth)/layout.tsx
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/register/page.tsx
    - src/app/(auth)/forgot-password/page.tsx
    - src/app/pending-approval/page.tsx
    - src/components/ui/input.tsx
    - src/components/ui/label.tsx
    - src/components/ui/card.tsx
    - src/components/ui/table.tsx
    - src/components/ui/badge.tsx
    - src/components/ui/dropdown-menu.tsx
    - src/components/ui/dialog.tsx
    - src/components/ui/select.tsx
    - src/components/ui/separator.tsx
    - src/components/ui/sheet.tsx
    - src/components/ui/sonner.tsx
    - src/components/ui/tooltip.tsx
  modified: []

key-decisions:
  - "shadcn/ui uses @base-ui/react primitives (not Radix UI) -- TooltipTrigger has no asChild prop; render prop pattern used instead"
  - "TooltipProvider uses delay prop (not delayDuration) per @base-ui/react API"
  - "Better Auth client password reset uses authClient.requestPasswordReset (not forgetPassword)"
  - "Sidebar grayed-out items use opacity-50 pointer-events-none with tooltip saying Coming soon"
  - "Mobile sidebar uses Sheet component triggered by hamburger in TopBar"

patterns-established:
  - "Pattern: All (app) group pages are automatically wrapped in AppShell via (app)/layout.tsx"
  - "Pattern: Auth pages use (auth)/layout.tsx for centered max-w-md layout without app shell"
  - "Pattern: Pending-approval has its own inline layout (not in (auth) group) to differentiate"

requirements-completed:
  - INFR-03
  - AUTH-01

# Metrics
duration: 6min
completed: 2026-03-20
---

# Phase 01 Plan 06: App Shell, Auth Pages, and Nav Structure Summary

**Collapsible sidebar with full nav groups (grayed-out future sections), custom auth pages using shadcn/ui + Better Auth client, and responsive app shell with Sheet-based mobile drawer**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-20T11:23:14Z
- **Completed:** 2026-03-20T11:28:54Z
- **Tasks:** 2 of 3 (awaiting human verification checkpoint)
- **Files modified:** 22

## Accomplishments
- Installed 12 shadcn/ui components (all using @base-ui/react primitives, not Radix)
- Built collapsible sidebar: full nav from day one with grayed-out future sections (opacity-50 pointer-events-none + Coming soon tooltip)
- User avatar/initials + name/email + signOut button at sidebar bottom using useSession/signOut from auth-client
- AppShell: TopBar + Sidebar (desktop) + Sheet mobile drawer + scrollable main content area
- Custom login page: email+password only, no username, signIn from auth-client, error display
- Custom register page: name/email/password/confirmPassword, client-side validation, signUp from auth-client
- Forgot-password page using authClient.requestPasswordReset, success message hides form after submit
- Pending-approval page: no AppShell/Sidebar, clear message, signOut button

## Task Commits

Each task was committed atomically:

1. **Task 1: Install shadcn/ui components and build app shell layout** - `e57e8d7` (feat)
2. **Task 2: Create auth pages and pending-approval page** - `bb41b73` (feat)
3. **Task 3: Human verification checkpoint** - PENDING (awaiting human)

## Files Created/Modified
- `src/components/layout/app-shell.tsx` - AppShell combining TopBar + Sidebar + mobile Sheet + main content
- `src/components/layout/sidebar.tsx` - Collapsible sidebar with all nav groups, user avatar, signOut
- `src/components/layout/top-bar.tsx` - Fixed top bar with "Lending Manager" branding, mobile menu toggle
- `src/app/(app)/layout.tsx` - Protected route group layout wrapping AppShell
- `src/app/(app)/dashboard/page.tsx` - Dashboard placeholder
- `src/app/(auth)/layout.tsx` - Centered max-w-md auth layout without app shell
- `src/app/(auth)/login/page.tsx` - Login with email+password, signIn from auth-client
- `src/app/(auth)/register/page.tsx` - Register with name/email/password/confirmPassword, signUp
- `src/app/(auth)/forgot-password/page.tsx` - Password reset via authClient.requestPasswordReset
- `src/app/pending-approval/page.tsx` - Pending approval for unassigned users, signOut button
- `src/components/ui/*` - 12 shadcn/ui components installed

## Decisions Made

- shadcn components use @base-ui/react (not Radix UI) -- TooltipTrigger has no asChild prop; used render prop pattern
- TooltipProvider uses `delay` prop, not `delayDuration`
- Better Auth password reset is `authClient.requestPasswordReset` not `authClient.forgetPassword`
- Mobile sidebar uses Sheet component (slide-in drawer) triggered from TopBar hamburger button

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed shadcn Tooltip API mismatch — @base-ui/react vs Radix UI**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Plan specified `<TooltipTrigger asChild>` and `<TooltipProvider delayDuration={300}>` but shadcn@latest generates components using @base-ui/react which has different props (`delay` not `delayDuration`, no `asChild` on Trigger)
- **Fix:** Used `render` prop on TooltipTrigger and `delay` prop on TooltipProvider per @base-ui/react API
- **Files modified:** src/components/layout/sidebar.tsx
- **Verification:** TypeScript compiles clean (npx tsc --noEmit: zero errors)
- **Committed in:** e57e8d7 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Better Auth password reset method name**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** Used `authClient.forgetPassword` but Better Auth client exposes `authClient.requestPasswordReset`
- **Fix:** Changed to `authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })`
- **Files modified:** src/app/(auth)/forgot-password/page.tsx
- **Verification:** TypeScript compiles clean
- **Committed in:** bb41b73 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 - Bug)
**Impact on plan:** Both required for compilation. No scope creep. API surface differences from @base-ui/react vs Radix UI is the consistent underlying cause.

## Issues Encountered
- shadcn@latest in this project uses @base-ui/react primitives rather than Radix UI -- the component APIs differ from shadcn docs. Discovered at TypeScript compile time, resolved by reading the generated component source.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED

All created files exist on disk. Both task commits verified in git log.

## Next Phase Readiness
- App shell is complete and ready for all Phase 1 authenticated pages (customers, loans, admin)
- Sidebar nav items for Customers, Loans, Admin point to /customers, /loans, /admin -- pages to be built in Plans 07+
- Awaiting human verification of visual rendering and first-user-superadmin flow
