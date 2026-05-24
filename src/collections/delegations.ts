"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import {
  createDelegationAction,
  revokeDelegationAction,
} from "@/actions/delegation.actions"
import { delegationSchema, type DelegationRow } from "@/lib/schemas/collections"
import { electricShapeOptionsFor } from "@/lib/electric"

export type { DelegationRow }

export const delegationCollection = createCollection(
  electricCollectionOptions({
    id: "delegations",
    schema: delegationSchema,
    getKey: (delegation) => delegation.id,
    shapeOptions: electricShapeOptionsFor("delegation"),
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
