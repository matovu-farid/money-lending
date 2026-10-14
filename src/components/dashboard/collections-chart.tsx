"use client"

import { useMemo } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { paymentCollection } from "@/collections/payments"
import { CollectionsChartView } from "./collections-chart-view"

/** Aggregate payments into daily totals for the last 30 days. */
function aggregateDailyCollections(
  payments: Array<{ paymentDate: Date; amount: string }>
) {
  const now = new Date()
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
  thirtyDaysAgo.setHours(0, 0, 0, 0)

  // Build a map of date string -> total amount
  const dailyMap = new Map<string, number>()

  // Initialize all 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    dailyMap.set(key, 0)
  }

  // Sum payments into daily buckets
  for (const p of payments) {
    const date = new Date(p.paymentDate)
    const key = date.toISOString().slice(0, 10)
    if (dailyMap.has(key)) {
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(p.amount))
    }
  }

  // Convert to sorted array
  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({
      date,
      label: formatDateLabel(date),
      total,
    }))
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function CollectionsChart() {
  const { data: payments } = useLiveQuery((q) =>
    q
      .from({ p: paymentCollection })
      .select(({ p }) => ({
        paymentDate: p.paymentDate,
        amount: p.amount,
      }))
  )

  const chartData = useMemo(
    () => aggregateDailyCollections((payments ?? []) as unknown as Array<{ paymentDate: Date; amount: string }>),
    [payments]
  )

  return <CollectionsChartView chartData={chartData} />
}
