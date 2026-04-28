"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createDelegationAction,
  revokeDelegationAction,
} from "@/actions/delegation.actions"
import { delegationSchema, type DelegationRow } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"

export type { DelegationRow }

export const delegationCollection = createCollection(
  electricCollectionOptions({
    id: "delegations",
    schema: delegationSchema,
    getKey: (delegation) => delegation.id,
    shapeOptions: {
      url: shapeUrl("delegation"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("delegation"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createDelegationAction({ id: modified.id, userId: modified.userId })
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
