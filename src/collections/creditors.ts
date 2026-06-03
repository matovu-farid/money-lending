"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listCreditorsAction,
  createCreditorWithInvestmentAction,
  updateCreditorAction,
} from "@/actions/creditor.actions"
import type {
  CreateCreditorWithInvestmentInput,
  UpdateCreditorInput,
} from "@/types/creditor"
import { creditorSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"

/**
 * Investment fields aren't part of the Creditor row, so callers pass them
 * through TanStack DB's `metadata` arg on insert:
 *
 *   creditorCollection.insert(optimisticCreditor, {
 *     metadata: { investment: { amount, interestRateMonthly, ... } },
 *   })
 */
export interface CreditorInsertMetadata {
  investment: {
    amount: string
    interestRateMonthly: string
    investmentDate: string
    depositLocation?: CreateCreditorWithInvestmentInput["depositLocation"]
    subLocationId?: string
  }
  /**
   * Optional callback fired with the server-assigned investment id after the
   * action succeeds. The AddCreditorDialog uses this to open a POS receipt
   * for the newly-created investment.
   */
  onInvestmentCreated?: (investmentId: string) => void
}

export const creditorCollection = createCollection(
  queryCollectionOptions({
    id: "creditors",
    schema: creditorSchema,
    queryKey: [...queryKeys.creditors.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listCreditorsAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    getKey: (creditor) => creditor.id,
    staleTime: 30_000,
    onInsert: async ({ transaction }) => {
      const { modified, metadata } = transaction.mutations[0]
      const meta = metadata as CreditorInsertMetadata | undefined
      if (!meta?.investment) {
        throw new Error("Missing investment metadata for creditor insert")
      }
      const input: CreateCreditorWithInvestmentInput = {
        id: modified.id,
        name: modified.name,
        contact: modified.contact,
        address: modified.address,
        amount: meta.investment.amount,
        interestRateMonthly: meta.investment.interestRateMonthly,
        investmentDate: meta.investment.investmentDate,
        depositLocation: meta.investment.depositLocation,
        subLocationId: meta.investment.subLocationId,
      }
      const result = await createCreditorWithInvestmentAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      if (meta.onInvestmentCreated && "investmentId" in result && typeof result.investmentId === "string") {
        meta.onInvestmentCreated(result.investmentId)
      }
      // Invalidate query-based collections that depend on creditor data
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
      qc.invalidateQueries({ queryKey: queryKeys.creditorInvestments.all })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.capital })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.monthlyDue })
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      emitTableChange("creditors")
      emitTableChange("creditor_investments")
      emitTableChange("transactions")
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateCreditorInput = {}
      if (changes.name !== undefined) input.name = changes.name
      if (changes.contact !== undefined) input.contact = changes.contact
      if (changes.address !== undefined) input.address = changes.address
      const result = await updateCreditorAction(original.id, input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
      emitTableChange("creditors")
      return { txid: result.txid }
    },
  })
)
