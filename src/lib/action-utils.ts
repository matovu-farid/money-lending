import { cache } from "react"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"
import { getPermissionsForRole, MANAGING_SUPERVISOR_ELEVATED } from "@/lib/permissions"
import { db } from "@/lib/db"
import { delegations } from "@/lib/db/schema/delegations"
import { eq, isNull, and } from "drizzle-orm"
import type { Permission } from "@/types"

/**
 * Get the current authenticated session, or null if not logged in.
 *
 * Memoised per-request via React's `cache()` — multiple callers within
 * the same request reuse a single DB round-trip to better-auth's
 * session validator (which can be ~1s on remote DBs).
 */
export const getSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ? session : null
})

/**
 * Extract the user's role from a session, defaulting to "unassigned".
 */
export function getUserRole(session: { user: Record<string, unknown> }): UserRole {
  return (session.user.role ?? "unassigned") as UserRole
}

/**
 * Check if the session user meets the minimum role requirement.
 * Returns an error string if forbidden, or null if permitted.
 */
export function requireRole(
  session: { user: Record<string, unknown> },
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

/**
 * Get effective permissions for a user based on their role.
 * Supervisors with an active delegation get elevated permissions.
 *
 * Memoised per-request — same (userId, role) pair within one request
 * reuses the same Set instance (and skips repeat delegation queries).
 */
export const getEffectivePermissions = cache(async (
  userId: string,
  role: UserRole,
): Promise<Set<Permission>> => {
  const base = getPermissionsForRole(role)
  if (role === "supervisor") {
    const delegated = await hasActiveDelegation(userId)
    if (delegated) {
      return new Set<Permission>([...base, ...MANAGING_SUPERVISOR_ELEVATED])
    }
  }
  return base
})

/**
 * Check if the session user has the required permission.
 * Returns an error string if forbidden, or null if permitted.
 */
export async function checkPermission(
  session: { user: { id: string } & Record<string, unknown> },
  permission: Permission,
  message?: string,
): Promise<string | null> {
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  return perms.has(permission) ? null : (message ?? "Forbidden")
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
  if ("_tag" in error && typeof (error as any)._tag === "string") {
    return (error as any)._tag
  }
  // Effect FiberFailure wrapper: the cause chain holds the real error
  const cause =
    (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ??
    (error as any).cause
  if (cause && typeof cause === "object") {
    // Cause.Fail stores the error under "failure" or "error"
    const inner = cause.failure ?? cause.error
    if (inner && typeof inner === "object" && "_tag" in inner) {
      return inner._tag as string
    }
  }
  return undefined
}

/**
 * Extract a specific field from an Effect FiberFailure's inner error.
 */
export function getErrorField(error: unknown, field: string): unknown {
  if (error == null || typeof error !== "object") return undefined
  // Direct access
  if ("_tag" in error && field in error) return (error as any)[field]
  // Effect FiberFailure wrapper
  const cause =
    (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ??
    (error as any).cause
  if (cause && typeof cause === "object") {
    const inner = cause.failure ?? cause.error
    if (inner && typeof inner === "object" && field in inner) {
      return (inner as any)[field]
    }
  }
  return undefined
}
