"use server"

import { validateInviteToken, acceptInvitation, markInvitationAccepted } from "@/services/invitation.service"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { eq } from "drizzle-orm"
import { user } from "@/lib/db/schema/auth"
import { invalidateUserPermissions } from "@/lib/action-utils"

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

export async function finalizeInviteAcceptance(token: string) {
  if (!token) return { error: "No invitation token provided" }

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { error: "Not authenticated" }
    }

    const { invitationId, role } = await acceptInvitation(token)

    await Promise.all([
      db.update(user).set({ role, emailVerified: true }).where(eq(user.id, session.user.id)),
      markInvitationAccepted(invitationId),
    ])

    // The user just got a real role assigned — flush any stale "unassigned"
    // permission entries so the very next request reflects their new role.
    invalidateUserPermissions(session.user.id)

    return { data: { success: true } }
  } catch (e: any) {
    return { error: e.message ?? "Failed to finalize invitation" }
  }
}
