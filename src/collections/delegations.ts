"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createDelegationAction,
  revokeDelegationAction,
} from "@/actions/delegation.actions"
import { shapeUrl } from "@/lib/electric"

/** Row shape synced from the raw delegation table via Electric */
export type DelegationRow = {
  id: string
  userId: string
  delegatedBy: string
  createdAt: Date
  revokedAt: Date | null
  revokedBy: string | null
}

export const delegationCollection = createCollection(
  electricCollectionOptions<DelegationRow>({
    id: "delegations",
    getKey: (delegation) => delegation.id,
    shapeOptions: {
      url: shapeUrl("delegation"),
      columnMapper: snakeCamelMapper(),
    },
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
