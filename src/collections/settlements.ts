"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { SettleWithCollateralInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"

/** Row shape representing a completed settlement (optimistic placeholder). */
export interface SettlementRow {
  id: string
  loanId: string
  reason: string
  settledAt: Date
}

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because SettleWithCollateralInput has fields
 * (loanId, reason) that aren't part of the SettlementRow.
 */
const pendingInsertInputs = new Map<string, SettleWithCollateralInput>()

export const settlementCollection = createCollection(
  queryCollectionOptions<SettlementRow>({
    queryKey: ["settlements"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<SettlementRow>> => {
      // No list action exists for settlements — they are one-off loan operations.
      // The collection exists to enable optimistic inserts via the side-channel pattern.
      return []
    },
    getKey: (settlement) => settlement.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInsertInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing settlement input for optimistic insert")
      }
      pendingInsertInputs.delete(modified.id)
      const result = await settleWithCollateralAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)

/**
 * Insert a settlement with its full form input.
 * Call this instead of settlementCollection.insert() directly so the onInsert
 * handler can access the original SettleWithCollateralInput via the side-channel map.
 */
export function insertSettlementWithInput(
  id: string,
  optimistic: SettlementRow,
  input: SettleWithCollateralInput
) {
  pendingInsertInputs.set(id, input)
  settlementCollection.insert(optimistic)
}
