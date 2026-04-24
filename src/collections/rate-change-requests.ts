"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  requestRateChangeAction,
  reviewRateChangeRequestAction,
} from "@/actions/rate-change-request.actions"
import type { RateChangeRequest, CreateRateChangeRequestInput } from "@/types/rate-change"
import { shapeUrl } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateRateChangeRequestInput has fields
 * (loanId, requestedRate) that don't map 1:1 to the Electric row shape.
 */
const pendingInsertInputs = new Map<string, CreateRateChangeRequestInput>()
const pendingReviews = new Map<
  string,
  { requestId: string; action: "approved" | "rejected"; reviewNote?: string }
>()

export const rateChangeRequestCollection = createCollection(
  electricCollectionOptions<RateChangeRequest>({
    id: "rate-change-requests",
    getKey: (request) => request.id,
    shapeOptions: {
      url: shapeUrl("rate_change_requests"),
      columnMapper: snakeCamelMapper(),
    },
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const reviewInput = pendingReviews.get(original.id)
      if (reviewInput) {
        const result = await reviewRateChangeRequestAction(reviewInput)
        pendingReviews.delete(original.id)
        if ("error" in result) throw new Error(result.error)
        if (reviewInput.action === "approved") {
          // Invalidate query-based collections
          const qc = getQueryClient()
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
        throw new Error(
          "Missing rate change request input for optimistic insert"
        )
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
 * Review a rate change request (approve/reject) via the collection.
 * Uses the side-channel map so the onUpdate handler has the review input.
 */
export function reviewRateChangeRequest(
  id: string,
  input: {
    requestId: string
    action: "approved" | "rejected"
    reviewNote?: string
  }
) {
  pendingReviews.set(id, input)
  rateChangeRequestCollection.update(id, (draft) => {
    draft.status = input.action
  })
}

export function insertRateChangeRequestWithInput(
  id: string,
  optimistic: RateChangeRequest,
  input: CreateRateChangeRequestInput
) {
  pendingInsertInputs.set(id, input)
  rateChangeRequestCollection.insert(optimistic)
}
