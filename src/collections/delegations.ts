"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listDelegationsAction,
  createDelegationAction,
  revokeDelegationAction,
} from "@/actions/delegation.actions"
import { delegationSchema, type DelegationRow } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

export type { DelegationRow }

export const delegationCollection = createCollection(
  queryCollectionOptions({
    id: "delegations",
    schema: delegationSchema,
    queryKey: [...queryKeys.delegations.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      // listDelegations returns extra `userName` (join); strip it to match schema
      const result = await listDelegationsAction()
      if ("error" in result) throw new Error(result.error)
      const rows = result.data.map(({ userName: _userName, ...row }) => row)
      return coerceDates(rows, ["createdAt", "revokedAt"])
    },
    getKey: (delegation) => delegation.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      throwIfActionError(
        await createDelegationAction({ id: modified.id, userId: modified.userId }),
      )
      getQueryClient().invalidateQueries({ queryKey: queryKeys.delegations.all })
      emitTableChange("delegation")
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      throwIfActionError(
        await revokeDelegationAction({ delegationId: original.id }),
      )
      getQueryClient().invalidateQueries({ queryKey: queryKeys.delegations.all })
      emitTableChange("delegation")
    },
  })
)
