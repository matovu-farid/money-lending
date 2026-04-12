import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"

/**
 * Get the current authenticated session, or null if not logged in.
 */
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ? session : null
}

/**
 * Extract the user's role from a session, defaulting to "unassigned".
 */
export function getUserRole(session: { user: { role?: string | null } }): UserRole {
  return (session.user.role ?? "unassigned") as UserRole
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
