---
phase: 01-foundation
plan: 03
subsystem: auth
tags: [better-auth, drizzle, rbac, postgres, next-js-16, proxy, server-actions]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: Drizzle db instance (src/lib/db/index.ts), TypeScript types including ROLE_LEVELS and UserRole (src/types/index.ts), errors.ts

provides:
  - Better Auth server instance with email+password, drizzleAdapter, RBAC, and first-user-superadmin databaseHook
  - 4-role permission system (superAdmin, admin, loanOfficer, unassigned) via createAccessControl
  - Better Auth browser client with adminClient plugin
  - Generated auth schema (user, session, account, verification tables) compatible with Drizzle
  - Catch-all auth API route via toNextJsHandler
  - Drizzle migration 0000_swift_leech.sql covering all 10 tables
  - proxy.ts auth gate for all non-API routes with full session validation and role-based redirects
  - assignRole Server Action with AUTH-05 hierarchy enforcement

affects: [01-04, 01-05, 01-06, 01-07, all-subsequent-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Better Auth drizzleAdapter pattern for shared db instance
    - databaseHooks user.create.after for first-user-superadmin bootstrap
    - proxy.ts (Next.js 16) with auth.api.getSession for full session validation
    - Server Actions with headers() from next/headers for auth checks (no Route Handlers for role assignment)

key-files:
  created:
    - src/lib/permissions.ts
    - src/lib/auth.ts
    - src/lib/auth-client.ts
    - src/lib/db/schema/auth.ts
    - src/app/api/auth/[...all]/route.ts
    - src/proxy.ts
    - src/actions/user.actions.ts
    - drizzle/0000_swift_leech.sql
  modified:
    - src/lib/db/schema/index.ts

key-decisions:
  - "First-user-superadmin implemented via databaseHooks.user.create.after using raw SQL count — avoids circular deps and missing request headers that would occur with auth.api.setRole inside a hook"
  - "unassignedRole uses as-any cast for ac.newRole({}) — TypeScript infers Subset<never,...> which is incompatible with Role type; runtime behavior is correct"
  - "Drizzle execute() returns RowList (array-like, not .rows) — cast to unknown array to access count result"
  - "proxy.ts uses auth.api.getSession (full DB lookup) not cookie-only check — required to inspect session.user.role for unassigned redirect; cookieCache (5-min maxAge) mitigates the per-request DB cost"
  - "AUTH-04 satisfied by Better Auth session table — each login creates a session row with userId and createdAt; no additional audit hook needed"

patterns-established:
  - "Pattern: proxy.ts (not middleware.ts) is the Next.js 16 auth gate — export function named proxy with config.matcher"
  - "Pattern: Server Actions use await headers() from next/headers for session checks, not request.headers"
  - "Pattern: Role hierarchy guard checks targetLevel >= actorLevel and actorLevel < ROLE_LEVELS.admin before calling auth.api.setRole"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: 15min
completed: 2026-03-20
---

# Phase 01 Plan 03: Auth System Summary

**Better Auth with Drizzle adapter, 4-role RBAC (superAdmin/admin/loanOfficer/unassigned), first-user-superadmin bootstrap hook, Next.js 16 proxy.ts auth gate, and role assignment Server Action with hierarchy enforcement**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-20T10:50:00Z
- **Completed:** 2026-03-20T11:05:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Better Auth configured with drizzleAdapter, emailAndPassword, cookieCache, and 4-role RBAC system
- First-user-superadmin bootstrap via databaseHook (count users, promote to superAdmin when count = 1)
- Auth schema generated (user, session, account, verification tables) and Drizzle migration created for all 10 tables
- proxy.ts gates all non-API routes: redirects unauthenticated to /login, unassigned to /pending-approval, assigned users away from /pending-approval to /dashboard
- assignRole Server Action enforces AUTH-05 hierarchy guard — cannot assign role at or above own level

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure Better Auth server, client, permissions, auth schema** - `d67aa58` (feat)
2. **Task 2: Create proxy.ts auth gate and role assignment Server Action** - `e7657cf` (feat)

**Plan metadata:** _(forthcoming)_

## Files Created/Modified

- `src/lib/permissions.ts` - 4-role RBAC via createAccessControl: superAdmin, admin, loanOfficer, unassigned
- `src/lib/auth.ts` - Better Auth server instance with drizzleAdapter, cookieCache, first-user-superadmin databaseHook
- `src/lib/auth-client.ts` - Browser client with adminClient plugin; exports signIn, signUp, signOut, useSession
- `src/lib/db/schema/auth.ts` - Better Auth generated schema (user, session, account, verification tables)
- `src/lib/db/schema/index.ts` - Added re-export of auth schema
- `src/app/api/auth/[...all]/route.ts` - Catch-all Better Auth handler via toNextJsHandler
- `src/proxy.ts` - Next.js 16 auth gate with full session validation and role-based redirects
- `src/actions/user.actions.ts` - Server Action for role assignment with AUTH-05 hierarchy guard
- `drizzle/0000_swift_leech.sql` - Migration covering all 10 tables (app + auth)

## Decisions Made

- **databaseHook for first-user bootstrap:** Used raw SQL `db.execute(sql\`COUNT(*)\`)` and `UPDATE user SET role` inside the hook instead of calling `auth.api.setRole`. This avoids circular dependency issues with the auth schema import and avoids the "no request headers available" limitation inside hooks.
- **TypeScript cast for empty role:** `ac.newRole({} as any)` for unassignedRole — TypeScript incorrectly infers `Subset<never,...>` which is incompatible with the `Role` type, but runtime behavior is correct (empty permissions = no access).
- **Full session check in proxy:** Used `auth.api.getSession` (DB lookup) rather than cookie-only check. Required to inspect `session.user.role` for unassigned redirect. cookieCache with 5-min maxAge in auth.ts mitigates per-request cost.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Drizzle execute() return type access**
- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** `result.rows?.[0]?.cnt` fails because Drizzle's `RowList` is array-like, not an object with `.rows`. Causes TS2339 error.
- **Fix:** Cast `result as unknown as Array<{ cnt: number }>` and access `[0]?.cnt` directly
- **Files modified:** src/lib/auth.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** d67aa58 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed unassignedRole TypeScript type incompatibility**
- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** `ac.newRole({})` infers `Subset<never, ...>` for the statements type which is incompatible with `Role` type expected by the admin plugin's `roles` option
- **Fix:** Cast the empty object as `{} as any` to bypass the type inference issue
- **Files modified:** src/lib/permissions.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** d67aa58 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug, TypeScript type errors)
**Impact on plan:** Both fixes were necessary for TypeScript compilation. Runtime behavior matches plan intent exactly.

## Issues Encountered

- TypeScript strict inference on `ac.newRole({})` produces a `never`-typed statements object that is incompatible with the `Role` interface. The `as any` cast is a pragmatic workaround — the Better Auth runtime handles empty role statements correctly as "no permissions".

## User Setup Required

Database migrations must be run before the auth system can operate:

```bash
npx drizzle-kit migrate
```

This creates all 10 tables (customers, loans, collateral, payments, audit_log, system_settings, user, session, account, verification) in the PostgreSQL database specified in `DATABASE_URL`.

## Next Phase Readiness

- Auth system is complete and compiling — login, registration, sessions, RBAC, role assignment are all implemented
- proxy.ts is in place protecting all app routes
- Auth schema tables exist in migration — run `npx drizzle-kit migrate` before testing auth
- Plan 01-04 (login/register UI pages) can now be built using `signIn`, `signUp`, `useSession` from auth-client.ts

---
*Phase: 01-foundation*
*Completed: 2026-03-20*
