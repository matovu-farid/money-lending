"use server"

import { validateInviteToken, markInvitationAccepted } from "@/services/invitation.service"
import { db } from "@/lib/db"
import { eq } from "drizzle-orm"
import { user } from "@/lib/db/schema/auth"
import { invalidateUserPermissions } from "@/lib/action-utils"
import type { UserRole } from "@/types"

export async function getInviteDetails(token: string) {
  if (!token) return { error: "No invitation token provided" }

  const result = await validateInviteToken(token)
  if (!result.valid) {
    return { error: result.error }
  }

  return {
    data: {
      name: result.invitation.name,
      email: result.invitation.email,
      role: result.invitation.role,
    },
  }
}

export async function prepareInviteAcceptance(token: string) {
  if (!token) return { error: "No invitation token provided" }

  const result = await validateInviteToken(token)
  if (!result.valid) {
    return { error: result.error }
  }

  return { data: { success: true } }
}

/**
 * Apply the invitation to the freshly-created user.
 *
 * Auth model: the invitation token IS the credential here. Possession of the
 * token (sent only to the invitee's email) authorizes flipping emailVerified
 * and assigning the role. We deliberately do NOT require a session — with
 * `requireEmailVerification: true` in auth.ts, signUp.email creates the user
 * but never establishes a session, so a session check would always 401.
 */
export async function finalizeInviteAcceptance(token: string) {
  if (!token) return { error: "No invitation token provided" }

  try {
    const result = await validateInviteToken(token)
    if (!result.valid) return { error: result.error }
    const { invitation } = result

    // The user record was just created by signUp.email — find it by the
    // invitation's email rather than by session (which doesn't exist yet).
    const [u] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, invitation.email))
      .limit(1)

    if (!u) {
      return { error: "User account not found — sign up first" }
    }

    await Promise.all([
      db
        .update(user)
        .set({ role: invitation.role as UserRole, emailVerified: true })
        .where(eq(user.id, u.id)),
      markInvitationAccepted(invitation.id),
    ])

    // Flush stale "unassigned" permission entries so the next request reflects
    // the new role immediately.
    invalidateUserPermissions(u.id)

    return { data: { success: true } }
  } catch (e: any) {
    return { error: e.message ?? "Failed to finalize invitation" }
  }
}
