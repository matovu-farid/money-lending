"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listCreditorsAction,
  createCreditorWithInvestmentAction,
  updateCreditorAction,
} from "@/actions/creditor.actions"
import type { Creditor, CreateCreditorWithInvestmentInput, UpdateCreditorInput } from "@/types/creditor"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the full form input (including investment fields)
 * keyed by client-generated ID. The onInsert handler reads from here because
 * CreateCreditorWithInvestmentInput has fields not present on Creditor.
 */
const pendingInsertInputs = new Map<string, CreateCreditorWithInvestmentInput>()

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
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing creditor input for optimistic insert")
      }
      const result = await createCreditorWithInvestmentAction(input)
      pendingInsertInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
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

/**
 * Insert a creditor with its full form input (including initial investment).
 * Call this instead of creditorCollection.insert() directly so the onInsert
 * handler can access the original input via the side-channel map.
 */
export function insertCreditorWithInput(
  id: string,
  optimistic: Creditor,
  input: CreateCreditorWithInvestmentInput
) {
  pendingInsertInputs.set(id, input)
  creditorCollection.insert(optimistic)
}
