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
  // Balance sheet collections are parameterized by period; mark every
  // instantiated period stale so visible reports refetch.
  getQueryClient().invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
  // Repayment portions are keyed by the (sorted) repayment-id list; the keys
  // are opaque so we invalidate the whole namespace.
  getQueryClient().invalidateQueries({
    queryKey: ["creditors", "repayment-portions"],
  })
}

export const addInvestment = createOptimisticAction<AddInvestmentInput>({
  onMutate: () => {
    // No optimistic update — interest-accrual values are server-computed and
    // we can't synthesize the dashboard's derived fields client-side.
  },
  mutationFn: async (input) => {
    const result = await addInvestmentAction(input)
    if ("error" in result) {
      throw new Error(result.error)
    }
    await refetchCreditorAggregates(input.creditorId)
    return result
  },
})

export const recordCreditorRepayment = createOptimisticAction<
  RecordCreditorRepaymentInput & { creditorId: string }
>({
  onMutate: () => {
    // Same reasoning as `addInvestment`: aggregates are server-computed.
  },
  mutationFn: async (input) => {
    const { creditorId, ...rest } = input
    const result = await recordCreditorRepaymentAction(rest)
    if ("error" in result) {
      throw new Error(result.error)
    }
    await refetchCreditorAggregates(creditorId)
    return result
  },
})

