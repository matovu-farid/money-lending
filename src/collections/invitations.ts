"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listInvitationsAction,
  createInviteAction,
  revokeInviteAction,
} from "@/actions/invitation.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { UserRole } from "@/types"

export interface InvitationRow {
  id: string
  email: string
  name: string
  role: string
  status: string
  invitedBy: string
  inviterName: string | null
  expiresAt: Date
  createdAt: Date
  acceptedAt: Date | null
}

export const invitationCollection = createCollection(
  queryCollectionOptions<InvitationRow>({
    queryKey: [...queryKeys.invitations.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<InvitationRow>> => {
      const result = await listInvitationsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (invitation) => invitation.id,
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
