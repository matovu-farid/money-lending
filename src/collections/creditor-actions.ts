"use client"

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
import { throwIfActionError } from "./_utils"

/**
 * Intent-based actions for the creditor pages. Investment / repayment rows
 * are server-computed (interest accrual, ledger-derived balances) so we
 * cannot synthesize an optimistic shape client-side. These helpers run the
 * server action, then refetch every dashboard / aggregate / list collection
 * that the row affects before returning the created id.
 *
 * Earlier versions wrapped this in `createOptimisticAction` with an empty
 * `onMutate`. That short-circuits inside TanStack DB's `Transaction.commit`
 * (see `@tanstack/db/src/transactions.ts` — when `mutations.length === 0`
 * it resolves `isPersisted` without calling `mutationFn`), so the server
 * action was never invoked and the dialogs only saw the success toast.
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

export async function addInvestment(input: AddInvestmentInput): Promise<string> {
  const result = throwIfActionError(await addInvestmentAction(input))
  await refetchCreditorAggregates(input.creditorId)
  emitTableChange("creditor_investments")
  emitTableChange("transactions")
  return result.data.id as string
}

export async function recordCreditorRepayment(
  input: RecordCreditorRepaymentInput & { creditorId: string },
): Promise<string> {
  const { creditorId, ...rest } = input
  const result = throwIfActionError(await recordCreditorRepaymentAction(rest))
  await refetchCreditorAggregates(creditorId)
  emitTableChange("creditor_repayments")
  emitTableChange("transactions")
  return result.data.id as string
}

