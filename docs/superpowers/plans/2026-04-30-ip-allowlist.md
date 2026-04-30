# Admin IP Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict supervisor/loanOfficer access to IPs trusted by admin logins, controlled by a global on/off toggle managed from the admin page.

**Architecture:** Each admin login records the request IP in a per-user "queue" of up to 100 entries (LRU trim by `last_seen_at`, deduped on `(user_id, ip)`). The union of admin queues forms the org allowlist. A `system_settings.ip_allowlist_enabled` toggle gates the whole feature. Enforcement happens at three layers — page proxy (`src/proxy.ts`), Electric proxy (`src/app/api/electric/[...table]/route.ts`), and server actions (`src/lib/with-action.ts`) — mirroring the existing creditor-privacy pattern. Admin and superAdmin are exempt; blocked lower-role users land on `/access-blocked`.

**Tech Stack:** Next.js 16 (`proxy.ts` middleware), Drizzle ORM + Postgres (Neon), better-auth, TanStack DB (collections), Vitest (unit), Cypress (E2E), shadcn/ui.

**Spec:** See `docs/superpowers/specs/2026-04-30-ip-allowlist-design.md`.

**Test commands:**
- Unit: `pnpm test <file pattern>` (Vitest)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Cypress: `pnpm dev` in one terminal (or `CYPRESS=true pnpm dev`) and `npx cypress run --spec cypress/e2e/<file>` in another

**Project policy reminder (CLAUDE.md):** No manual verification — Cypress E2E replaces all visual checkpoints. All Vitest + Cypress tests must pass before declaring this plan complete.

---

## Task 1: Add database schema and migrate

**Files:**
- Create: `src/lib/db/schema/ip-allowlist.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create schema file**

Create `src/lib/db/schema/ip-allowlist.ts`:

```ts
import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const adminIpAllowlist = pgTable(
  "admin_ip_allowlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("admin_ip_allowlist_user_ip_idx").on(t.userId, t.ip),
    index("admin_ip_allowlist_ip_idx").on(t.ip),
    index("admin_ip_allowlist_user_idx").on(t.userId),
  ],
)

export const ipBlockLog = pgTable(
  "ip_block_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
    path: text("path"),
  },
  (t) => [index("ip_block_log_attempted_at_idx").on(t.attemptedAt)],
)
```

- [ ] **Step 2: Re-export from schema barrel**

Add to `src/lib/db/schema/index.ts` after the existing exports:

```ts
export * from "./ip-allowlist"
```

- [ ] **Step 3: Generate migration**

Run: `pnpm db:generate`

Expected: drizzle-kit creates `drizzle/0010_<name>_admin_ip_allowlist.sql` (or whatever next sequence number is) creating both tables and their indexes.

- [ ] **Step 4: Push to dev DB**

Run: `pnpm db:push`

Expected: Pushes migration to Neon dev DB; prompt confirms the new tables.

- [ ] **Step 5: Push to production DB**

Per project memory: schema changes must be pushed to BOTH dev AND production Neon databases.

Run: `DATABASE_URL=$DATABASE_URL_PROD pnpm db:push` (or whatever env var setup the project uses to point at prod).

If this is unfamiliar to the executor, ask the user before proceeding to push to production. **Confirm with the user before this step in any non-trivial environment.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema/ip-allowlist.ts src/lib/db/schema/index.ts drizzle/
git commit -m "feat(db): add admin_ip_allowlist and ip_block_log tables"
```

---

## Task 2: Add `ip-allowlist:manage` permission

**Files:**
- Modify: `src/types/common.ts`
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Add permission to type union**

In `src/types/common.ts`, add `"ip-allowlist:manage"` to the `Permission` union under the admin block:

```ts
  // admin
  | "dashboard:read"
  | "reports:read" | "reports:financial"
  | "settings:read" | "settings:update"
  | "user:list" | "user:ban" | "user:impersonate" | "user:invite"
  | "session:list" | "session:revoke" | "session:delete"
  | "ip-allowlist:manage"
```

- [ ] **Step 2: Add to PERMISSIONS array and adminExtras**

In `src/lib/permissions.ts`:

Add `"ip-allowlist:manage"` to the `PERMISSIONS` const array under the admin block:

```ts
  // admin
  "dashboard:read",
  "reports:read", "reports:financial",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate", "user:invite",
  "session:list", "session:revoke", "session:delete",
  "ip-allowlist:manage",
```

Add to `adminExtras`:

```ts
const adminExtras: Permission[] = [
  "rate-change:approve-low",
  "role:assign-supervisor",
  "creditor:read", "creditor:create", "creditor:update",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate", "user:invite",
  "session:list", "session:revoke", "session:delete",
  "delegation:create", "delegation:revoke", "delegation:read",
  "ip-allowlist:manage",
]
```

The permission is automatically excluded from `MANAGING_SUPERVISOR_ELEVATED` because that filter only keeps non-creditor/role/delegation perms — `ip-allowlist:manage` is not in that allow-list either way. Update the filter to also exclude IP allowlist explicitly:

Find:
```ts
export const MANAGING_SUPERVISOR_ELEVATED = new Set<Permission>(
  [...adminSet].filter(
    (p) => !p.startsWith("creditor:") && !p.startsWith("role:") && !p.startsWith("delegation:")
  )
)
```

Replace with:
```ts
export const MANAGING_SUPERVISOR_ELEVATED = new Set<Permission>(
  [...adminSet].filter(
    (p) =>
      !p.startsWith("creditor:") &&
      !p.startsWith("role:") &&
      !p.startsWith("delegation:") &&
      !p.startsWith("ip-allowlist:")
  )
)
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: passes — the new permission name is consistent everywhere.

- [ ] **Step 4: Commit**

```bash
git add src/types/common.ts src/lib/permissions.ts
git commit -m "feat(perms): add ip-allowlist:manage permission for admin+"
```

---

## Task 3: Build `src/lib/ip-allowlist.ts` (TDD)

**Files:**
- Create: `src/lib/ip-allowlist.ts`
- Test: `src/lib/__tests__/ip-allowlist.test.ts`

This module owns: header→IP extraction, the 30s caches, the toggle state read, the IP allowlist lookup, the login-side upsert+trim, and the block log writer.

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/ip-allowlist.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  getClientIp,
  isIpAllowlistEnabled,
  isIpAllowed,
  recordAdminLoginIp,
  recordBlock,
  clearCaches,
  __setIpAllowlistDepsForTests,
} from "@/lib/ip-allowlist"

describe("getClientIp", () => {
  it("returns the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })
    expect(getClientIp(h)).toBe("203.0.113.7")
  })

  it("trims whitespace", () => {
    const h = new Headers({ "x-forwarded-for": "  203.0.113.7  ,10.0.0.1" })
    expect(getClientIp(h)).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.42" })
    expect(getClientIp(h)).toBe("203.0.113.42")
  })

  it("returns null when neither header is present", () => {
    expect(getClientIp(new Headers())).toBeNull()
  })

  it("returns null on empty x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "" })
    expect(getClientIp(h)).toBeNull()
  })
})

describe("isIpAllowlistEnabled", () => {
  beforeEach(() => clearCaches())

  it("returns false when system_settings has no row", async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockResolvedValue(null),
    })
    expect(await isIpAllowlistEnabled()).toBe(false)
  })

  it('returns true when value is "true"', async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockResolvedValue("true"),
    })
    expect(await isIpAllowlistEnabled()).toBe(true)
  })

  it("caches across calls within TTL", async () => {
    const readSetting = vi.fn().mockResolvedValue("true")
    __setIpAllowlistDepsForTests({ readSetting })
    await isIpAllowlistEnabled()
    await isIpAllowlistEnabled()
    expect(readSetting).toHaveBeenCalledTimes(1)
  })

  it("clearCaches forces a re-read", async () => {
    const readSetting = vi.fn().mockResolvedValue("true")
    __setIpAllowlistDepsForTests({ readSetting })
    await isIpAllowlistEnabled()
    clearCaches()
    await isIpAllowlistEnabled()
    expect(readSetting).toHaveBeenCalledTimes(2)
  })

  it("fails open (returns false) when read throws", async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockRejectedValue(new Error("db down")),
    })
    expect(await isIpAllowlistEnabled()).toBe(false)
  })
})

describe("isIpAllowed", () => {
  beforeEach(() => clearCaches())

  it("returns true when IP exists in any admin queue", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockResolvedValue(true),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(true)
  })

  it("returns false when IP is missing", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockResolvedValue(false),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(false)
  })

  it("caches per-IP within TTL", async () => {
    const ipExists = vi.fn().mockResolvedValue(true)
    __setIpAllowlistDepsForTests({ ipExists })
    await isIpAllowed("203.0.113.7")
    await isIpAllowed("203.0.113.7")
    expect(ipExists).toHaveBeenCalledTimes(1)
  })

  it("fails closed (returns false) when read throws", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockRejectedValue(new Error("db down")),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(false)
  })
})

describe("recordAdminLoginIp", () => {
  beforeEach(() => clearCaches())

  it("upserts and bumps last_seen_at on duplicate", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: false })
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(upsert).toHaveBeenCalledWith("user-1", "203.0.113.7")
  })

  it("trims to 100 oldest entries when over cap", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: true })
    const trim = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert, trimAllowlist: trim })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(trim).toHaveBeenCalledWith("user-1", 100)
  })

  it("does not trim when upsert was a dup (no new row)", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: false })
    const trim = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert, trimAllowlist: trim })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(trim).not.toHaveBeenCalled()
  })

  it("swallows DB errors (must never throw — login depends on it)", async () => {
    __setIpAllowlistDepsForTests({
      upsertAllowlist: vi.fn().mockRejectedValue(new Error("db down")),
    })
    await expect(recordAdminLoginIp("user-1", "203.0.113.7")).resolves.toBeUndefined()
  })

  it("invalidates the IP cache after a new insert", async () => {
    const ipExists = vi.fn().mockResolvedValue(false)
    const upsert = vi.fn().mockResolvedValue({ inserted: true })
    __setIpAllowlistDepsForTests({ ipExists, upsertAllowlist: upsert })

    await isIpAllowed("203.0.113.7") // primes cache: false
    expect(ipExists).toHaveBeenCalledTimes(1)

    ipExists.mockResolvedValueOnce(true)
    await recordAdminLoginIp("user-1", "203.0.113.7")
    const allowed = await isIpAllowed("203.0.113.7")
    expect(allowed).toBe(true)
    expect(ipExists).toHaveBeenCalledTimes(2)
  })
})

describe("recordBlock", () => {
  it("inserts and never throws", async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ insertBlock: insert })
    await recordBlock("user-1", "203.0.113.99", "/dashboard")
    expect(insert).toHaveBeenCalledWith("user-1", "203.0.113.99", "/dashboard")
  })

  it("swallows errors", async () => {
    __setIpAllowlistDepsForTests({
      insertBlock: vi.fn().mockRejectedValue(new Error("db down")),
    })
    await expect(recordBlock("u", "ip", "/x")).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/ip-allowlist.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement the module**

Create `src/lib/ip-allowlist.ts`:

```ts
import { db } from "@/lib/db"
import { adminIpAllowlist, ipBlockLog } from "@/lib/db/schema/ip-allowlist"
import { systemSettings } from "@/lib/db/schema/settings"
import { eq, sql } from "drizzle-orm"

const TOGGLE_KEY = "ip_allowlist_enabled"

const TOGGLE_TTL_MS = 30_000
const IP_TTL_MS = 30_000
const IP_CACHE_MAX = 1000

interface Deps {
  readSetting: (key: string) => Promise<string | null>
  ipExists: (ip: string) => Promise<boolean>
  upsertAllowlist: (userId: string, ip: string) => Promise<{ inserted: boolean }>
  trimAllowlist: (userId: string, cap: number) => Promise<void>
  insertBlock: (userId: string, ip: string, path: string) => Promise<void>
}

const defaultDeps: Deps = {
  async readSetting(key) {
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  },
  async ipExists(ip) {
    const rows = await db
      .select({ id: adminIpAllowlist.id })
      .from(adminIpAllowlist)
      .where(eq(adminIpAllowlist.ip, ip))
      .limit(1)
    return rows.length > 0
  },
  async upsertAllowlist(userId, ip) {
    const result = await db.execute(sql`
      INSERT INTO admin_ip_allowlist ("user_id", "ip", "last_seen_at")
      VALUES (${userId}, ${ip}, now())
      ON CONFLICT ("user_id", "ip") DO UPDATE SET "last_seen_at" = now()
      RETURNING (xmax = 0) AS inserted
    `)
    const row = (result as unknown as Array<{ inserted: boolean }>)[0]
    return { inserted: !!row?.inserted }
  },
  async trimAllowlist(userId, cap) {
    await db.execute(sql`
      DELETE FROM admin_ip_allowlist
      WHERE "id" IN (
        SELECT "id" FROM admin_ip_allowlist
        WHERE "user_id" = ${userId}
        ORDER BY "last_seen_at" ASC
        OFFSET ${cap}
      )
    `)
  },
  async insertBlock(userId, ip, path) {
    await db.insert(ipBlockLog).values({ userId, ip, path })
  },
}

let deps: Deps = defaultDeps

/** Test-only seam — replace selected dep methods. */
export function __setIpAllowlistDepsForTests(overrides: Partial<Deps>): void {
  deps = { ...defaultDeps, ...overrides }
}

// ─── Caches ───────────────────────────────────────────────────────────────

let toggleCache: { value: boolean; expiresAt: number } | null = null
const ipCache = new Map<string, { value: boolean; expiresAt: number }>()

export function clearCaches(): void {
  toggleCache = null
  ipCache.clear()
}

function ipCacheSet(ip: string, value: boolean): void {
  if (ipCache.size >= IP_CACHE_MAX) {
    const oldest = ipCache.keys().next().value
    if (oldest !== undefined) ipCache.delete(oldest)
  }
  ipCache.set(ip, { value, expiresAt: Date.now() + IP_TTL_MS })
}

// ─── Public API ───────────────────────────────────────────────────────────

export function getClientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = headers.get("x-real-ip")
  return real?.trim() || null
}

export async function isIpAllowlistEnabled(): Promise<boolean> {
  if (toggleCache && toggleCache.expiresAt > Date.now()) return toggleCache.value
  try {
    const raw = await deps.readSetting(TOGGLE_KEY)
    const value = raw === "true"
    toggleCache = { value, expiresAt: Date.now() + TOGGLE_TTL_MS }
    return value
  } catch (err) {
    console.warn("[ip-allowlist] toggle read failed; failing open", err)
    return false
  }
}

export async function isIpAllowed(ip: string): Promise<boolean> {
  const hit = ipCache.get(ip)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  try {
    const value = await deps.ipExists(ip)
    ipCacheSet(ip, value)
    return value
  } catch (err) {
    console.warn("[ip-allowlist] ip lookup failed; failing closed", err)
    return false
  }
}

export async function recordAdminLoginIp(userId: string, ip: string): Promise<void> {
  try {
    const { inserted } = await deps.upsertAllowlist(userId, ip)
    if (inserted) {
      await deps.trimAllowlist(userId, 100)
      ipCache.delete(ip)
    }
  } catch (err) {
    console.warn("[ip-allowlist] record login ip failed", { userId, ip, err })
  }
}

export async function recordBlock(userId: string, ip: string, path: string): Promise<void> {
  try {
    await deps.insertBlock(userId, ip, path)
  } catch (err) {
    console.warn("[ip-allowlist] block log insert failed", err)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/ip-allowlist.test.ts`
Expected: PASS — all 19 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ip-allowlist.ts src/lib/__tests__/ip-allowlist.test.ts
git commit -m "feat(ip-allowlist): shared lib with caches, toggle, lookup, capture"
```

---

## Task 4: Wire login IP capture in better-auth

**Files:**
- Modify: `src/lib/auth.ts`

The `databaseHooks.session.create.after` fires on every session creation (login, register, refresh). Read the session row's user role and call `recordAdminLoginIp` for admins only.

- [ ] **Step 1: Add the hook**

In `src/lib/auth.ts`, find the existing `databaseHooks.user.create.after` block and add a sibling `session.create.after`:

```ts
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // FIRST-USER BOOTSTRAP: ... (existing)
          const { sql } = await import("drizzle-orm")
          await db.execute(sql`
            UPDATE "user" SET "role" = 'superAdmin'
            WHERE "id" = ${user.id}
              AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" != ${user.id})
          `)
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          // Record admin/superAdmin login IPs in the trusted allowlist.
          // Wrapped so a failure here never breaks login.
          try {
            if (!session.ipAddress) return
            const { sql } = await import("drizzle-orm")
            const rows = await db.execute(
              sql`SELECT "role" FROM "user" WHERE "id" = ${session.userId}`
            )
            const role = (rows as unknown as Array<{ role: string | null }>)[0]?.role
            if (role !== "admin" && role !== "superAdmin") return
            const { recordAdminLoginIp } = await import("@/lib/ip-allowlist")
            await recordAdminLoginIp(session.userId, session.ipAddress)
          } catch (err) {
            console.warn("[auth] session.create.after IP capture failed", err)
          }
        },
      },
    },
  },
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Run existing auth-related tests**

Run: `pnpm test src/lib/__tests__/`
Expected: passes (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): record admin login IPs into allowlist on session create"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/actions/ip-allowlist.actions.ts`
- Test: `src/actions/__tests__/ip-allowlist.actions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/actions/__tests__/ip-allowlist.actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  checkPermission: vi.fn(),
}))
vi.mock("@/lib/ip-allowlist", () => ({
  clearCaches: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getSession, checkPermission } from "@/lib/action-utils"
import { clearCaches } from "@/lib/ip-allowlist"
import {
  setIpAllowlistEnabledAction,
  removeAllowlistEntryAction,
  clearAllowlistAction,
} from "@/actions/ip-allowlist.actions"

const adminSession = { user: { id: "admin-1", role: "admin" } } as any

describe("ip-allowlist actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getSession as any).mockResolvedValue(adminSession)
    ;(checkPermission as any).mockResolvedValue(null)
  })

  it("setIpAllowlistEnabledAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as any).mockResolvedValue("Forbidden")
    const result = await setIpAllowlistEnabledAction({ enabled: true })
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("setIpAllowlistEnabledAction clears caches on success", async () => {
    const result = await setIpAllowlistEnabledAction({ enabled: true })
    expect("data" in result || "ok" in (result as any)).toBe(true)
    expect(clearCaches).toHaveBeenCalled()
  })

  it("removeAllowlistEntryAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as any).mockResolvedValue("Forbidden")
    const result = await removeAllowlistEntryAction({ entryId: "abc" })
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("clearAllowlistAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as any).mockResolvedValue("Forbidden")
    const result = await clearAllowlistAction()
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("removeAllowlistEntryAction clears caches on success", async () => {
    await removeAllowlistEntryAction({ entryId: crypto.randomUUID() })
    expect(clearCaches).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/actions/__tests__/ip-allowlist.actions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the actions**

Create `src/actions/ip-allowlist.actions.ts`:

```ts
"use server"

import { db } from "@/lib/db"
import { adminIpAllowlist, ipBlockLog } from "@/lib/db/schema/ip-allowlist"
import { systemSettings } from "@/lib/db/schema/settings"
import { user as userTable } from "@/lib/db/schema/auth"
import { auditLog } from "@/lib/db/schema/audit"
import { withAction } from "@/lib/with-action"
import { clearCaches } from "@/lib/ip-allowlist"
import { eq, desc, sql } from "drizzle-orm"

const TOGGLE_KEY = "ip_allowlist_enabled"

interface AllowlistEntry {
  id: string
  ip: string
  lastSeenAt: string
}

interface AdminQueue {
  userId: string
  name: string
  email: string
  role: string
  ips: AllowlistEntry[]
}

interface BlockEntry {
  id: string
  userId: string
  userName: string
  userEmail: string
  ip: string
  attemptedAt: string
  path: string | null
}

interface AllowlistState {
  enabled: boolean
  queues: AdminQueue[]
  recentBlocks: BlockEntry[]
}

export const getIpAllowlistStateAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (): Promise<{ data: AllowlistState }> => {
    const [toggleRows, allowlistRows, blockRows] = await Promise.all([
      db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, TOGGLE_KEY))
        .limit(1),
      db
        .select({
          id: adminIpAllowlist.id,
          ip: adminIpAllowlist.ip,
          lastSeenAt: adminIpAllowlist.lastSeenAt,
          userId: adminIpAllowlist.userId,
          name: userTable.name,
          email: userTable.email,
          role: userTable.role,
        })
        .from(adminIpAllowlist)
        .innerJoin(userTable, eq(adminIpAllowlist.userId, userTable.id))
        .orderBy(desc(adminIpAllowlist.lastSeenAt)),
      db
        .select({
          id: ipBlockLog.id,
          userId: ipBlockLog.userId,
          ip: ipBlockLog.ip,
          attemptedAt: ipBlockLog.attemptedAt,
          path: ipBlockLog.path,
          name: userTable.name,
          email: userTable.email,
        })
        .from(ipBlockLog)
        .innerJoin(userTable, eq(ipBlockLog.userId, userTable.id))
        .orderBy(desc(ipBlockLog.attemptedAt))
        .limit(50),
    ])

    const enabled = toggleRows[0]?.value === "true"

    const queueMap = new Map<string, AdminQueue>()
    for (const row of allowlistRows) {
      const existing = queueMap.get(row.userId)
      const entry: AllowlistEntry = {
        id: row.id,
        ip: row.ip,
        lastSeenAt: row.lastSeenAt.toISOString(),
      }
      if (existing) {
        existing.ips.push(entry)
      } else {
        queueMap.set(row.userId, {
          userId: row.userId,
          name: row.name,
          email: row.email,
          role: row.role ?? "unassigned",
          ips: [entry],
        })
      }
    }

    return {
      data: {
        enabled,
        queues: [...queueMap.values()],
        recentBlocks: blockRows.map((b) => ({
          id: b.id,
          userId: b.userId,
          userName: b.name,
          userEmail: b.email,
          ip: b.ip,
          attemptedAt: b.attemptedAt.toISOString(),
          path: b.path,
        })),
      },
    }
  },
})

interface ToggleInput {
  enabled: boolean
}

export const setIpAllowlistEnabledAction = withAction<ToggleInput, { ok: true }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    const beforeRows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, TOGGLE_KEY))
      .limit(1)
    const before = beforeRows[0]?.value ?? "false"
    const after = input.enabled ? "true" : "false"

    await db
      .insert(systemSettings)
      .values({ key: TOGGLE_KEY, value: after, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: after, updatedBy: session.user.id, updatedAt: new Date() },
      })

    await db.insert(auditLog).values({
      actorId: session.user.id,
      action: "update",
      entityType: "ip_allowlist",
      entityId: TOGGLE_KEY,
      beforeValue: before,
      afterValue: after,
    })

    clearCaches()
    return { data: { ok: true as const } }
  },
})

interface RemoveInput {
  entryId: string
}

export const removeAllowlistEntryAction = withAction<RemoveInput, { ok: true }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    const deleted = await db
      .delete(adminIpAllowlist)
      .where(eq(adminIpAllowlist.id, input.entryId))
      .returning({ ip: adminIpAllowlist.ip, userId: adminIpAllowlist.userId })

    if (deleted[0]) {
      await db.insert(auditLog).values({
        actorId: session.user.id,
        action: "delete",
        entityType: "ip_allowlist_entry",
        entityId: input.entryId,
        beforeValue: `${deleted[0].userId}:${deleted[0].ip}`,
        afterValue: null,
      })
    }

    clearCaches()
    return { data: { ok: true as const } }
  },
})

export const clearAllowlistAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (session): Promise<{ data: { ok: true } }> => {
    await db.delete(adminIpAllowlist)
    await db.insert(auditLog).values({
      actorId: session.user.id,
      action: "clear",
      entityType: "ip_allowlist",
      entityId: "*",
      beforeValue: null,
      afterValue: null,
    })
    clearCaches()
    return { data: { ok: true as const } }
  },
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/actions/__tests__/ip-allowlist.actions.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/actions/ip-allowlist.actions.ts src/actions/__tests__/ip-allowlist.actions.test.ts
git commit -m "feat(actions): ip-allowlist toggle, list, remove, clear actions"
```

---

## Task 6: Layer 1 — Page proxy enforcement

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Add IP check to proxy**

In `src/proxy.ts`, add the import at the top of the file (near the existing `getSessionCookie` import):

```ts
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
```

Update `AUTH_PAGES` to include `/access-blocked`:

```ts
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/verify-email", "/reset-password", "/accept-invite", "/access-blocked"]
```

After the existing block that handles `role === "unassigned"` and before the `if (isAuthPage || pathname === "/pending-approval")` block, insert:

```ts
  // IP allowlist gate for lower-role users
  if (role !== "admin" && role !== "superAdmin") {
    if (await isIpAllowlistEnabled()) {
      const clientIp = getClientIp(request.headers)
      const allowed = clientIp ? await isIpAllowed(clientIp) : false
      if (!allowed) {
        // Best-effort log; never await
        void recordBlock(session.user.id, clientIp ?? "unknown", pathname)
        if (pathname === "/access-blocked") return NextResponse.next()
        return NextResponse.redirect(new URL("/access-blocked", request.url))
      }
    }
  }
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(proxy): IP allowlist gate for lower-role page navigation"
```

---

## Task 7: Layer 2 — Electric proxy enforcement

**Files:**
- Modify: `src/app/api/electric/[...table]/route.ts`

The existing route already resolves role for `ADMIN_ONLY_TABLES`. Extend the resolution so non-admin tables also resolve role when the toggle is on, then run the IP check.

- [ ] **Step 1: Add the IP check**

In `src/app/api/electric/[...table]/route.ts`, add imports near the top:

```ts
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
```

Refactor the role-check section to also handle the IP gate. Locate the block:

```ts
  if (ADMIN_ONLY_TABLES.has(table)) {
    let role = rawCookieHeader ? getCachedRole(rawCookieHeader) : null
    if (!role) {
      const session = await auth.api.getSession({ headers: requestHeaders })
      // ...
    }
    if ((ROLE_LEVELS[role] ?? 0) < ADMIN_LEVEL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { ... })
    }
  }
```

Replace with:

```ts
  // Resolve role if needed (for ADMIN_ONLY_TABLES or for IP-gate when toggle is on)
  const allowlistOn = await isIpAllowlistEnabled()
  const needsRole = ADMIN_ONLY_TABLES.has(table) || allowlistOn

  let resolvedRole: UserRole | null = null
  let resolvedUserId: string | null = null

  if (needsRole) {
    resolvedRole = rawCookieHeader ? getCachedRole(rawCookieHeader) : null
    if (!resolvedRole) {
      const session = await auth.api.getSession({ headers: requestHeaders })
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      resolvedRole = ((session.user as Record<string, unknown>).role ?? "unassigned") as UserRole
      resolvedUserId = session.user.id
      if (rawCookieHeader) setCachedRole(rawCookieHeader, resolvedRole)
    }

    // Admin-only table check
    if (ADMIN_ONLY_TABLES.has(table) && (ROLE_LEVELS[resolvedRole] ?? 0) < ADMIN_LEVEL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }

    // IP allowlist check (lower roles only)
    if (allowlistOn && resolvedRole !== "admin" && resolvedRole !== "superAdmin") {
      const clientIp = getClientIp(requestHeaders)
      const allowed = clientIp ? await isIpAllowed(clientIp) : false
      if (!allowed) {
        if (resolvedUserId) {
          void recordBlock(resolvedUserId, clientIp ?? "unknown", `(electric:${table})`)
        }
        return new Response(JSON.stringify({ error: "ip_not_allowed" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
    }
  }
```

Note: `resolvedUserId` is only populated when the role had to be re-resolved from session (cache miss path). On a cache hit we don't have the userId — `recordBlock` with no userId is awkward. Do it like this: if `resolvedUserId` is null, skip the block log. The proxy.ts and withAction layers will catch the same user with proper logging on the next page nav / mutation. (Better than introducing a second cache for userId.)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/electric/[...table]/route.ts
git commit -m "feat(electric): IP allowlist gate for lower-role shape requests"
```

---

## Task 8: Layer 3 — Server action enforcement

**Files:**
- Modify: `src/lib/with-action.ts`

- [ ] **Step 1: Add IP check inside withAction**

In `src/lib/with-action.ts`, at the top add:

```ts
import { headers } from "next/headers"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
```

Inside the implementation function, after the existing permission check (after `if (forbidden) return { error: forbidden }`) and before the Effect-mode branch, add:

```ts
    // IP allowlist gate (lower roles only)
    const role = (session.user as Record<string, unknown>).role
    if (role !== "admin" && role !== "superAdmin") {
      if (await isIpAllowlistEnabled()) {
        const h = await headers()
        const clientIp = getClientIp(h)
        const allowed = clientIp ? await isIpAllowed(clientIp) : false
        if (!allowed) {
          void recordBlock(session.user.id, clientIp ?? "unknown", "(server action)")
          return { error: "Access blocked: this device or network isn't recognized." }
        }
      }
    }
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Run existing action tests to confirm no regression**

Run: `pnpm test src/actions/__tests__/`
Expected: passes (existing tests use mocked sessions; admin/superAdmin paths or the early-return-on-disabled-toggle keep them passing).

- [ ] **Step 4: Commit**

```bash
git add src/lib/with-action.ts
git commit -m "feat(actions): IP allowlist gate inside withAction wrapper"
```

---

## Task 9: `/access-blocked` page

**Files:**
- Create: `src/app/access-blocked/page.tsx`

Top-level route (no group) — same shape as `src/app/pending-approval/page.tsx`.

- [ ] **Step 1: Create the page**

Create `src/app/access-blocked/page.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { signOut } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function AccessBlockedPage() {
  const [ip, setIp] = useState<string | null>(null)

  useEffect(() => {
    // Best-effort: fetch the user's current IP for support diagnostics.
    // Uses a public lookup; failure is silent.
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((j) => setIp(j.ip ?? null))
      .catch(() => setIp(null))
  }, [])

  async function handleSignOut() {
    await signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Access Blocked</CardTitle>
            <CardDescription>
              This device or network isn&apos;t recognized
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground">
              Your administrator has restricted access to trusted networks.
              Sign in from a known location, or ask an administrator to log in
              here so this network becomes trusted.
            </p>
            {ip && (
              <p className="text-xs text-muted-foreground font-mono">
                Your current IP: {ip}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/access-blocked/page.tsx
git commit -m "feat(ui): /access-blocked page for blocked lower-role users"
```

---

## Task 10: Cypress test helpers

**Files:**
- Modify: `cypress.config.ts`
- Modify: `cypress/support/commands.ts`

- [ ] **Step 1: Add db tasks**

In `cypress.config.ts`, inside the `setupNodeEvents` `on("task", { ... })` object, add these tasks alongside the existing ones:

```ts
        async "db:setIpAllowlistEnabled"({ enabled }: { enabled: boolean }) {
          return withSql(async (sql) => {
            const value = enabled ? "true" : "false"
            await sql`
              INSERT INTO system_settings ("key", "value")
              VALUES ('ip_allowlist_enabled', ${value})
              ON CONFLICT ("key") DO UPDATE SET "value" = ${value}, "updated_at" = now()
            `
            return null
          })
        },

        async "db:seedAllowlistEntry"({ userId, ip }: { userId: string; ip: string }) {
          return withSql(async (sql) => {
            await sql`
              INSERT INTO admin_ip_allowlist ("user_id", "ip", "last_seen_at")
              VALUES (${userId}, ${ip}, now())
              ON CONFLICT ("user_id", "ip") DO UPDATE SET "last_seen_at" = now()
            `
            return null
          })
        },

        async "db:clearAllowlist"() {
          return withSql(async (sql) => {
            await sql`DELETE FROM admin_ip_allowlist`
            await sql`DELETE FROM ip_block_log`
            return null
          })
        },

        async "db:countAllowlistFor"({ userId }: { userId: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT count(*)::int AS n FROM admin_ip_allowlist WHERE "user_id" = ${userId}
            `
            return rows[0]?.n ?? 0
          })
        },
```

Also extend the existing `db:reset` task — add `DELETE FROM ip_block_log;` and `DELETE FROM admin_ip_allowlist;` near the other tables. Place them above `DELETE FROM session;` (no FK dependencies, but logical ordering with other auth-adjacent rows):

```ts
              DELETE FROM ip_block_log;
              DELETE FROM admin_ip_allowlist;
              DELETE FROM session;
```

- [ ] **Step 2: Add Cypress commands**

In `cypress/support/commands.ts`, add to the `Chainable` interface declaration:

```ts
      /** Insert/update the ip_allowlist_enabled toggle directly in DB */
      setIpAllowlistEnabled(enabled: boolean): Chainable<null>

      /** Seed an entry in the admin_ip_allowlist table */
      seedAllowlistEntry(userId: string, ip: string): Chainable<null>

      /** Wipe admin_ip_allowlist and ip_block_log */
      clearAllowlist(): Chainable<null>

      /** Count entries in admin_ip_allowlist for one admin */
      countAllowlistFor(userId: string): Chainable<number>
```

And add the implementations at the bottom of the file (before `export {}`):

```ts
Cypress.Commands.add("setIpAllowlistEnabled", (enabled: boolean) => {
  return cy.task("db:setIpAllowlistEnabled", { enabled })
})

Cypress.Commands.add("seedAllowlistEntry", (userId: string, ip: string) => {
  return cy.task("db:seedAllowlistEntry", { userId, ip })
})

Cypress.Commands.add("clearAllowlist", () => {
  return cy.task("db:clearAllowlist")
})

Cypress.Commands.add("countAllowlistFor", (userId: string) => {
  return cy.task("db:countAllowlistFor", { userId })
})
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add cypress.config.ts cypress/support/commands.ts
git commit -m "test(cypress): db tasks and commands for ip-allowlist seeding"
```

---

## Task 11: UI — toggle component

**Files:**
- Create: `src/components/admin/ip-allowlist-toggle.tsx`

- [ ] **Step 1: Create the toggle**

Create `src/components/admin/ip-allowlist-toggle.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  getIpAllowlistStateAction,
  setIpAllowlistEnabledAction,
} from "@/actions/ip-allowlist.actions"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { IpAllowlistSheet } from "./ip-allowlist-sheet"

const QUERY_KEY = ["ip-allowlist", "state"]

export function IpAllowlistToggle() {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await getIpAllowlistStateAction()
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await setIpAllowlistEnabledAction({ enabled })
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: (_, enabled) => {
      toast.success(enabled ? "IP restriction enabled" : "IP restriction disabled")
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const enabled = data?.enabled ?? false

  return (
    <section className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => toggleMutation.mutate(v)}
            disabled={isLoading || toggleMutation.isPending}
            data-testid="ip-allowlist-toggle"
          />
          <span className="font-medium">Restrict access by IP</span>
        </div>
        <p className="text-sm text-muted-foreground max-w-prose">
          When on, supervisors and loan officers can only sign in from IPs already
          used by an admin (last 100 per admin, deduped). Admins are exempt.
          With an empty allowlist, lower-role users are blocked until any admin logs in.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSheetOpen(true)}
        data-testid="ip-allowlist-view-button"
      >
        View IP allowlist
      </Button>
      <IpAllowlistSheet open={sheetOpen} onOpenChange={setSheetOpen} state={data} />
    </section>
  )
}
```

- [ ] **Step 2: Typecheck (this will FAIL — sheet not yet built)**

Run: `pnpm typecheck`
Expected: FAIL — `IpAllowlistSheet` import unresolved. Proceed to Task 12.

- [ ] **Step 3: Defer commit until Task 12 is done**

(Component depends on sheet — bundle the commit at end of Task 12.)

---

## Task 12: UI — allowlist Sheet (queues, blocks, clear-all)

**Files:**
- Create: `src/components/admin/ip-allowlist-sheet.tsx`

- [ ] **Step 1: Create the Sheet component**

Create `src/components/admin/ip-allowlist-sheet.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  removeAllowlistEntryAction,
  clearAllowlistAction,
} from "@/actions/ip-allowlist.actions"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/utils"

interface State {
  enabled: boolean
  queues: Array<{
    userId: string
    name: string
    email: string
    role: string
    ips: Array<{ id: string; ip: string; lastSeenAt: string }>
  }>
  recentBlocks: Array<{
    id: string
    userName: string
    userEmail: string
    ip: string
    attemptedAt: string
    path: string | null
  }>
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: State | undefined
}

export function IpAllowlistSheet({ open, onOpenChange, state }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState("trusted")

  const removeMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await removeAllowlistEntryAction({ entryId })
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      toast.success("IP removed")
      qc.invalidateQueries({ queryKey: ["ip-allowlist", "state"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await clearAllowlistAction()
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      toast.success("All IPs cleared")
      qc.invalidateQueries({ queryKey: ["ip-allowlist", "state"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto" data-testid="ip-allowlist-sheet">
        <SheetHeader>
          <SheetTitle>IP allowlist</SheetTitle>
          <SheetDescription>
            Trusted IPs (one queue per admin), recent blocks, and emergency reset.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList>
            <TabsTrigger value="trusted" data-testid="tab-trusted">Trusted IPs</TabsTrigger>
            <TabsTrigger value="blocks" data-testid="tab-blocks">Recent blocks</TabsTrigger>
            <TabsTrigger value="danger" data-testid="tab-danger">Reset</TabsTrigger>
          </TabsList>

          <TabsContent value="trusted" className="mt-4">
            {!state || state.queues.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No trusted IPs yet. Admins will populate the allowlist as they log in.
              </p>
            ) : (
              state.queues.map((q) => (
                <div key={q.userId} className="mb-6">
                  <h3 className="font-semibold text-sm">
                    {q.name}{" "}
                    <span className="text-muted-foreground font-normal">— {q.email}</span>
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP</TableHead>
                        <TableHead>Last seen</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {q.ips.map((entry) => (
                        <TableRow key={entry.id} data-testid="allowlist-row">
                          <TableCell className="font-mono">{entry.ip}</TableCell>
                          <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                            {formatDate(entry.lastSeenAt)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMutation.mutate(entry.id)}
                              disabled={removeMutation.isPending}
                              data-testid={`remove-${entry.id}`}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="blocks" className="mt-4">
            {!state || state.recentBlocks.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recent blocks.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.recentBlocks.map((b) => (
                    <TableRow key={b.id} data-testid="block-row">
                      <TableCell className="text-sm">
                        <div>{b.userName}</div>
                        <div className="text-muted-foreground text-xs">{b.userEmail}</div>
                      </TableCell>
                      <TableCell className="font-mono">{b.ip}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.path ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {formatDate(b.attemptedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="danger" className="mt-4">
            <div className="space-y-3">
              <p className="text-sm">
                Wipe the entire allowlist. Lower-role users will be blocked until
                an admin logs in again from a trusted location.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" data-testid="clear-all-button">
                    Clear all trusted IPs
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Wipe allowlist?</AlertDialogTitle>
                    <AlertDialogDescription>
                      All admins lose their trusted IPs. Lower-role users will be
                      locked out until an admin signs in.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="clear-all-confirm"
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                    >
                      Wipe
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit (covers Task 11 + 12)**

```bash
git add src/components/admin/ip-allowlist-toggle.tsx src/components/admin/ip-allowlist-sheet.tsx
git commit -m "feat(ui): IP allowlist toggle and queue inspector Sheet"
```

---

## Task 13: Mount toggle on `/admin` page

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Add import and render**

In `src/app/(app)/admin/page.tsx`, add the import near the other component imports:

```tsx
import { IpAllowlistToggle } from "@/components/admin/ip-allowlist-toggle"
```

Inside `AdminContent` component, render the toggle near the top, gated by the permission. Locate the `return (` block and insert the toggle right after `<PageHeader title="Admin" subtitle="System administration" />`:

```tsx
      <PageHeader title="Admin" subtitle="System administration" />

      {has("ip-allowlist:manage") && <IpAllowlistToggle />}

      {users.length === 0 ? (
        ...
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/admin/page.tsx
git commit -m "feat(admin): mount IP allowlist toggle on /admin page"
```

---

## Task 14: Demotion cleanup in `assignRole`

**Files:**
- Modify: `src/actions/user.actions.ts`

When an admin is demoted to a non-admin role, their `admin_ip_allowlist` rows should be deleted so they no longer act as trust anchors.

- [ ] **Step 1: Extend assignRole**

In `src/actions/user.actions.ts`, after the existing `auth.api.setRole({...})` call and after the `invalidateUserPermissions(userId)` call but before the session-revoke block, insert:

```ts
    // If the user was demoted from admin/superAdmin, clear their allowlist
    // entries so they no longer anchor IP trust.
    const ADMIN_ROLES = new Set(["admin", "superAdmin"])
    const targetIsNonAdminNow = !ADMIN_ROLES.has(targetRole)
    if (targetIsNonAdminNow) {
      try {
        const { db } = await import("@/lib/db")
        const { adminIpAllowlist } = await import("@/lib/db/schema/ip-allowlist")
        const { eq } = await import("drizzle-orm")
        await db.delete(adminIpAllowlist).where(eq(adminIpAllowlist.userId, userId))
        const { clearCaches } = await import("@/lib/ip-allowlist")
        clearCaches()
      } catch (err) {
        console.warn("[assignRole] Failed to clear IP allowlist on demotion", err)
      }
    }
```

- [ ] **Step 2: Run existing user-action tests**

Run: `pnpm test src/actions/__tests__/`
Expected: passes (no test specifically targets this path; existing assignRole tests still green).

- [ ] **Step 3: Commit**

```bash
git add src/actions/user.actions.ts
git commit -m "feat(user): clear IP allowlist when admin is demoted"
```

---

## Task 15: Cypress E2E tests

**Files:**
- Create: `cypress/e2e/ip-allowlist-toggle.cy.ts`
- Create: `cypress/e2e/ip-allowlist-block.cy.ts`
- Create: `cypress/e2e/ip-allowlist-inspector.cy.ts`

**Important — IP source in Cypress:** When `pnpm dev` runs locally and Cypress hits `localhost:3000`, the `x-forwarded-for` header is normally absent and `x-real-ip` may or may not be set depending on how Next is run. Behavior to verify:
- Running `pnpm dev` directly → no proxy headers → `getClientIp` returns `null` → block lower-role users when toggle is on.
- Use the cypress task `db:seedAllowlistEntry` to add a row with `ip = "unknown"` (or whatever fallback string the executor observes). If that's clumsy, prefer to seed `127.0.0.1` and verify it matches.

If the test cannot reliably determine the client IP, the block path still triggers (any unknown IP → block), which is what we're testing in `ip-allowlist-block.cy.ts`. The "allowed" path requires seeding the actual observed IP. **The first action of the executor for Task 15 should be a small spike: write a temporary endpoint or `cy.request("/api/test/echo-ip")` to confirm what IP the test environment sees, then seed accordingly.**

- [ ] **Step 1: Spike — confirm test IP**

Add a temporary test route `src/app/api/test/echo-ip/route.ts` (used only by Cypress, never deployed):

```ts
import { headers } from "next/headers"
import { getClientIp } from "@/lib/ip-allowlist"

export async function GET() {
  const ip = getClientIp(await headers())
  return Response.json({ ip })
}
```

Run a quick `curl http://localhost:3000/api/test/echo-ip` (or in a temporary `.cy.ts` test) to capture the value. Use that exact value in the seed calls below. Common results: `127.0.0.1`, `::1`, or `null` (if no proxy headers). If `null`, adjust seeds to use `"unknown"` (the literal fallback the proxy/withAction layers use when IP is unresolvable).

For brevity below, the tests assume `127.0.0.1`. **Replace with the observed value** if different.

- [ ] **Step 2: Toggle test**

Create `cypress/e2e/ip-allowlist-toggle.cy.ts`:

```ts
describe("IP allowlist — toggle and inspector visibility", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  it("admin sees toggle on /admin; supervisor does not", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-toggle"]').should("be.visible")
      cy.get('[data-testid="ip-allowlist-view-button"]').should("be.visible")
    })

    cy.clearAppPersistence()

    cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((u: any) => {
      cy.loginAsTestUser(u.cookies)
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-toggle"]').should("not.exist")
    })
  })

  it("toggle persists across reload", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-toggle"]').click()
      cy.contains("IP restriction enabled").should("be.visible")
      cy.reload()
      cy.get('[data-testid="ip-allowlist-toggle"]').should("have.attr", "data-state", "checked")
    })
  })

  it("View allowlist sheet opens and shows tabs", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-view-button"]').click()
      cy.get('[data-testid="ip-allowlist-sheet"]').should("be.visible")
      cy.get('[data-testid="tab-trusted"]').should("be.visible")
      cy.get('[data-testid="tab-blocks"]').should("be.visible")
      cy.get('[data-testid="tab-danger"]').should("be.visible")
    })
  })
})
```

- [ ] **Step 3: Block test**

Create `cypress/e2e/ip-allowlist-block.cy.ts`:

```ts
describe("IP allowlist — enforcement", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  it("supervisor is redirected to /access-blocked when toggle is on and IP is not trusted", () => {
    // Bootstrap admin + supervisor
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
    })

    cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
      // Toggle on but the supervisor's IP is not in the allowlist
      cy.setIpAllowlistEnabled(true)
      cy.loginAsTestUser(sup.cookies)
      cy.visit("/dashboard")
      cy.url().should("include", "/access-blocked")
      cy.contains("Access Blocked").should("be.visible")
    })
  })

  it("admin is exempt — can sign in even from an untrusted IP", () => {
    cy.task("auth:createUser", { name: "Admin", role: "admin" }).then((u: any) => {
      cy.setIpAllowlistEnabled(true)
      cy.clearAllowlist() // empty allowlist
      cy.loginAsTestUser(u.cookies)
      cy.visit("/dashboard")
      cy.url().should("include", "/dashboard")
    })
  })

  it("supervisor passes when their IP is in the allowlist", () => {
    cy.task("auth:createUser", { name: "Admin", role: "admin" }).then((admin: any) => {
      cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
        cy.setIpAllowlistEnabled(true)
        // Seed the test IP for the admin (executor: replace "127.0.0.1" with the value observed in step 1)
        cy.seedAllowlistEntry(admin.userId, "127.0.0.1")
        cy.loginAsTestUser(sup.cookies)
        cy.visit("/dashboard")
        cy.url().should("include", "/dashboard")
      })
    })
  })

  it("toggling off lets supervisor in immediately", () => {
    cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
      cy.setIpAllowlistEnabled(true)
      cy.clearAllowlist()
      cy.loginAsTestUser(sup.cookies)
      cy.visit("/dashboard")
      cy.url().should("include", "/access-blocked")

      // Disable and retry — caches are 30s; force a wait or use a fresh request
      cy.setIpAllowlistEnabled(false)
      // Cache TTL is 30s; wait beyond it
      cy.wait(31_000)
      cy.visit("/dashboard")
      cy.url().should("include", "/dashboard")
    })
  })
})
```

> Note: the 31-second wait in the last test is acceptable for E2E correctness; if the executor finds it flaky, replace `cy.wait` with a server-restart hook or expose a test-only `clearCaches` endpoint behind `CYPRESS=true`. Stick with the wait first — simpler.

- [ ] **Step 4: Inspector test**

Create `cypress/e2e/ip-allowlist-inspector.cy.ts`:

```ts
describe("IP allowlist — inspector actions", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  it("admin can remove an allowlist entry", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.task("db:getUserRole", { email: adminEmail }).then(() => {
        cy.task("auth:createUser", { name: "Other Admin", role: "admin" }).then((other: any) => {
          cy.seedAllowlistEntry(other.userId, "203.0.113.7")
          cy.login(adminEmail, "TestPass123!")
          cy.visit("/admin")
          cy.get('[data-testid="ip-allowlist-view-button"]').click()
          cy.get('[data-testid="allowlist-row"]').should("have.length.at.least", 1)
          cy.get('[data-testid="allowlist-row"]').first().within(() => {
            cy.contains("Remove").click()
          })
          cy.contains("IP removed").should("be.visible")
          cy.countAllowlistFor(other.userId).should("eq", 0)
        })
      })
    })
  })

  it("clear-all wipes the allowlist", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.task("auth:createUser", { name: "Other Admin", role: "admin" }).then((other: any) => {
        cy.seedAllowlistEntry(other.userId, "203.0.113.7")
        cy.seedAllowlistEntry(other.userId, "203.0.113.8")
        cy.login(adminEmail, "TestPass123!")
        cy.visit("/admin")
        cy.get('[data-testid="ip-allowlist-view-button"]').click()
        cy.get('[data-testid="tab-danger"]').click()
        cy.get('[data-testid="clear-all-button"]').click()
        cy.get('[data-testid="clear-all-confirm"]').click()
        cy.contains("All IPs cleared").should("be.visible")
        cy.countAllowlistFor(other.userId).should("eq", 0)
      })
    })
  })
})
```

- [ ] **Step 5: Run each Cypress spec**

For each spec, with `pnpm dev` (`CYPRESS=true pnpm dev` if email verification is required) running in another terminal:

```bash
npx cypress run --spec cypress/e2e/ip-allowlist-toggle.cy.ts
npx cypress run --spec cypress/e2e/ip-allowlist-block.cy.ts
npx cypress run --spec cypress/e2e/ip-allowlist-inspector.cy.ts
```

Expected: all three pass.

If a spec fails because `127.0.0.1` doesn't match the observed IP, update the seed call with the value captured during the spike step.

- [ ] **Step 6: Remove the temp test endpoint**

Once stable, delete `src/app/api/test/echo-ip/route.ts` (only needed for the spike).

- [ ] **Step 7: Commit**

```bash
git add cypress/e2e/ip-allowlist-toggle.cy.ts \
        cypress/e2e/ip-allowlist-block.cy.ts \
        cypress/e2e/ip-allowlist-inspector.cy.ts
git rm src/app/api/test/echo-ip/route.ts
git commit -m "test(e2e): cypress coverage for IP allowlist toggle, block, inspector"
```

---

## Task 16: Final verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors from this feature.

- [ ] **Step 3: Full unit test suite**

Run: `pnpm test`
Expected: all tests pass, including the new `ip-allowlist.test.ts` and `ip-allowlist.actions.test.ts`.

- [ ] **Step 4: All Cypress specs related to feature**

```bash
npx cypress run --spec "cypress/e2e/ip-allowlist-*.cy.ts"
```

Expected: all three specs pass.

- [ ] **Step 5: Smoke regression — auth-related Cypress specs**

The login/role flows were modified (proxy, withAction, auth.ts hook). Run:

```bash
npx cypress run --spec cypress/e2e/auth-gate.cy.ts
npx cypress run --spec cypress/e2e/admin-panel.cy.ts
```

Expected: both pass with no regressions.

- [ ] **Step 6: Commit any final fixes if needed**

If the verification phase surfaced bugs, fix them with a `fix(ip-allowlist): <what>` commit. If nothing surfaced, this step is a no-op.

- [ ] **Step 7: Report complete**

Plan complete when all checkboxes above are checked. Surface any deviations or open questions to the user — do NOT mark as complete with failing tests.

---

## Self-Review Notes (writer's pass)

- **Spec coverage:** every section of `2026-04-30-ip-allowlist-design.md` maps to a task —
  - Data model → Task 1
  - Permissions → Task 2
  - Shared module → Task 3
  - Login capture → Task 4
  - Server actions → Task 5
  - Layer 1/2/3 enforcement → Tasks 6, 7, 8
  - `/access-blocked` page → Task 9
  - Toggle UI → Tasks 11, 13
  - Sheet inspector → Task 12
  - Demotion cleanup → Task 14
  - Vitest unit tests → Tasks 3, 5
  - Cypress E2E → Task 15
  - Final verification → Task 16

- **Type consistency:** `recordAdminLoginIp(userId, ip)`, `isIpAllowed(ip)`, `clearCaches()`, `getClientIp(headers)`, `recordBlock(userId, ip, path)` — used identically in Tasks 3, 4, 6, 7, 8, 14.

- **Risks the executor should flag:**
  - The 31-second `cy.wait` in Task 15 is brittle. Acceptable in v1, but if the test flakes consistently, expose a test-only "clear caches" endpoint guarded by `CYPRESS=true`.
  - Production DB push in Task 1 step 5 must be confirmed with the user — never push to prod silently.
  - The `xmax = 0` Postgres trick to detect "actually inserted vs. updated" in `upsertAllowlist` is correct on Postgres ≥ 9.5 but specific to PG. If migrating off PG, revisit.
