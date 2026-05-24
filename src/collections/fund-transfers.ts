"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createFundTransferAction,
  createCapitalInjectionAction,
} from "@/actions/fund-transfer.actions"
import type {
  CreateFundTransferInput,
  CreateCapitalInjectionInput,
} from "@/types/fund-transfer"
import type { DepositLocation } from "@/types/common"
import { fundTransferSchema } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError, shapeParser } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

// Dashboard KPIs depend on the Cash ledger but the dashboard collection only
// subscribes to loans/payments tables — capital injections + fund transfers
// don't touch those, so we invalidate the KPI key explicitly here. Other
// dependent collections (locationBalances, reports.balanceSheet) already
// auto-invalidate via subscribeToTableChanges on `transactions` and
// `fund_transfers`, so manually invalidating them would be redundant.

export const fundTransferCollection = createCollection(
  electricCollectionOptions({
    id: "fund-transfers",
    schema: fundTransferSchema,
    getKey: (transfer) => transfer.id,
    shapeOptions: {
      url: shapeUrl("fund_transfers"),
      columnMapper: snakeCamelMapper(),
      parser: shapeParser,
      onError: shapeOnError("fund_transfers"),
    },
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
      getQueryClient().invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      return { txid }
    },
  })
)
