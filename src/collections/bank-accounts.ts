"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listBankAccountsAction,
  createBankAccountAction,
  updateBankAccountAction,
} from "@/actions/bank-account.actions"
import type { BankAccount, CreateBankAccountInput, UpdateBankAccountInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const pendingInsertInputs = new Map<string, CreateBankAccountInput>()
const pendingUpdateInputs = new Map<string, UpdateBankAccountInput>()

export const bankAccountCollection = createCollection(
  queryCollectionOptions<BankAccount>({
    queryKey: [...queryKeys.bankAccounts.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<BankAccount>> => {
      const result = await listBankAccountsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (account) => account.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing bank account input for optimistic insert")
      }
      const result = await createBankAccountAction(input)
      pendingInsertInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all })
    },
    onUpdate: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingUpdateInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing bank account input for optimistic update")
      }
      const result = await updateBankAccountAction(input)
      pendingUpdateInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all })
    },
  })
)

export function insertBankAccountWithInput(
  id: string,
  optimistic: BankAccount,
  input: CreateBankAccountInput
) {
  pendingInsertInputs.set(id, input)
  bankAccountCollection.insert(optimistic)
}

export function updateBankAccountWithInput(
  input: UpdateBankAccountInput,
  applyOptimistic: (draft: BankAccount) => void
) {
  pendingUpdateInputs.set(input.id, input)
  bankAccountCollection.update(input.id, (draft) => {
    applyOptimistic(draft as BankAccount)
  })
}
