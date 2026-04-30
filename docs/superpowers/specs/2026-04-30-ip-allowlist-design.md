# Admin IP Allowlist — Design

Date: 2026-04-30
Status: approved

## Summary

Lower-role users (supervisor, loanOfficer) can only reach the application from IP addresses recently used by an admin or superAdmin. Each admin maintains a per-user "queue" of up to 100 trusted IPs (login-deduped, FIFO trim). The combined union of admin queues forms the org allowlist. The feature is gated behind a global on/off toggle that any admin+ can flip from the admin page; toggle defaults to OFF.

Enforcement happens at three layers (proxy, Electric proxy, server actions) mirroring the existing creditor-privacy pattern in `AGENTS.md`. Admins (admin, superAdmin) are exempt from the check — they are the source of trusted IPs and must always be able to reach the toggle.

## Goals

- Restrict supervisor/loanOfficer access to IPs already trusted by an admin login.
- Provide a single global on/off toggle, manageable by admin+.
- Surface what's in the allowlist and what got blocked, gated behind a button to keep the admin page uncluttered.
- Fail safely: never break login on capture failure; fail-closed on enforcement; fail-open on toggle read.
- Match the existing 3-layer security pattern — page proxy, Electric proxy, server actions.

## Non-goals

- Per-admin or per-route toggles. One global switch is enough.
- IP CIDR ranges, geo-fencing, or device fingerprinting.
- IPv6 normalization, IP-to-ASN lookups, or rate-limiting integration.
- Migrating existing sessions or backfilling historical IPs.

## Data Model

### `admin_ip_allowlist` (new table)

```ts
pgTable("admin_ip_allowlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  ip: text("ip").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("admin_ip_allowlist_user_ip_idx").on(t.userId, t.ip),
  index("admin_ip_allowlist_ip_idx").on(t.ip),
  index("admin_ip_allowlist_user_idx").on(t.userId),
])
```

- The `(userId, ip)` unique index is the dedup guarantee.
- The `ip` index makes "is this IP in any admin's queue?" an O(log n) lookup.
- `onDelete: "cascade"` from `user` covers admin-deletion cleanup.

### `ip_block_log` (new table)

```ts
pgTable("ip_block_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  ip: text("ip").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  path: text("path"),
}, (t) => [index("ip_block_log_attempted_at_idx").on(t.attemptedAt)])
```

- Powers the "Recent blocks" tab in the inspector. No retention policy in v1; an existing cleanup cron can prune later.

### `system_settings` (existing table)

New row:

| key                     | value           | meaning                       |
|-------------------------|-----------------|-------------------------------|
| `ip_allowlist_enabled`  | `"true"`/`"false"` | feature toggle (default off) |

Missing row is treated as `"false"`.

## Permissions

Add `"ip-allowlist:manage"` to the `Permission` union (`src/types/common.ts`) and to `PERMISSIONS` (`src/lib/permissions.ts`). Grant to `adminExtras` so admin and superAdmin both have it. Exclude from `MANAGING_SUPERVISOR_ELEVATED` — IP allowlist sits in admin-only territory like creditors.

## Architecture

### Shared module: `src/lib/ip-allowlist.ts`

Exposes:

```ts
isIpAllowlistEnabled(): Promise<boolean>           // ~30s in-memory cached
isIpAllowed(ip: string): Promise<boolean>          // ~30s in-memory cached
recordBlock(userId: string, ip: string, path: string): Promise<void>  // fire-and-forget
getClientIp(headers: Headers): string | null      // x-forwarded-for first entry, fallback x-real-ip
recordAdminLoginIp(userId: string, ip: string): Promise<void>          // upsert + trim
clearCaches(): void                                // toggle flip / write paths invalidate
```

Cache TTLs and capacity (1000 entries) mirror `src/app/api/electric/[...table]/route.ts` precedent.

### IP capture on login

`src/lib/auth.ts` — extend `databaseHooks.session.create.after`:

1. Fetch the row's user role (one DB query, only on session create).
2. If role is `admin` or `superAdmin`, call `recordAdminLoginIp(userId, session.ipAddress)`.
3. Inside `recordAdminLoginIp`:
   - `INSERT ... ON CONFLICT (user_id, ip) DO UPDATE SET last_seen_at = now()`.
   - If `INSERT` produced a new row, count the user's rows and `DELETE ... ORDER BY last_seen_at ASC LIMIT (count - 100)` if over cap.
   - Wrap in try/catch — log but never throw. Login must succeed even if capture fails.

### Layer 1 — Page proxy (`src/proxy.ts`)

After existing role resolution, before "allow through":

```ts
if (role !== "admin" && role !== "superAdmin") {
  if (await isIpAllowlistEnabled()) {
    const ip = getClientIp(request.headers)
    if (!ip || !(await isIpAllowed(ip))) {
      void recordBlock(session.user.id, ip ?? "unknown", pathname)
      if (pathname === "/access-blocked") return NextResponse.next()
      return NextResponse.redirect(new URL("/access-blocked", request.url))
    }
  }
}
```

`AUTH_PAGES` updated to include `/access-blocked` so blocked users can sign out without redirect loops.

### Layer 2 — Electric proxy (`src/app/api/electric/[...table]/route.ts`)

After the existing `ADMIN_ONLY_TABLES` check, add a parallel block: if the resolved role is below admin and the toggle is on, check the IP. The role-cache lookup that already exists for admin tables is extended to also resolve role for non-admin tables when the toggle is on (still 30s cached).

On miss: `403` with `{ error: "ip_not_allowed" }`.

### Layer 3 — Server actions (`src/lib/with-action.ts`)

After the existing permission check, before invoking `opts.action`/`opts.effect`:

```ts
if (session.user.role !== "admin" && session.user.role !== "superAdmin") {
  if (await isIpAllowlistEnabled()) {
    const ip = getClientIp(await headers())
    if (!ip || !(await isIpAllowed(ip))) {
      void recordBlock(session.user.id, ip ?? "unknown", "(server action)")
      return { error: "Access blocked: this device or network isn't recognized." }
    }
  }
}
```

The structured `{ error }` keeps the existing wire contract — clients already toast on `error`.

### IP source

Read `x-forwarded-for` (first comma-separated entry) with a fallback to `x-real-ip`. On Vercel both are set and trustworthy. Stored as-is — no IPv6 normalization in v1. Better-auth's session row already populates `ip_address` from the same headers, so the login-capture hook can read directly off the session object.

## UI

### Toggle on `/admin`

A single Switch row near the top of the admin page, rendered only when `has("ip-allowlist:manage")`:

```
[ Switch ]  Restrict access by IP   [View IP allowlist]
            When on, supervisors and loan officers can only sign in
            from IPs already used by an admin (last 100 per admin).
```

State fetched once via TanStack Query; mutation flips it; toast on success/failure.

### "View IP allowlist" Sheet

Slide-in Sheet (right side, matches existing CRUD pattern). Opens on button click. Three tabs:

1. **Trusted IPs** — table grouped by admin: Name, IP, Last seen. Each row has a "Remove" button → `removeAllowlistEntryAction`.
2. **Recent blocks** — last 50 entries from `ip_block_log` joined to `user`: Who, IP, When, Path.
3. **Clear all** — destructive button behind a confirm dialog. Wipes the entire allowlist (rotate-trust emergency button).

Loaded via a single `getIpAllowlistStateAction` call when the Sheet opens.

### `/access-blocked` page

Route: `src/app/(auth)/access-blocked/page.tsx` (auth group, no app shell). Server component. Shows:

- Heading: "Access blocked"
- Body: "This device or network isn't recognized. Sign in from a known location, or ask an administrator to log in here so this network becomes trusted."
- Sign-out button (calls `auth.signOut`)
- Subtle line with the user's current IP for support diagnostics

Proxy redirects blocked lower-role users here. Admins should never reach this page; if they do, render the same content (defensive).

## Server Actions

`src/actions/ip-allowlist.actions.ts` — all gated by `permission: "ip-allowlist:manage"`:

```ts
getIpAllowlistStateAction()
// → { enabled: boolean, queues: [{ userId, name, email, ips: [{ id, ip, lastSeenAt }] }], recentBlocks: [...] }

setIpAllowlistEnabledAction({ enabled: boolean })
// upserts system_settings.ip_allowlist_enabled, audit-logs the change, clears caches
// → { ok: true }

removeAllowlistEntryAction({ entryId: string })
// deletes one admin_ip_allowlist row, clears caches
// → { ok: true }

clearAllowlistAction()
// truncates admin_ip_allowlist, audit-logs the action, clears caches
// → { ok: true }
```

The toggle and clear-all actions append to `audit_log` (entityType `"ip_allowlist"`, with before/after value).

## Edge Cases

- **Admin demoted to supervisor**: extend `assignRole` (`src/actions/user.actions.ts`) — when target's new role drops below admin, also delete their `admin_ip_allowlist` rows. Existing session revocation handles kicking them.
- **Admin deleted**: cascade via FK.
- **Cache invalidation**: write paths call `clearCaches()` in-process. Multi-instance deployments see ≤30s drift — acceptable, matches the cookie/role cache trade-off in the Electric proxy.
- **Same office IP shared by multiple admins**: each admin gets a row; the `(userId, ip)` unique index allows duplicates across users, just not within one user.
- **Cypress E2E**: when `process.env.CYPRESS === "true"`, bypass the IP check (same pattern as the existing `isTestEnv` gate in `proxy.ts`). Tests opt into the check by directly seeding allowlist rows and overriding the bypass via a test-only header — see test file design.
- **First-time enable with empty allowlist**: lower-role users blocked until any admin logs in. Admins can always reach `/admin` to disable. Documented in the toggle's helper text.

## Failure Modes (deliberately asymmetric)

| Path                       | Failure                  | Behavior        | Reason                                      |
|----------------------------|--------------------------|-----------------|---------------------------------------------|
| IP capture (login hook)    | DB write error           | log + continue  | Login must never break.                     |
| `isIpAllowed` lookup       | DB error, cache miss     | fail-closed     | Refuse access on uncertainty.               |
| `isIpAllowlistEnabled`     | DB error                 | fail-open       | Avoid org-wide lockout from a transient blip. |
| Block log write            | DB error                 | log + continue  | Audit is best-effort.                       |

## Testing

Project policy (CLAUDE.md): no manual verification — Cypress E2E replaces all visual checkpoints.

### Vitest unit tests

- `src/lib/__tests__/ip-allowlist.test.ts`
  - `getClientIp` parses `x-forwarded-for` (single, multi-comma), falls back to `x-real-ip`, returns null when missing.
  - `isIpAllowed` cache hit/miss, invalidation on `clearCaches`.
  - `isIpAllowlistEnabled` reads `system_settings`, defaults to `false` on missing row.
  - `recordAdminLoginIp` upserts, bumps `last_seen_at` on dup, trims to 100, no-op for non-admin role.
- `src/actions/__tests__/ip-allowlist.actions.test.ts`
  - All actions return `Forbidden` for non-admin sessions.
  - `setIpAllowlistEnabledAction` writes audit log entry.
  - `removeAllowlistEntryAction` deletes row, clears caches.
  - `clearAllowlistAction` empties the table.
- `src/lib/__tests__/auth-hooks.test.ts`
  - Session-create hook records IP for admin / superAdmin, skips other roles.
  - Idempotent on duplicate IP.
  - Trims to 100 oldest by `last_seen_at`.

### Cypress E2E tests

- `cypress/e2e/ip-allowlist-toggle.cy.ts`
  - Admin sees toggle on `/admin`; supervisor and loan officer do not.
  - Flipping the switch persists across reload.
  - Toast appears on toggle.
  - "View IP allowlist" Sheet opens with seeded queues and recent blocks.
- `cypress/e2e/ip-allowlist-block.cy.ts`
  - With toggle ON and the test IP not in any allowlist, supervisor login redirects to `/access-blocked`.
  - Admin login from same IP still succeeds (admins exempt).
  - Toggling OFF lets supervisor in on the next request.
  - Server-action call from a blocked supervisor returns `{ error: "Access blocked: ..." }` and the client toasts it.
  - Electric request for a non-admin table returns 403 when blocked.
- `cypress/e2e/ip-allowlist-inspector.cy.ts`
  - Admin removes an entry from another admin's queue; supervisor from that IP is blocked on next request.
  - "Clear all" wipes the allowlist after confirm; supervisors are blocked org-wide until any admin logs back in.

## Files to Add / Modify

**Add:**

- `drizzle/000X_admin_ip_allowlist.sql` (drizzle generates from schema)
- `src/lib/db/schema/ip-allowlist.ts`
- `src/lib/ip-allowlist.ts`
- `src/actions/ip-allowlist.actions.ts`
- `src/app/(auth)/access-blocked/page.tsx`
- `src/components/admin/ip-allowlist-toggle.tsx`
- `src/components/admin/ip-allowlist-sheet.tsx`
- `cypress/e2e/ip-allowlist-toggle.cy.ts`
- `cypress/e2e/ip-allowlist-block.cy.ts`
- `cypress/e2e/ip-allowlist-inspector.cy.ts`
- Vitest tests under `src/lib/__tests__/` and `src/actions/__tests__/`

**Modify:**

- `src/lib/db/schema/index.ts` — re-export new schema
- `src/types/common.ts` — add `"ip-allowlist:manage"` to `Permission`
- `src/lib/permissions.ts` — add to `PERMISSIONS` and `adminExtras`
- `src/lib/auth.ts` — add `databaseHooks.session.create.after`
- `src/proxy.ts` — IP check, `/access-blocked` allowance
- `src/app/api/electric/[...table]/route.ts` — IP check after admin-table check
- `src/lib/with-action.ts` — IP check after permission check
- `src/actions/user.actions.ts` — clear allowlist on demotion
- `src/app/(app)/admin/page.tsx` — render toggle component

## Open Questions

None at design freeze. Implementation plan should resolve detailed item ordering and migration sequencing.
