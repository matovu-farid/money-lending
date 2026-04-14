"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  listIncomeTransactionsAction,
  recordIncomeAction,
  deleteIncomeAction,
} from "@/actions/income.actions"
import type { TransactionRow, CreateTransactionInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateTransactionInput has fields
 * (categoryId, location, backdateNote, etc.) that aren't part of TransactionRow.
 */
const pendingInsertInputs = new Map<string, CreateTransactionInput>()

export const incomeCollection = createCollection(
  queryCollectionOptions<TransactionRow>({
    queryKey: ["income"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<TransactionRow>> => {
      const result = await listIncomeTransactionsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data.data
    },
    getKey: (income) => income.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing income input for optimistic insert")
      }
      pendingInsertInputs.delete(modified.id)
      const result = await recordIncomeAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await deleteIncomeAction(original.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)

/**
 * Insert an income transaction with its full form input.
 * Call this instead of incomeCollection.insert() directly so the onInsert
 * handler can access the original CreateTransactionInput via the side-channel map.
 */
export function insertIncomeWithInput(
  id: string,
  optimistic: TransactionRow,
  input: CreateTransactionInput
) {
  pendingInsertInputs.set(id, input)
  incomeCollection.insert(optimistic)
}
