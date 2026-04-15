"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import {
  portfolioCollection,
  transactionReportCollection,
  getPnlCollection,
  getBalanceSheetCollection,
  getRetainedEarningsCollection,
} from "@/collections"
import type {
  PortfolioEntry,
  PnlData,
  BalanceSheetData,
  RetainedEarningsData,
} from "@/types"

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

export function usePortfolioReport() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ r: portfolioCollection }).select(({ r }) => r)
  )
  const rows = data ?? []
  // Strip _key from rows to return PortfolioEntry[]
  const entries: PortfolioEntry[] = rows.map(({ _key, ...rest }) => rest)
  return { data: entries }
}

export function usePnlReport(period: string) {
  const collection = getPnlCollection(period)
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ r: collection }).select(({ r }) => r),
    [period]
  )
  const row = data?.[0]
  const pnlData: PnlData | undefined = row ? { ...row, _key: undefined } as unknown as PnlData : undefined
  return { data: pnlData }
}

export function useBalanceSheetReport(period: string) {
  const collection = getBalanceSheetCollection(period)
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ r: collection }).select(({ r }) => r),
    [period]
  )
  const row = data?.[0]
  const bsData: BalanceSheetData | undefined = row ? { ...row, _key: undefined } as unknown as BalanceSheetData : undefined
  return { data: bsData }
}

export function useRetainedEarningsReport(period: string) {
  const collection = getRetainedEarningsCollection(period)
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ r: collection }).select(({ r }) => r),
    [period]
  )
  const row = data?.[0]
  const reData: RetainedEarningsData | undefined = row ? { ...row, _key: undefined } as unknown as RetainedEarningsData : undefined
  return { data: reData }
}

export function useTransactionReportData() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ r: transactionReportCollection }).select(({ r }) => r)
  )
  const row = data?.[0]
  const txData: TransactionReportData | undefined = row
    ? { transactions: row.transactions, categories: row.categories }
    : undefined
  return { data: txData }
}
