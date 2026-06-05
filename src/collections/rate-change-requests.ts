"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listRateChangeRequestsAction,
  requestRateChangeAction,
  reviewRateChangeRequestAction,
} from "@/actions/rate-change-request.actions"
import { rateChangeRequestSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

export const rateChangeRequestCollection = createCollection(
  queryCollectionOptions({
    id: "rate-change-requests",
    schema: rateChangeRequestSchema,
    queryKey: [...queryKeys.rateChangeRequests.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listRateChangeRequestsAction()).data
      return coerceDates(rows, ["createdAt", "reviewedAt"])
    },
    getKey: (request) => request.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      throwIfActionError(
        await requestRateChangeAction({
          id: modified.id,
          loanId: modified.loanId,
          requestedRate: modified.requestedRate,
        }),
      )
      getQueryClient().invalidateQueries({ queryKey: queryKeys.rateChangeRequests.all })
      emitTableChange("rate_change_requests")
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
      throwIfActionError(
        await reviewRateChangeRequestAction({
          requestId: original.id,
          action: changes.status,
          reviewNote: changes.reviewNote ?? undefined,
        }),
      )
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.all })
      if (changes.status === "approved") {
        // Invalidate query-based collections
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        emitTableChange("loans")
      }
      emitTableChange("rate_change_requests")
    },
  })
)
