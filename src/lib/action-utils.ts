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
 * Validate that a string is a positive decimal number (up to 2 decimal places).
 * Returns an error string or null.
 */
export function validatePositiveDecimal(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim() || !/^\d+(\.\d{1,2})?$/.test(value)) {
    return `${fieldName} must be a valid decimal number`
  }
  if (parseFloat(value) <= 0) {
    return `${fieldName} must be greater than zero`
  }
  return null
}

/**
 * Validate that a string is present and non-empty after trimming.
 * Returns an error string or null.
 */
export function validateRequired(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim()) return `${fieldName} is required`
  return null
}
