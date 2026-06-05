"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listInvitationsAction,
  createInviteAction,
  revokeInviteAction,
} from "@/actions/invitation.actions"
import { invitationSchema, type InvitationRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"
import type { UserRole } from "@/types"
import { throwIfActionError, coerceDates } from "./_utils"

export type { InvitationRow }

export const invitationCollection = createCollection(
  queryCollectionOptions({
    id: "invitations",
    schema: invitationSchema,
    queryKey: [...queryKeys.invitations.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      // listInvitations returns extra `inviterName` (join); strip it to match schema
      const result = await listInvitationsAction()
      if ("error" in result) throw new Error(result.error)
      const rows = result.data.map(({ inviterName: _inviterName, ...row }) => row)
      return coerceDates(rows, ["expiresAt", "createdAt", "acceptedAt"])
    },
    getKey: (invitation) => invitation.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      throwIfActionError(
        await createInviteAction({
          id: modified.id,
          email: modified.email,
          name: modified.name,
          role: modified.role as UserRole,
        }),
      )
      getQueryClient().invalidateQueries({ queryKey: queryKeys.invitations.all })
      emitTableChange("invitation")
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      throwIfActionError(await revokeInviteAction({ invitationId: original.id }))
      getQueryClient().invalidateQueries({ queryKey: queryKeys.invitations.all })
      emitTableChange("invitation")
    },
  }),
)
