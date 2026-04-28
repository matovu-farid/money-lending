"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createBankAccountAction,
  updateBankAccountAction,
} from "@/actions/bank-account.actions"
import type { UpdateBankAccountInput } from "@/types"
import { bankAccountSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export const bankAccountCollection = createCollection(
  electricCollectionOptions({
    id: "bank-accounts",
    schema: bankAccountSchema,
    getKey: (account) => account.id,
    shapeOptions: {
      url: shapeUrl("bank_accounts"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("bank_accounts"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createBankAccountAction({ id: modified.id, name: modified.name })
      if ("error" in result) {
        throw new Error(result.error)
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateBankAccountInput = { id: original.id, ...changes }
      const result = await updateBankAccountAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      return { txid: result.txid }
    },
  })
)
