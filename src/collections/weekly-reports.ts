"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getWeeklyLoansReportAction,
  getWeeklyPaymentsReportAction,
} from "@/actions/report.actions"
import type {
  WeeklyLoansReportData,
  WeeklyPaymentsReportData,
} from "@/types/weekly-report"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { boundedSet } from "@/lib/bounded-map"
import { subscribeToTableChanges } from "@/lib/table-events"
import { throwIfActionError } from "./_utils"

// Keep weekly collection initialization independent of unrelated report
// collections, which start syncing immediately when their module is loaded.
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.reports.weeklyPayments(),
  queryKeys.reports.weeklyLoans(),
])
subscribeToTableChanges("customers", getQueryClient(), [
  queryKeys.reports.weeklyPayments(),
  queryKeys.reports.weeklyLoans(),
])
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.reports.weeklyPayments(),
])

export type WeeklyPaymentsReportRow = WeeklyPaymentsReportData & {
  _key: string
  _error?: string
}
export type WeeklyLoansReportRow = WeeklyLoansReportData & {
  _key: string
  _error?: string
}

const MAX_REPORT_CACHED = 10

function createWeeklyPaymentsCollection(week: string) {
  return createCollection(queryCollectionOptions<WeeklyPaymentsReportRow>({
    queryKey: [...queryKeys.reports.weeklyPayments(week)],
    queryClient: getQueryClient(),
    queryFn: async () => {
      try {
        const result = throwIfActionError(await getWeeklyPaymentsReportAction({ week }))
        return [{ ...(result.data as WeeklyPaymentsReportData), _key: "singleton" }]
      } catch {
        return [{ week, calculatedAt: new Date(0).toISOString(), count: 0, total: "0.00", rows: [], _key: "singleton", _error: "Could not load weekly payments" }]
      }
    },
    getKey: (row) => row._key,
    startSync: true,
  }))
}

function createWeeklyLoansCollection(week: string) {
  return createCollection(queryCollectionOptions<WeeklyLoansReportRow>({
    queryKey: [...queryKeys.reports.weeklyLoans(week)],
    queryClient: getQueryClient(),
    queryFn: async () => {
      try {
        const result = throwIfActionError(await getWeeklyLoansReportAction({ week }))
        return [{ ...(result.data as WeeklyLoansReportData), _key: "singleton" }]
      } catch {
        return [{ week, calculatedAt: new Date(0).toISOString(), count: 0, total: "0.00", rows: [], _key: "singleton", _error: "Could not load weekly loans" }]
      }
    },
    getKey: (row) => row._key,
    startSync: true,
  }))
}

type WeeklyPaymentsCollection = ReturnType<typeof createWeeklyPaymentsCollection>
type WeeklyLoansCollection = ReturnType<typeof createWeeklyLoansCollection>
const weeklyPaymentsCollections = new Map<string, WeeklyPaymentsCollection>()
const weeklyLoansCollections = new Map<string, WeeklyLoansCollection>()

export function getWeeklyPaymentsCollection(week: string) {
  let collection = weeklyPaymentsCollections.get(week)
  if (!collection) {
    collection = createWeeklyPaymentsCollection(week)
    boundedSet(weeklyPaymentsCollections, week, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}

export function getWeeklyLoansCollection(week: string) {
  let collection = weeklyLoansCollections.get(week)
  if (!collection) {
    collection = createWeeklyLoansCollection(week)
    boundedSet(weeklyLoansCollections, week, collection, MAX_REPORT_CACHED, (c) => c.cleanup())
  }
  return collection
}
