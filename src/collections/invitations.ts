"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createInviteAction,
  revokeInviteAction,
} from "@/actions/invitation.actions"
import { shapeUrl } from "@/lib/electric"
import type { UserRole } from "@/types"

/** Row shape synced from the raw invitation table via Electric (token excluded for security) */
export type InvitationRow = {
  id: string
  email: string
  name: string
  role: string
  status: string
  invitedBy: string
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
}

export const invitationCollection = createCollection(
  electricCollectionOptions<InvitationRow>({
    id: "invitations",
    getKey: (invitation) => invitation.id,
    shapeOptions: {
      url: shapeUrl("invitation"),
      params: {
        columns: ["id", "email", "name", "role", "status", "invited_by", "expires_at", "created_at", "accepted_at"],
      },
      columnMapper: snakeCamelMapper(),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createInviteAction({
        id: modified.id,
        email: modified.email,
        name: modified.name,
        role: modified.role as UserRole,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await revokeInviteAction({ invitationId: original.id })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  }),
)
