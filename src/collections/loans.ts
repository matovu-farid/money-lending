"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  listLoansWithOverdueAction,
  createLoanAction,
} from "@/actions/loan.actions"
import type { LoanListEntry, CreateLoanInput } from "@/types/loan"
import { getQueryClient } from "@/lib/query-client"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateLoanInput has fields
 * (collateral, rollover, backdateNote, etc.) that aren't part of LoanListEntry.
 */
const pendingInputs = new Map<string, CreateLoanInput>()

export const loanCollection = createCollection(
  queryCollectionOptions<LoanListEntry>({
    queryKey: ["loans"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanListEntry>> => {
      const result = await listLoansWithOverdueAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (loan) => loan.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing loan input for optimistic insert")
      }
      pendingInputs.delete(modified.id)
      const result = await createLoanAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)

/**
 * Insert a loan with its full form input.
 * Call this instead of loanCollection.insert() directly so the onInsert
 * handler can access the original CreateLoanInput via the side-channel map.
 */
export function insertLoanWithInput(
  id: string,
  optimistic: LoanListEntry,
  input: CreateLoanInput
) {
  pendingInputs.set(id, input)
  loanCollection.insert(optimistic)
}
