"use client"

import { useId } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"

export interface CollectionChartPoint {
  date: string
  label: string
  total: number
}

function formatYAxis(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return String(value)
}

export function CollectionsChartView({ chartData, animate = true }: { chartData: CollectionChartPoint[]; animate?: boolean }) {
  const gradientId = useId()
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
                  id={gradientId}
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
                isAnimationActive={animate}
                type="monotone"
                dataKey="total"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
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
