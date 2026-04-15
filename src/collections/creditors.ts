"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listCreditorsAction,
  createCreditorAction,
  updateCreditorAction,
} from "@/actions/creditor.actions"
import type { Creditor, CreateCreditorInput, UpdateCreditorInput } from "@/types/creditor"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export const creditorCollection = createCollection(
  queryCollectionOptions<Creditor>({
    queryKey: [...queryKeys.creditors.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<Creditor>> => {
      const result = await listCreditorsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (creditor) => creditor.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input: CreateCreditorInput = {
        name: modified.name,
        contact: modified.contact,
        address: modified.address,
      }
      const result = await createCreditorAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateCreditorInput = {}
      if (changes.name !== undefined) input.name = changes.name
      if (changes.contact !== undefined) input.contact = changes.contact
      if (changes.address !== undefined) input.address = changes.address
      const result = await updateCreditorAction(original.id, input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)
