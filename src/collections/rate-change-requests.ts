"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  listAllRequestsAction,
  requestRateChangeAction,
} from "@/actions/rate-change-request.actions"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import type { CreateRateChangeRequestInput } from "@/types/rate-change"
import { getQueryClient } from "@/lib/query-client"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateRateChangeRequestInput has fields
 * (loanId, requestedRate) that don't map 1:1 to RateChangeRequestWithLoan.
 */
const pendingInsertInputs = new Map<string, CreateRateChangeRequestInput>()

export const rateChangeRequestCollection = createCollection(
  queryCollectionOptions<RateChangeRequestWithLoan>({
    queryKey: ["rate-change-requests"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<RateChangeRequestWithLoan>> => {
      const result = await listAllRequestsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (request) => request.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing rate change request input for optimistic insert")
      }
      pendingInsertInputs.delete(modified.id)
      const result = await requestRateChangeAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)

/**
 * Insert a rate change request with its full form input.
 * Call this instead of rateChangeRequestCollection.insert() directly so the onInsert
 * handler can access the original CreateRateChangeRequestInput via the side-channel map.
 */
export function insertRateChangeRequestWithInput(
  id: string,
  optimistic: RateChangeRequestWithLoan,
  input: CreateRateChangeRequestInput
) {
  pendingInsertInputs.set(id, input)
  rateChangeRequestCollection.insert(optimistic)
}
