"use client"

import { useMemo } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useLiveQuery } from "@tanstack/react-db"
import { paymentCollection } from "@/collections/payments"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"

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

function formatYAxis(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return String(value)
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

  const hasData = chartData.some((d) => d.total > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          Daily Collections
          <span className="text-sm font-normal text-muted-foreground ml-2">
            Last 30 days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
            No collection data for the last 30 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient
                  id="collectionsGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="var(--color-chart-1)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-chart-1)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                stroke="var(--color-muted-foreground)"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                stroke="var(--color-muted-foreground)"
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const value = payload[0].value as number
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p className="text-sm font-semibold font-mono tabular-nums">
                        {formatCurrency(String(value))}
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                fill="url(#collectionsGradient)"
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: "var(--color-chart-1)",
                  strokeWidth: 2,
                  fill: "var(--color-background)",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
