"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getPortfolioReportAction,
  getPnlReportAction,
  getBalanceSheetReportAction,
  getRetainedEarningsReportAction,
  getCashflowReportAction,
  getTransactionReportDataAction,
} from "@/actions/report.actions"
import type {
  PortfolioEntry,
  PnlData,
  BalanceSheetData,
  RetainedEarningsData,
  CashflowData,
} from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { boundedSet } from "@/lib/bounded-map"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh reports when underlying data tables change via Electric
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.reports.portfolio,
  queryKeys.reports.pnl(),
  queryKeys.reports.balanceSheet(),
  queryKeys.reports.retainedEarnings(),
])
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.reports.portfolio,
  queryKeys.reports.pnl(),
  queryKeys.reports.balanceSheet(),
  queryKeys.reports.retainedEarnings(),
])
subscribeToTableChanges("transactions", getQueryClient(), [
  queryKeys.reports.transactions,
  queryKeys.reports.pnl(),
  queryKeys.reports.balanceSheet(),
  queryKeys.reports.cashflow(),
])

// --- Portfolio (no params) ---

export type PortfolioRow = PortfolioEntry & { _key: string }

export const portfolioCollection = createCollection(
  queryCollectionOptions<PortfolioRow>({
    queryKey: [...queryKeys.reports.portfolio],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<PortfolioRow>> => {
      const result = await getPortfolioReportAction()
      if ("error" in result) throw new Error(result.error)
      return (result.data as PortfolioEntry[]).map((entry, i) => ({
        ...entry,
        _key: `portfolio-${i}`,
      }))
    },
    getKey: (row) => row._key,
    startSync: true,
  })
)

// --- Transactions (no params) ---

export type TransactionReportData = {
  transactions: Array<{
    id: string
    type: string
    amount: string
    category: string
    description: string | null
    transactionDate: Date
    recordedBy: string
  }>
  categories: [string, string][]
}

export type TransactionReportRow = TransactionReportData & { _key: string }

export const transactionReportCollection = createCollection(
  queryCollectionOptions<TransactionReportRow>({
    queryKey: [...queryKeys.reports.transactions],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<TransactionReportRow>> => {
      const result = await getTransactionReportDataAction()
      if ("error" in result) throw new Error(result.error)
      return [{ ...(result.data as TransactionReportData), _key: "singleton" }]
    },
    getKey: (row) => row._key,
    startSync: true,
  })
)

// --- Parameterized reports: PnL, Balance Sheet, Retained Earnings ---
// These take a period string. We create factory functions that return collections
// keyed by the period so TanStack Query handles caching per period.

export type PnlRow = PnlData & { _key: string }

const MAX_REPORT_CACHED = 10

function createPnlCollection(period: string) {
  return createCollection(
    queryCollectionOptions<PnlRow>({
      queryKey: [...queryKeys.reports.pnl(period)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<PnlRow>> => {
        const result = await getPnlReportAction({ period })
        if ("error" in result) throw new Error(result.error)
        return [{ ...(result.data as PnlData), _key: "singleton" }]
      },
      getKey: (row) => row._key,
      // Eager sync: factory only runs when getPnlCollection is called for a
      // period the user actually opened, so this never fires for unused params.
      startSync: true,
    })
  )
}

type PnlCollectionType = ReturnType<typeof createPnlCollection>
const pnlCollections = new Map<string, PnlCollectionType>()

export function getPnlCollection(period: string) {
  let collection = pnlCollections.get(period)
  if (!collection) {
    collection = createPnlCollection(period)
    boundedSet(pnlCollections, period, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}

export type BalanceSheetRow = BalanceSheetData & { _key: string }

function createBalanceSheetCollection(period: string) {
  return createCollection(
    queryCollectionOptions<BalanceSheetRow>({
      queryKey: [...queryKeys.reports.balanceSheet(period)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<BalanceSheetRow>> => {
        const result = await getBalanceSheetReportAction({ period })
        if ("error" in result) throw new Error(result.error)
        return [{ ...(result.data as BalanceSheetData), _key: "singleton" }]
      },
      getKey: (row) => row._key,
      // Eager sync: see createPnlCollection for the reasoning.
      startSync: true,
    })
  )
}

type BalanceSheetCollectionType = ReturnType<typeof createBalanceSheetCollection>
const balanceSheetCollections = new Map<string, BalanceSheetCollectionType>()

export function getBalanceSheetCollection(period: string) {
  let collection = balanceSheetCollections.get(period)
  if (!collection) {
    collection = createBalanceSheetCollection(period)
    boundedSet(balanceSheetCollections, period, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}

export type RetainedEarningsRow = RetainedEarningsData & { _key: string }

function createRetainedEarningsCollection(period: string) {
  return createCollection(
    queryCollectionOptions<RetainedEarningsRow>({
      queryKey: [...queryKeys.reports.retainedEarnings(period)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<RetainedEarningsRow>> => {
        const result = await getRetainedEarningsReportAction({ period })
        if ("error" in result) throw new Error(result.error)
        return [{ ...(result.data as RetainedEarningsData), _key: "singleton" }]
      },
      getKey: (row) => row._key,
      // Eager sync: see createPnlCollection for the reasoning.
      startSync: true,
    })
  )
}

type RetainedEarningsCollectionType = ReturnType<typeof createRetainedEarningsCollection>
const retainedEarningsCollections = new Map<string, RetainedEarningsCollectionType>()

export function getRetainedEarningsCollection(period: string) {
  let collection = retainedEarningsCollections.get(period)
  if (!collection) {
    collection = createRetainedEarningsCollection(period)
    boundedSet(retainedEarningsCollections, period, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}

export type CashflowRow = CashflowData & { _key: string }

function createCashflowCollection(period: string) {
  return createCollection(
    queryCollectionOptions<CashflowRow>({
      queryKey: [...queryKeys.reports.cashflow(period)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<CashflowRow>> => {
        const result = await getCashflowReportAction({ period })
        if ("error" in result) throw new Error(result.error)
        return [{ ...(result.data as CashflowData), _key: "singleton" }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type CashflowCollectionType = ReturnType<typeof createCashflowCollection>
const cashflowCollections = new Map<string, CashflowCollectionType>()

export function getCashflowCollection(period: string) {
  let collection = cashflowCollections.get(period)
  if (!collection) {
    collection = createCashflowCollection(period)
    boundedSet(cashflowCollections, period, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}
