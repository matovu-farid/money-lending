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
import { throwIfActionError, coerceDates } from "./_utils"

export const bankAccountCollection = createCollection(
  queryCollectionOptions({
    id: "bank-accounts",
    schema: bankAccountSchema,
    getKey: (account) => account.id,
    queryKey: [...queryKeys.bankAccounts.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listBankAccountsAction()).data
      return coerceDates(rows, ["createdAt"])
    },
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = throwIfActionError(
        await createBankAccountAction({ id: modified.id, name: modified.name }),
      )
      getQueryClient().invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      emitTableChange("bank_accounts")
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateBankAccountInput = { id: original.id, ...changes }
      const result = throwIfActionError(await updateBankAccountAction(input))
      emitTableChange("bank_accounts")
      return { txid: result.txid }
    },
  })
)
