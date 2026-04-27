"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createFundTransferAction,
  createCapitalInjectionAction,
} from "@/actions/fund-transfer.actions"
import type { FundTransfer, CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types/fund-transfer"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

// Dashboard KPIs depend on the Cash ledger but the dashboard collection only
// subscribes to loans/payments tables — capital injections + fund transfers
// don't touch those, so we invalidate the KPI key explicitly here. Other
// dependent collections (locationBalances, reports.balanceSheet) already
// auto-invalidate via subscribeToTableChanges on `transactions` and
// `fund_transfers`, so manually invalidating them would be redundant.

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateFundTransferInput has fields
 * (fromLocation, toLocation, amount, note) that don't map 1:1 to FundTransfer columns.
 */
const pendingInsertInputs = new Map<string, CreateFundTransferInput>()
const pendingInjectionInputs = new Map<string, CreateCapitalInjectionInput>()

export const fundTransferCollection = createCollection(
  electricCollectionOptions<FundTransfer>({
    id: "fund-transfers",
    getKey: (transfer) => transfer.id,
    shapeOptions: {
      url: shapeUrl("fund_transfers"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("fund_transfers"),
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const injectionInput = pendingInjectionInputs.get(modified.id)
      if (injectionInput) {
        const result = await createCapitalInjectionAction(injectionInput)
        pendingInjectionInputs.delete(modified.id)
        if ("error" in result) {
          throw new Error(result.error)
        }
      } else {
        const input = pendingInsertInputs.get(modified.id)
        if (!input) {
          throw new Error("Missing fund transfer input for optimistic insert")
        }
        const result = await createFundTransferAction(input)
        pendingInsertInputs.delete(modified.id)
        if ("error" in result) {
          throw new Error(result.error)
        }
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
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

export function insertCapitalInjectionWithInput(
  id: string,
  optimistic: FundTransfer,
  input: CreateCapitalInjectionInput
) {
  pendingInjectionInputs.set(id, input)
  fundTransferCollection.insert(optimistic)
}
