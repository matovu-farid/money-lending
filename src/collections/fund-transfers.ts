"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listFundTransfersAction,
  createFundTransferAction,
  createCapitalInjectionAction,
} from "@/actions/fund-transfer.actions"
import type { FundTransfer, CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types/fund-transfer"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Side-channel map: stores the original form input keyed by client-generated ID.
 * The onInsert handler reads from here because CreateFundTransferInput has fields
 * (fromLocation, toLocation, amount, note) that don't map 1:1 to FundTransfer columns.
 */
const pendingInsertInputs = new Map<string, CreateFundTransferInput>()
const pendingInjectionInputs = new Map<string, CreateCapitalInjectionInput>()

export const fundTransferCollection = createCollection(
  queryCollectionOptions<FundTransfer>({
    queryKey: [...queryKeys.fundTransfers.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<FundTransfer>> => {
      const result = await listFundTransfersAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (transfer) => transfer.id,
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
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
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
