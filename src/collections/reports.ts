"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getPortfolioReportAction,
  getPnlReportAction,
  getBalanceSheetReportAction,
  getRetainedEarningsReportAction,
  getTransactionReportDataAction,
} from "@/actions/report.actions"
import type {
  PortfolioEntry,
  PnlData,
  BalanceSheetData,
  RetainedEarningsData,
} from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { boundedSet } from "@/lib/bounded-map"

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
  })
)

// --- Transactions (no params) ---

export type TransactionReportData = {
  transactions: Array<{
    id: string
    type: string
    amount: string
    categoryName: string
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
    })
  )
}

type PnlCollectionType = ReturnType<typeof createPnlCollection>
const pnlCollections = new Map<string, PnlCollectionType>()

export function getPnlCollection(period: string) {
  let collection = pnlCollections.get(period)
  if (!collection) {
    collection = createPnlCollection(period)
    boundedSet(pnlCollections, period, collection, MAX_REPORT_CACHED)
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
    })
  )
}

type BalanceSheetCollectionType = ReturnType<typeof createBalanceSheetCollection>
const balanceSheetCollections = new Map<string, BalanceSheetCollectionType>()

export function getBalanceSheetCollection(period: string) {
  let collection = balanceSheetCollections.get(period)
  if (!collection) {
    collection = createBalanceSheetCollection(period)
    boundedSet(balanceSheetCollections, period, collection, MAX_REPORT_CACHED)
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
    })
  )
}

type RetainedEarningsCollectionType = ReturnType<typeof createRetainedEarningsCollection>
const retainedEarningsCollections = new Map<string, RetainedEarningsCollectionType>()

export function getRetainedEarningsCollection(period: string) {
  let collection = retainedEarningsCollections.get(period)
  if (!collection) {
    collection = createRetainedEarningsCollection(period)
    boundedSet(retainedEarningsCollections, period, collection, MAX_REPORT_CACHED)
  }
  return collection
}
