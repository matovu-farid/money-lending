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

export type { DelegationRow }

export const delegationCollection = createCollection(
  queryCollectionOptions({
    id: "delegations",
    schema: delegationSchema,
    queryKey: [...queryKeys.delegations.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listDelegationsAction()
      if ("error" in result) throw new Error(result.error)
      // listDelegations returns extra `userName` (join); strip it to match schema
      return result.data.map(({ userName: _userName, ...row }) => row)
    },
    getKey: (delegation) => delegation.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createDelegationAction({ id: modified.id, userId: modified.userId })
      if ("error" in result) {
        throw new Error(result.error)
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.delegations.all })
      emitTableChange("delegation")
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await revokeDelegationAction({ delegationId: original.id })
      if ("error" in result) {
        throw new Error(result.error)
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.delegations.all })
      emitTableChange("delegation")
    },
  })
)
