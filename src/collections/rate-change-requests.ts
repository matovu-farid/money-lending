"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listAllRequestsAction,
  requestRateChangeAction,
  reviewRateChangeRequestAction,
} from "@/actions/rate-change-request.actions"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import type { CreateRateChangeRequestInput } from "@/types/rate-change"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateRateChangeRequestInput has fields
 * (loanId, requestedRate) that don't map 1:1 to RateChangeRequestWithLoan.
 */
const pendingInsertInputs = new Map<string, CreateRateChangeRequestInput>()
const pendingReviews = new Map<string, { requestId: string; action: "approved" | "rejected"; reviewNote?: string }>()

export const rateChangeRequestCollection = createCollection(
  queryCollectionOptions<RateChangeRequestWithLoan>({
    queryKey: [...queryKeys.rateChangeRequests.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<RateChangeRequestWithLoan>> => {
      const result = await listAllRequestsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (request) => request.id,
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const reviewInput = pendingReviews.get(original.id)
      if (reviewInput) {
        const result = await reviewRateChangeRequestAction(reviewInput)
        pendingReviews.delete(original.id)
        if ("error" in result) throw new Error(result.error)
        if (reviewInput.action === "approved") {
          const qc = getQueryClient()
          qc.invalidateQueries({ queryKey: queryKeys.loans.all })
          qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
          qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
          qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        }
      }
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing rate change request input for optimistic insert")
      }
      const result = await requestRateChangeAction(input)
      pendingInsertInputs.delete(modified.id)
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
/**
 * Review a rate change request (approve/reject) via the collection.
 * Uses the side-channel map so the onUpdate handler has the review input.
 */
export function reviewRateChangeRequest(
  id: string,
  input: { requestId: string; action: "approved" | "rejected"; reviewNote?: string }
) {
  pendingReviews.set(id, input)
  rateChangeRequestCollection.update(id, (draft) => {
    draft.status = input.action
  })
}

export function insertRateChangeRequestWithInput(
  id: string,
  optimistic: RateChangeRequestWithLoan,
  input: CreateRateChangeRequestInput
) {
  pendingInsertInputs.set(id, input)
  rateChangeRequestCollection.insert(optimistic)
}
