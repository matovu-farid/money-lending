"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getSystemCapitalAction, getCreditorMonthlyInterestDueAction } from "@/actions/creditor.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh capital totals and monthly due when creditor tables change via Electric
subscribeToTableChanges("creditor_investments", getQueryClient(), [
  queryKeys.creditors.capital,
  queryKeys.creditors.monthlyDue,
])
subscribeToTableChanges("creditor_repayments", getQueryClient(), [
  queryKeys.creditors.capital,
  queryKeys.creditors.monthlyDue,
])

// --- System capital (singleton) ---

export type SystemCapitalRow = {
  _key: string
  totalInvested: string
  totalInterestAccrued: string
  totalRepaymentsMade: string
  totalOutstanding: string
}

export const systemCapitalCollection = createCollection(
  queryCollectionOptions<SystemCapitalRow>({
    queryKey: [...queryKeys.creditors.capital],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<SystemCapitalRow>> => {
      const result = await getSystemCapitalAction()
      if ("error" in result) throw new Error(result.error)
      return [{ ...result.data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
  })
)

// --- Monthly interest due (singleton map) ---

export type MonthlyDueRow = { _key: string; data: Record<string, string> }

export const creditorMonthlyDueCollection = createCollection(
  queryCollectionOptions<MonthlyDueRow>({
    queryKey: [...queryKeys.creditors.monthlyDue],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<MonthlyDueRow>> => {
      const result = await getCreditorMonthlyInterestDueAction()
      if ("error" in result) throw new Error(result.error)
      return [{ _key: "singleton", data: result.data }]
    },
    getKey: (row) => row._key,
  })
)
