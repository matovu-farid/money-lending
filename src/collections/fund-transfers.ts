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
import { emitTableChange } from "@/lib/table-events"

// Dashboard KPIs depend on the Cash ledger but the dashboard collection only
// subscribes to loans/payments tables — capital injections + fund transfers
// don't touch those, so we invalidate the KPI key explicitly here. Other
// dependent collections (locationBalances, reports.balanceSheet) are also
// invalidated since Electric's automatic propagation is gone.

export const fundTransferCollection = createCollection(
  queryCollectionOptions({
    id: "fund-transfers",
    schema: fundTransferSchema,
    queryKey: [...queryKeys.fundTransfers.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listFundTransfersAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    getKey: (transfer) => transfer.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      let txid: number
      if (modified.transferType === "capital_injection") {
        const input: CreateCapitalInjectionInput = {
          id: modified.id,
          toLocation: modified.toLocation as DepositLocation,
          toSubLocationId: modified.toSubLocationId ?? undefined,
          amount: modified.amount,
          note: modified.note ?? undefined,
        }
        const result = await createCapitalInjectionAction(input)
        if ("error" in result) {
          throw new Error(result.error)
        }
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
        }
        const result = await createFundTransferAction(input)
        if ("error" in result) {
          throw new Error(result.error)
        }
        txid = result.txid
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.fundTransfers.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      emitTableChange("fund_transfers")
      emitTableChange("transactions")
      return { txid }
    },
  })
)
