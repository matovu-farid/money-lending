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

/** Row shape synced from the raw invitation table via Electric */
export type InvitationRow = {
  id: string
  email: string
  name: string
  role: string
  status: string
  invitedBy: string
  token: string
  expiresAt: Date
  createdAt: Date
  acceptedAt: Date | null
}

export const invitationCollection = createCollection(
  electricCollectionOptions<InvitationRow>({
    id: "invitations",
    getKey: (invitation) => invitation.id,
    shapeOptions: {
      url: shapeUrl("invitation"),
      columnMapper: snakeCamelMapper(),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createInviteAction({
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
