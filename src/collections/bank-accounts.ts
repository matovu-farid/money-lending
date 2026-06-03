"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  createBankAccountAction,
  updateBankAccountAction,
  listBankAccountsAction,
} from "@/actions/bank-account.actions"
import type { UpdateBankAccountInput } from "@/types"
import { bankAccountSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"

export const bankAccountCollection = createCollection(
  queryCollectionOptions({
    id: "bank-accounts",
    schema: bankAccountSchema,
    getKey: (account) => account.id,
    queryKey: [...queryKeys.bankAccounts.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listBankAccountsAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createBankAccountAction({ id: modified.id, name: modified.name })
      if ("error" in result) {
        throw new Error(result.error)
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      emitTableChange("bank_accounts")
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateBankAccountInput = { id: original.id, ...changes }
      const result = await updateBankAccountAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      emitTableChange("bank_accounts")
      return { txid: result.txid }
    },
  })
)
