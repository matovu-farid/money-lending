"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listDelegationsAction,
  createDelegationAction,
  revokeDelegationAction,
} from "@/actions/delegation.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh when delegations table changes via Electric
subscribeToTableChanges("delegation", getQueryClient(), [
  queryKeys.delegations.all,
])

/** Row shape returned by listDelegationsAction */
export interface DelegationRow {
  id: string
  userId: string
  userName: string | null
  delegatedBy: string
  createdAt: Date
  revokedAt: Date | null
  revokedBy: string | null
}

export const delegationCollection = createCollection(
  queryCollectionOptions<DelegationRow>({
    queryKey: [...queryKeys.delegations.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<DelegationRow>> => {
      const result = await listDelegationsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (delegation) => delegation.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createDelegationAction({ userId: modified.userId })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await revokeDelegationAction({ delegationId: original.id })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)
