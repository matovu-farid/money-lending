"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getSystemCapitalAction,
  getCreditorMonthlyInterestDueAction,
  getCreditorDashboardAction,
  getCreditorMonthlySummaryAction,
  getCreditorRepaymentPortionsAction,
} from "@/actions/creditor.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/table-events"
import { boundedSet } from "@/lib/bounded-map"
import type { CreditorDashboard, MonthlySummaryRow, PaymentPortionsMap } from "@/types"
import { throwIfActionError, coerceDates } from "./_utils"

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
      const { data } = throwIfActionError(await getSystemCapitalAction())
      return [{ ...data, _key: "singleton" }]
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

// --- Per-creditor dashboard (parameterized by creditorId) ---

export type CreditorDashboardRow = { _key: string; data: CreditorDashboard }

const MAX_CREDITOR_DASHBOARD_CACHED = 10

function createCreditorDashboardCollection(creditorId: string) {
  return createCollection(
    queryCollectionOptions<CreditorDashboardRow>({
      queryKey: [...queryKeys.creditors.dashboard(creditorId)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<CreditorDashboardRow>> => {
        const { data } = throwIfActionError(
          await getCreditorDashboardAction(creditorId),
        )
        return [
          {
            _key: "singleton",
            data: {
              ...data,
              investments: coerceDates(data.investments, ["investmentDate"]),
            },
          },
        ]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type CreditorDashboardCollectionType = ReturnType<typeof createCreditorDashboardCollection>
const creditorDashboardCollections = new Map<string, CreditorDashboardCollectionType>()

export function getCreditorDashboardCollection(creditorId: string) {
  let collection = creditorDashboardCollections.get(creditorId)
  if (!collection) {
    collection = createCreditorDashboardCollection(creditorId)
    boundedSet(creditorDashboardCollections, creditorId, collection, MAX_CREDITOR_DASHBOARD_CACHED, (c) => c.cleanup())
  }
  return collection
}

// --- Per-creditor monthly summary (parameterized by creditorId) ---

export type CreditorMonthlySummaryRow = { _key: string; data: MonthlySummaryRow[] }

function createCreditorMonthlySummaryCollection(creditorId: string) {
  return createCollection(
    queryCollectionOptions<CreditorMonthlySummaryRow>({
      queryKey: [...queryKeys.creditors.monthlySummary(creditorId)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<CreditorMonthlySummaryRow>> => {
        const { data } = throwIfActionError(
          await getCreditorMonthlySummaryAction(creditorId),
        )
        return [{ _key: "singleton", data }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type CreditorMonthlySummaryCollectionType = ReturnType<typeof createCreditorMonthlySummaryCollection>
const creditorMonthlySummaryCollections = new Map<string, CreditorMonthlySummaryCollectionType>()

export function getCreditorMonthlySummaryCollection(creditorId: string) {
  let collection = creditorMonthlySummaryCollections.get(creditorId)
  if (!collection) {
    collection = createCreditorMonthlySummaryCollection(creditorId)
    boundedSet(creditorMonthlySummaryCollections, creditorId, collection, MAX_CREDITOR_DASHBOARD_CACHED, (c) => c.cleanup())
  }
  return collection
}

// --- Repayment portions (parameterized by sorted repaymentIds key) ---

export type CreditorRepaymentPortionsRow = { _key: string; data: PaymentPortionsMap }

function createCreditorRepaymentPortionsCollection(repaymentIds: string[]) {
  const key = [...repaymentIds].sort().join(",")
  return createCollection(
    queryCollectionOptions<CreditorRepaymentPortionsRow>({
      queryKey: [...queryKeys.creditors.repaymentPortions(key)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<CreditorRepaymentPortionsRow>> => {
        const { data } = throwIfActionError(
          await getCreditorRepaymentPortionsAction(repaymentIds),
        )
        return [{ _key: "singleton", data }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type CreditorRepaymentPortionsCollectionType = ReturnType<typeof createCreditorRepaymentPortionsCollection>
const creditorRepaymentPortionsCollections = new Map<string, CreditorRepaymentPortionsCollectionType>()

const emptyCreditorRepaymentPortionsCollection = createCollection(
  queryCollectionOptions<CreditorRepaymentPortionsRow>({
    queryKey: [...queryKeys.creditors.repaymentPortions("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<CreditorRepaymentPortionsRow>> => [{ _key: "singleton", data: {} }],
    getKey: (row) => row._key,
  })
)

export function getCreditorRepaymentPortionsCollection(repaymentIds: string[]) {
  if (repaymentIds.length === 0) return emptyCreditorRepaymentPortionsCollection
  const key = [...repaymentIds].sort().join(",")
  let collection = creditorRepaymentPortionsCollections.get(key)
  if (!collection) {
    collection = createCreditorRepaymentPortionsCollection(repaymentIds)
    boundedSet(creditorRepaymentPortionsCollections, key, collection, MAX_CREDITOR_DASHBOARD_CACHED, (c) => c.cleanup())
  }
  return collection
}
