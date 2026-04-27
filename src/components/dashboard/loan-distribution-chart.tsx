"use client"

import { useMemo } from "react"
import { PieChart, Pie, ResponsiveContainer, Tooltip } from "recharts"
import { useLiveQuery } from "@tanstack/react-db"
import { loanStatusCountsCollection } from "@/collections/loan-status-counts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { LoanStatus } from "@/types"

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  active: { label: "Active", color: "var(--color-chart-1)" },
  fully_paid: { label: "Fully Paid", color: "var(--color-chart-2)" },
  pending: { label: "Pending", color: "var(--color-chart-3)" },
  settled_with_collateral: {
    label: "Settled",
    color: "var(--color-chart-4)",
  },
  rolled_over: { label: "Rolled Over", color: "var(--color-chart-5)" },
}

function computeDistribution(
  counts: Record<LoanStatus, number>
): Array<{ name: string; value: number; fill: string; key: string }> {
  return (Object.entries(counts) as Array<[LoanStatus, number]>)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => {
      const config = STATUS_CONFIG[status] ?? {
        label: status,
        color: "var(--color-muted-foreground)",
      }
      return { name: config.label, value: count, fill: config.color, key: status }
    })
    .sort((a, b) => b.value - a.value)
}

export function LoanDistributionChart() {
  const { data: rows } = useLiveQuery((q) =>
    q
      .from({ r: loanStatusCountsCollection })
      .select(({ r }) => ({
        counts: r.counts,
      }))
  )

  const distribution = useMemo(() => {
    const counts = (rows?.[0]?.counts ?? {
      pending: 0,
      active: 0,
      fully_paid: 0,
      settled_with_collateral: 0,
      rolled_over: 0,
    }) as Record<LoanStatus, number>
    return computeDistribution(counts)
  }, [rows])
  const total = useMemo(
    () => distribution.reduce((sum, d) => sum + d.value, 0),
    [distribution]
  )

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            Loan Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
            No loans to display
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          Loan Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-8">
          {/* Donut chart */}
          <div className="relative flex-shrink-0">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as {
                      name: string
                      value: number
                    }
                    const pct = ((d.value / total) * 100).toFixed(1)
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                        <p className="text-xs text-muted-foreground mb-0.5">
                          {d.name}
                        </p>
                        <p className="text-sm font-semibold font-mono tabular-nums">
                          {d.value} loan{d.value !== 1 ? "s" : ""}{" "}
                          <span className="text-muted-foreground font-normal">
                            ({pct}%)
                          </span>
                        </p>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-semibold font-mono tabular-nums">
                {total}
              </span>
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-2.5 min-w-0">
            {distribution.map((entry) => {
              const pct = ((entry.value / total) * 100).toFixed(1)
              return (
                <div key={entry.key} className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="text-sm text-muted-foreground truncate">
                    {entry.name}
                  </span>
                  <span className="text-sm font-mono tabular-nums ml-auto">
                    {entry.value}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums w-12 text-right">
                    {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
