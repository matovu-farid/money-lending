"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listFundTransfersAction,
  createFundTransferAction,
  createCapitalInjectionAction,
} from "@/actions/fund-transfer.actions"
import type {
  CreateFundTransferInput,
  CreateCapitalInjectionInput,
} from "@/types/fund-transfer"
import type { DepositLocation } from "@/types/common"
import { fundTransferSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { invalidateFinancialProjections } from "@/lib/cache-invalidation"
import { emitTableChange } from "@/lib/table-events"
import { throwIfActionError, coerceDates } from "./_utils"

/** Extra context for onInsert that isn't always on the optimistic row. */
export interface FundTransferInsertMetadata {
  transferredAt?: string
  backdateNote?: string
}

// Dashboard KPIs depend on the Cash ledger but the dashboard collection only
// subscribes to loans/payments tables — capital injections + fund transfers
// don't touch those, so we invalidate the financial-projection set explicitly
// here since Electric's automatic propagation is gone.

export const fundTransferCollection = createCollection(
  queryCollectionOptions({
    id: "fund-transfers",
    schema: fundTransferSchema,
    queryKey: [...queryKeys.fundTransfers.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const rows = throwIfActionError(await listFundTransfersAction()).data
      return coerceDates(rows, ["transferredAt", "backdatedFrom", "backdatedAt", "createdAt"])
    },
    getKey: (transfer) => transfer.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as FundTransferInsertMetadata | undefined
      const transferredAt =
        meta?.transferredAt ??
        (modified.transferredAt instanceof Date
          ? modified.transferredAt.toISOString()
          : modified.transferredAt
            ? String(modified.transferredAt)
            : undefined)
      const backdateNote = meta?.backdateNote ?? modified.backdateNote ?? undefined
      let txid: number
      if (modified.transferType === "capital_injection") {
        const input: CreateCapitalInjectionInput = {
          id: modified.id,
          toLocation: modified.toLocation as DepositLocation,
          toSubLocationId: modified.toSubLocationId ?? undefined,
          amount: modified.amount,
          note: modified.note ?? undefined,
          transferredAt,
          backdateNote: backdateNote ?? undefined,
        }
        const result = throwIfActionError(await createCapitalInjectionAction(input))
        txid = result.txid
      } else {
        const input: CreateFundTransferInput = {
          id: modified.id,
          fromLocation: modified.fromLocation as DepositLocation,
          toLocation: modified.toLocation as DepositLocation,
          fromSubLocationId: modified.fromSubLocationId ?? undefined,
          toSubLocationId: modified.toSubLocationId ?? undefined,
          amount: modified.amount,
          note: modified.note ?? undefined,
          transferredAt,
          backdateNote: backdateNote ?? undefined,
        }
        const result = throwIfActionError(await createFundTransferAction(input))
        txid = result.txid
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.fundTransfers.all })
      invalidateFinancialProjections(qc)
      emitTableChange("fund_transfers")
      emitTableChange("transactions")
      return { txid }
    },
  })
)
