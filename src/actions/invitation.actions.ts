// src/actions/invitation.actions.ts
"use server"

import { withAction, type Session } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import { getUserRole } from "@/lib/action-utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import {
  createInvitation,
  revokeInvitation,
  resendInvitation,
  listInvitations,
} from "@/services/invitation.service"

interface CreateInviteInput {
  id: string
  email: string
  name: string
  role: UserRole
}

export const createInviteAction = withAction({
  permission: "user:invite",
  forbiddenMessage: "Only admins can send invitations",
  action: async (session: Session, input: CreateInviteInput) => {
    if (!input.id?.trim()) return { error: "ID is required" }
    if (!input.email?.trim()) return { error: "Email is required" }
    if (!input.name?.trim()) return { error: "Name is required" }
    if (!input.role) return { error: "Role is required" }

    // Enforce hierarchy: can only invite to roles below your own
    const actorRole = getUserRole(session)
    const actorLevel = ROLE_LEVELS[actorRole] ?? 0
    const targetLevel = ROLE_LEVELS[input.role] ?? 0

    if (targetLevel >= actorLevel) {
      return { error: "Cannot invite to a role at or above your own level" }
    }

    try {
      const data = await createInvitation({
        id: input.id.trim(),
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        role: input.role,
        invitedById: session.user.id,
        inviterName: session.user.name ?? "Admin",
      })
      revalidatePath("/admin")
      return { data }
    } catch (e) {
      console.error("[createInviteAction] Failed:", e)
      return { error: e instanceof Error ? e.message : "Failed to send invitation" }
    }
  },
})

export const revokeInviteAction = withAction({
  permission: "user:invite",
  forbiddenMessage: "Only admins can revoke invitations",
  action: async (_session: Session, input: { invitationId: string }) => {
    if (!input.invitationId?.trim()) return { error: "Invitation ID is required" }

    try {
      const data = await revokeInvitation(input.invitationId)
      revalidatePath("/admin")
      return { data }
    } catch (e) {
      console.error("[revokeInviteAction] Failed:", e)
      return { error: e instanceof Error ? e.message : "Failed to revoke invitation" }
    }
  },
})

export const resendInviteAction = withAction({
  permission: "user:invite",
  forbiddenMessage: "Only admins can resend invitations",
  action: async (session: Session, input: { invitationId: string }) => {
    if (!input.invitationId?.trim()) return { error: "Invitation ID is required" }

    try {
      const data = await resendInvitation(
        input.invitationId,
        session.user.name ?? "Admin",
      )
      revalidatePath("/admin")
      return { data }
    } catch (e) {
      console.error("[resendInviteAction] Failed:", e)
      return { error: e instanceof Error ? e.message : "Failed to resend invitation" }
    }
  },
})

export const listInvitationsAction = withAction({
  permission: "user:invite",
  action: async () => {
    try {
      const data = await listInvitations()
      return { data }
    } catch (e) {
      console.error("[listInvitationsAction] Failed:", e)
      return { error: "Failed to load invitations" }
    }
  },
})
