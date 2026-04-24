"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createBankAccountAction,
  updateBankAccountAction,
} from "@/actions/bank-account.actions"
import type { BankAccount, CreateBankAccountInput, UpdateBankAccountInput } from "@/types"
import { shapeUrl } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const pendingInsertInputs = new Map<string, CreateBankAccountInput>()
const pendingUpdateInputs = new Map<string, UpdateBankAccountInput>()

export const bankAccountCollection = createCollection(
  electricCollectionOptions<BankAccount>({
    id: "bank-accounts",
    getKey: (account) => account.id,
    shapeOptions: {
      url: shapeUrl("bank_accounts"),
      columnMapper: snakeCamelMapper(),
    },
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
      // Invalidate query-based collections that depend on bank account data
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
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
