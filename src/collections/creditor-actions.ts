"use client"

import { createOptimisticAction } from "@tanstack/react-db"
import {
  addInvestmentAction,
  recordCreditorRepaymentAction,
} from "@/actions/creditor.actions"
import type {
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types/creditor"
import {
  systemCapitalCollection,
  creditorMonthlyDueCollection,
  getCreditorDashboardCollection,
  getCreditorMonthlySummaryCollection,
} from "@/collections/creditor-extras"
import { locationBalancesCollection } from "@/collections/loan-extras"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"

/**
 * Intent-based actions for the creditor pages. Investments + repayments now
 * live in their own Electric collections (creditor_investments,
 * creditor_repayments) so the wire-shape rows propagate automatically; what
 * still needs explicit refetch are the server-computed aggregates
 * (systemCapital, monthlyDue, the per-creditor dashboard, the monthly summary)
 * because their interest-accrual values shift the moment a row is inserted.
 *
 * Per the TanStack DB mutations guide: server writes must be synced back
 * before the mutationFn resolves, otherwise the (empty) optimistic state is
 * dropped and downstream consumers see a flicker. We `await` every refetch.
 */

async function refetchCreditorAggregates(creditorId: string) {
  await Promise.all([
    systemCapitalCollection.utils.refetch(),
    creditorMonthlyDueCollection.utils.refetch(),
    locationBalancesCollection.utils.refetch(),
    getCreditorDashboardCollection(creditorId).utils.refetch(),
    getCreditorMonthlySummaryCollection(creditorId).utils.refetch(),
  ])
  const qc = getQueryClient()
  // The collections above are query-backed; their list rows are keyed by
  // queryKeys.creditorInvestments.all / creditorRepayments.all — invalidate
  // those too so the per-row tables in /creditors/[id] pick up the new entry
  // without waiting for the 30s staleTime tick.
  qc.invalidateQueries({ queryKey: queryKeys.creditorInvestments.all })
  qc.invalidateQueries({ queryKey: queryKeys.creditorRepayments.all })
  // Balance sheet collections are parameterized by period; mark every
  // instantiated period stale so visible reports refetch.
  qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
  // Repayment portions are keyed by the (sorted) repayment-id list; the keys
  // are opaque so we invalidate the whole namespace.
  qc.invalidateQueries({
    queryKey: ["creditors", "repayment-portions"],
  })
}

/**
 * Optional success-side callbacks the dialogs use to capture the
 * server-assigned id and open a POS receipt. Threading them through the
 * input keeps the mutation-fn API surface unchanged while letting the
 * caller react to the persisted row without a second round-trip.
 */
type AddInvestmentClientInput = AddInvestmentInput & {
  onInvestmentCreated?: (investmentId: string) => void
}

type RecordCreditorRepaymentClientInput = RecordCreditorRepaymentInput & {
  creditorId: string
  onRepaymentCreated?: (repaymentId: string) => void
}

export const addInvestment = createOptimisticAction<AddInvestmentClientInput>({
  onMutate: () => {
    // No optimistic update — interest-accrual values are server-computed and
    // we can't synthesize the dashboard's derived fields client-side.
  },
  mutationFn: async (input) => {
    const { onInvestmentCreated, ...rest } = input
    const result = await addInvestmentAction(rest)
    if ("error" in result) {
      throw new Error(result.error)
    }
    if (onInvestmentCreated && result.data?.id) {
      onInvestmentCreated(result.data.id as string)
    }
    await refetchCreditorAggregates(input.creditorId)
    emitTableChange("creditor_investments")
    emitTableChange("transactions")
    return result
  },
})

export const recordCreditorRepayment = createOptimisticAction<RecordCreditorRepaymentClientInput>({
  onMutate: () => {
    // Same reasoning as `addInvestment`: aggregates are server-computed.
  },
  mutationFn: async (input) => {
    const { creditorId, onRepaymentCreated, ...rest } = input
    const result = await recordCreditorRepaymentAction(rest)
    if ("error" in result) {
      throw new Error(result.error)
    }
    if (onRepaymentCreated && result.data?.id) {
      onRepaymentCreated(result.data.id as string)
    }
    await refetchCreditorAggregates(creditorId)
    emitTableChange("creditor_repayments")
    emitTableChange("transactions")
    return result
  },
})

