"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  listFundTransfersAction,
  createFundTransferAction,
} from "@/actions/fund-transfer.actions"
import type { FundTransfer, CreateFundTransferInput } from "@/types/fund-transfer"
import { getQueryClient } from "@/lib/query-client"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateFundTransferInput has fields
 * (fromLocation, toLocation, amount, note) that don't map 1:1 to FundTransfer columns.
 */
const pendingInsertInputs = new Map<string, CreateFundTransferInput>()

export const fundTransferCollection = createCollection(
  queryCollectionOptions<FundTransfer>({
    queryKey: ["fund-transfers"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<FundTransfer>> => {
      const result = await listFundTransfersAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (transfer) => transfer.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing fund transfer input for optimistic insert")
      }
      pendingInsertInputs.delete(modified.id)
      const result = await createFundTransferAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)

/**
 * Insert a fund transfer with its full form input.
 * Call this instead of fundTransferCollection.insert() directly so the onInsert
 * handler can access the original CreateFundTransferInput via the side-channel map.
 */
export function insertFundTransferWithInput(
  id: string,
  optimistic: FundTransfer,
  input: CreateFundTransferInput
) {
  pendingInsertInputs.set(id, input)
  fundTransferCollection.insert(optimistic)
}
