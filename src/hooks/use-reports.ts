"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
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

const REPORT_STALE_TIME = 60_000

export function usePortfolioReport() {
  return useQuery<PortfolioEntry[]>({
    queryKey: queryKeys.reports.portfolio(),
    queryFn: async () => {
      const result = await getPortfolioReportAction()
      return unwrapAction<PortfolioEntry[]>(result)
    },
    staleTime: REPORT_STALE_TIME,
  })
}

export function usePnlReport(period: string) {
  return useQuery<PnlData>({
    queryKey: queryKeys.reports.pnl(period),
    queryFn: async () => {
      const result = await getPnlReportAction({ period })
      return unwrapAction<PnlData>(result)
    },
    staleTime: REPORT_STALE_TIME,
  })
}

export function useBalanceSheetReport(period: string) {
  return useQuery<BalanceSheetData>({
    queryKey: queryKeys.reports.balanceSheet(period),
    queryFn: async () => {
      const result = await getBalanceSheetReportAction({ period })
      return unwrapAction<BalanceSheetData>(result)
    },
    staleTime: REPORT_STALE_TIME,
  })
}

export function useRetainedEarningsReport(period: string) {
  return useQuery<RetainedEarningsData>({
    queryKey: queryKeys.reports.retainedEarnings(period),
    queryFn: async () => {
      const result = await getRetainedEarningsReportAction({ period })
      return unwrapAction<RetainedEarningsData>(result)
    },
    staleTime: REPORT_STALE_TIME,
  })
}

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

export function useTransactionReportData() {
  return useQuery<TransactionReportData>({
    queryKey: queryKeys.reports.transactions(),
    queryFn: async () => {
      const result = await getTransactionReportDataAction()
      return unwrapAction<TransactionReportData>(result)
    },
    staleTime: REPORT_STALE_TIME,
  })
}
