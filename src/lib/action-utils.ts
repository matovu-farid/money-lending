import { cache } from "react"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"
import { getPermissionsForRole, MANAGING_SUPERVISOR_ELEVATED } from "@/lib/permissions"
import { db } from "@/lib/db"
import { delegations } from "@/lib/db/schema/delegations"
import { eq, isNull, and } from "drizzle-orm"
import type { Permission } from "@/types"

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------
//
// Better Auth's TS surface doesn't include `role` on its user type — the field
// is added at runtime by the `admin` plugin. We widen the inferred user shape
// here so every consumer of `getSession()` sees `role` without resorting to
// structural casts at every callsite.

type BetterAuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>

export type SessionUser = BetterAuthSession["user"] & {
  role?: UserRole | null
}

export type Session = Omit<BetterAuthSession, "user"> & {
  user: SessionUser
}

/**
 * Get the current authenticated session, or null if not logged in.
 *
 * Memoised per-request via React's `cache()` — multiple callers within
 * the same request reuse a single DB round-trip to better-auth's
 * session validator (which can be ~1s on remote DBs).
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  // The admin plugin attaches `role` to user at runtime; widen via Session.
  return session?.user ? (session as Session) : null
})

/**
 * Extract the user's role from a session, defaulting to "unassigned".
 * Accepts the widened Session shape as well as ad-hoc `{ user: { role } }`
 * objects used in tests and at the proxy boundary where role originates
 * as a plain DB string.
 */
export function getUserRole(session: { user: { role?: string | null } }): UserRole {
  return narrowRole(session.user.role)
}

/**
 * Narrow an arbitrary string (e.g. a DB column value) into a UserRole,
 * defaulting to "unassigned" for null/undefined or unrecognised values.
 * Centralises the boundary between wire/DB data and our typed role union.
 */
export function narrowRole(value: string | null | undefined): UserRole {
  return value != null && value in ROLE_LEVELS ? (value as UserRole) : "unassigned"
}

/**
 * Check if the session user meets the minimum role requirement.
 * Returns an error string if forbidden, or null if permitted.
 */
export function requireRole(
  session: { user: { role?: string | null } },
  minRole: UserRole,
  message?: string,
): string | null {
  const role = getUserRole(session)
  return ROLE_LEVELS[role] < ROLE_LEVELS[minRole] ? (message ?? "Forbidden") : null
}

/**
 * Check if a user has an active delegation (revokedAt IS NULL).
 * Memoised per-request to avoid repeating the delegation lookup across
 * multiple permission checks within the same server action invocation.
 */
export const hasActiveDelegation = cache(async (userId: string): Promise<boolean> => {
  const rows = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)
  return rows.length > 0
})

// ---------------------------------------------------------------------------
// Cross-request short-TTL cache for effective permissions
// ---------------------------------------------------------------------------
//
// `cache()` from React only dedupes within a single request/render. Server
// actions run in fresh requests, so the same user hitting POST /customers,
// then POST /expenses, then GET /reports re-runs the underlying delegation
// lookup every time — that lookup was profiled at ~1.4 s in dev because it
// blocks on better-auth + Postgres.
//
// To kill that overhead we add a tiny module-scoped cache keyed on
// `${userId}:${role}` with a 30-second TTL.
//
// TTL choice: 30 s is the better-auth-style trade. Permission/role/delegation
// changes propagate within at most half a minute on their own, AND every
// known mutation site (assignRole, finalizeInviteAcceptance, create/revoke
// delegation) calls `invalidateUserPermissions(userId)` immediately after
// the DB write — so under normal operation the cache is invalidated in
// real time. The 30 s TTL is purely a safety net for cases we haven't
// hooked (e.g. direct DB tweaks, future code paths that forget to call the
// invalidator).
//
// We cap the map at 1000 entries with FIFO eviction so a long-running dev
// process can't leak memory.

type CachedPermissions = { value: Set<Permission>; expiresAt: number }

const PERMISSIONS_CACHE_TTL_MS = 30_000
const PERMISSIONS_CACHE_MAX = 1000

const permissionsCache = new Map<string, CachedPermissions>()

function permissionsCacheKey(userId: string, role: UserRole): string {
  return `${userId}:${role}`
}

function setPermissionsCache(key: string, value: Set<Permission>): void {
  // FIFO eviction: when full, drop the oldest entry (Map preserves insertion
  // order, so the first key is the oldest).
  if (permissionsCache.size >= PERMISSIONS_CACHE_MAX) {
    const oldest = permissionsCache.keys().next().value
    if (oldest !== undefined) permissionsCache.delete(oldest)
  }
  permissionsCache.set(key, { value, expiresAt: Date.now() + PERMISSIONS_CACHE_TTL_MS })
}

/**
 * Invalidate every cache entry for a userId — call this immediately after
 * any mutation that affects the user's effective permissions:
 *   - `auth.api.setRole(...)` (assignRole)
 *   - `db.update(user).set({ role })` (invite acceptance)
 *   - createDelegation / revokeDelegation
 *
 * It also sweeps `permissionsCache` of any expired entries opportunistically.
 * Cheap (O(n) over <=1000 entries) and only called on writes.
 */
export function invalidateUserPermissions(userId: string): void {
  const prefix = `${userId}:`
  const now = Date.now()
  for (const [k, v] of permissionsCache) {
    if (k.startsWith(prefix) || v.expiresAt <= now) {
      permissionsCache.delete(k)
    }
  }
}

/**
 * Test/maintenance helper — clear the entire cross-request cache. Not
 * exported from a barrel; primarily used in unit tests where multiple
 * cases share module state.
 */
export function __clearPermissionsCacheForTests(): void {
  permissionsCache.clear()
}

async function computeEffectivePermissions(
  userId: string,
  role: UserRole,
): Promise<Set<Permission>> {
  const base = getPermissionsForRole(role)
  if (role === "supervisor") {
    const delegated = await hasActiveDelegation(userId)
    if (delegated) {
      return new Set<Permission>([...base, ...MANAGING_SUPERVISOR_ELEVATED])
    }
  }
  return base
}

/**
 * Get effective permissions for a user based on their role.
 * Supervisors with an active delegation get elevated permissions.
 *
 * Two-layer caching:
 *   1. Per-request: React's `cache()` dedupes calls within a single
 *      server action / RSC render so the same (userId, role) Set is
 *      reused without re-checking delegations.
 *   2. Cross-request: a 30 s in-memory TTL cache keyed on
 *      `${userId}:${role}` so back-to-back navigations stop re-running
 *      the ~1.4 s delegation lookup. Invalidated immediately on
 *      role/delegation writes via `invalidateUserPermissions()`.
 */
export const getEffectivePermissions = cache(async (
  userId: string,
  role: UserRole,
): Promise<Set<Permission>> => {
  const key = permissionsCacheKey(userId, role)
  const hit = permissionsCache.get(key)
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value
  }
  // Stale entry — drop before refilling so the FIFO order reflects recency.
  if (hit) permissionsCache.delete(key)

  const value = await computeEffectivePermissions(userId, role)
  setPermissionsCache(key, value)
  return value
})

/**
 * Check if the session user has the required permission.
 * Returns an error string if forbidden, or null if permitted.
 */
export async function checkPermission(
  session: { user: { id: string; role?: string | null } },
  permission: Permission,
  message?: string,
): Promise<string | null> {
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  return perms.has(permission) ? null : (message ?? "Forbidden")
}

/**
 * Narrow `unknown` to an object that owns the given key, without resorting
 * to `as any`. Use after `typeof obj === "object" && obj !== null`-style
 * checks where you also need to access a specific property.
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj
}

const FIBER_FAILURE_CAUSE = Symbol.for("effect/Runtime/FiberFailure/Cause")

/**
 * Extract the inner error wrapped by an Effect FiberFailure, if any.
 * Returns the unwrapped error (or undefined).
 */
function unwrapEffectFailure(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined
  const causeContainer = error as Record<string | symbol, unknown>
  const cause = causeContainer[FIBER_FAILURE_CAUSE] ?? causeContainer.cause
  if (typeof cause !== "object" || cause === null) return undefined
  const causeObj = cause as Record<string, unknown>
  return causeObj.failure ?? causeObj.error
}

/**
 * Extract the `_tag` string from an Effect FiberFailure error.
 *
 * `Effect.runPromise` wraps failures in a `FiberFailureImpl` object,
 * so `instanceof` checks against tagged error classes never match.
 * This helper digs into the wrapper to retrieve the original `_tag`.
 */
export function getErrorTag(error: unknown): string | undefined {
  if (error == null || typeof error !== "object") return undefined
  // Direct _tag (plain throw or already unwrapped)
  if (hasProperty(error, "_tag") && typeof error._tag === "string") {
    return error._tag
  }
  // Effect FiberFailure wrapper: the cause chain holds the real error
  const inner = unwrapEffectFailure(error)
  if (hasProperty(inner, "_tag") && typeof inner._tag === "string") {
    return inner._tag
  }
  return undefined
}

/**
 * Extract a specific field from an Effect FiberFailure's inner error.
 */
export function getErrorField(error: unknown, field: string): unknown {
  if (error == null || typeof error !== "object") return undefined
  // Direct access — only when we can identify this as a tagged error
  if (hasProperty(error, "_tag") && hasProperty(error, field)) {
    return error[field]
  }
  // Effect FiberFailure wrapper
  const inner = unwrapEffectFailure(error)
  if (hasProperty(inner, field)) {
    return inner[field]
  }
  return undefined
}
