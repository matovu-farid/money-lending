"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import {
  getWeeklyLoansCollection,
  getWeeklyPaymentsCollection,
} from "@/collections/weekly-reports"
import type {
  WeeklyLoansReportData,
  WeeklyPaymentsReportData,
} from "@/types/weekly-report"

export function useWeeklyPaymentsReport(week: string) {
  const collection = getWeeklyPaymentsCollection(week)
  const { data } = useLiveQuery(
    (q) => q.from({ r: collection }).select(({ r }) => r),
    [week],
  )
  const row = data?.[0]
  const retry = () => getQueryClient().invalidateQueries({ queryKey: queryKeys.reports.weeklyPayments(week) })
  if (!row || row.week !== week) return { data: undefined, isLoading: true, error: undefined, retry }
  if (row._error) return { data: undefined, isLoading: false, error: row._error, retry }
  const { _key, _error, ...report } = row
  return { data: report satisfies WeeklyPaymentsReportData, isLoading: false, error: undefined, retry }
}

export function useWeeklyLoansReport(week: string) {
  const collection = getWeeklyLoansCollection(week)
  const { data } = useLiveQuery(
    (q) => q.from({ r: collection }).select(({ r }) => r),
    [week],
  )
  const row = data?.[0]
  const retry = () => getQueryClient().invalidateQueries({ queryKey: queryKeys.reports.weeklyLoans(week) })
  if (!row || row.week !== week) return { data: undefined, isLoading: true, error: undefined, retry }
  if (row._error) return { data: undefined, isLoading: false, error: row._error, retry }
  const { _key, _error, ...report } = row
  return { data: report satisfies WeeklyLoansReportData, isLoading: false, error: undefined, retry }
}
