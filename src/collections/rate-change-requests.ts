"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  requestRateChangeAction,
  reviewRateChangeRequestAction,
} from "@/actions/rate-change-request.actions"
import { rateChangeRequestSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export const rateChangeRequestCollection = createCollection(
  electricCollectionOptions({
    id: "rate-change-requests",
    schema: rateChangeRequestSchema,
    getKey: (request) => request.id,
    shapeOptions: {
      url: shapeUrl("rate_change_requests"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("rate_change_requests"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await requestRateChangeAction({
        id: modified.id,
        loanId: modified.loanId,
        requestedRate: modified.requestedRate,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      // The only supported update is a review (approved/rejected). Drive the
      // review action from the row's own `status` and `reviewNote` fields —
      // no side-channel metadata needed.
      if (changes.status !== "approved" && changes.status !== "rejected") {
        throw new Error(
          "rateChangeRequestCollection only supports review updates (status: approved | rejected)"
        )
      }
      const result = await reviewRateChangeRequestAction({
        requestId: original.id,
        action: changes.status,
        reviewNote: changes.reviewNote ?? undefined,
      })
      if ("error" in result) throw new Error(result.error)
      if (changes.status === "approved") {
        // Invalidate query-based collections
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      }
    },
  })
)
