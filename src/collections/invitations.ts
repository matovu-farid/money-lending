"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import {
  createInviteAction,
  revokeInviteAction,
} from "@/actions/invitation.actions"
import { invitationSchema, type InvitationRow } from "@/lib/schemas/collections"
import { electricShapeOptionsFor } from "@/lib/electric"
import type { UserRole } from "@/types"

export type { InvitationRow }

export const invitationCollection = createCollection(
  electricCollectionOptions({
    id: "invitations",
    schema: invitationSchema,
    getKey: (invitation) => invitation.id,
    shapeOptions: {
      ...electricShapeOptionsFor("invitation"),
      params: {
        columns: ["id", "email", "name", "role", "status", "invited_by", "expires_at", "created_at", "accepted_at"],
      },
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
