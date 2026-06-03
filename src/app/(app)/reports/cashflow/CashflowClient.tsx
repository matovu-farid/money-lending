"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportToolbar } from "@/components/reports/report-toolbar"
import { useCashflowReport } from "@/hooks/use-reports"
import { formatCurrency } from "@/lib/utils"
import type { CashflowData } from "@/types"

interface Props {
  period: string
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-UG", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function CashflowClient({ period }: Props) {
  const { data } = useCashflowReport(period)

  const cf: CashflowData = data ?? {
    period,
    months: [],
    inflowsByType: [],
    outflowsByType: [],
    totalInflows: "0",
    totalOutflows: "0",
    totalNet: "0",
  }

  const monthsDesc = [...cf.months].reverse()
  const hasAny = cf.months.some((m) => m.inflows !== "0" || m.outflows !== "0")
  const net = parseFloat(cf.totalNet)

  return (
    <div className="space-y-4" data-testid="cashflow-report">
      <ReportToolbar period={period} basePath="/reports/cashflow" />

      {!hasAny ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No operating cash movement recorded in the last 12 months.
          Capital injections, fund transfers, and interest accruals are
          excluded from this report.
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <SummaryCell label="Total Inflows" value={cf.totalInflows} tone="positive" />
                <SummaryCell label="Total Outflows" value={cf.totalOutflows} tone="negative" />
                <SummaryCell
                  label="Net"
                  value={cf.totalNet}
                  tone={net >= 0 ? "positive" : "negative"}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-semibold">Month</th>
                      <th className="py-2 text-right font-semibold">Inflows</th>
                      <th className="py-2 text-right font-semibold">Outflows</th>
                      <th className="py-2 text-right font-semibold">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthsDesc.map((m) => {
                      const isAnchor = m.month === cf.period
                      const monthNet = parseFloat(m.net)
                      return (
                        <tr
                          key={m.month}
                          data-testid="data-row"
                          className={isAnchor ? "bg-muted/40 font-medium" : ""}
                        >
                          <td className="py-1.5">{formatMonthLabel(m.month)}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {formatCurrency(m.inflows)}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {formatCurrency(m.outflows)}
                          </td>
                          <td
                            className={`py-1.5 text-right font-mono tabular-nums ${
                              monthNet >= 0
                                ? "text-green-700 dark:text-green-400"
                                : "text-destructive"
                            }`}
                          >
                            {formatCurrency(m.net)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-6">
              <div>
                <p className="text-base font-semibold mb-2">
                  Inflows for {formatMonthLabel(cf.period)}
                </p>
                <BreakdownTable rows={cf.inflowsByType} empty="No inflows this month." />
              </div>
              <div>
                <p className="text-base font-semibold mb-2">
                  Outflows for {formatMonthLabel(cf.period)}
                </p>
                <BreakdownTable rows={cf.outflowsByType} empty="No outflows this month." />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-2xl font-semibold tabular-nums mt-1 ${
          tone === "positive"
            ? "text-green-700 dark:text-green-400"
            : "text-destructive"
        }`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  )
}

function BreakdownTable({ rows, empty }: { rows: { label: string; amount: string }[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} data-testid="breakdown-row">
            <td className="py-1 pl-2">{r.label}</td>
            <td className="py-1 text-right font-mono tabular-nums">
              {formatCurrency(r.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
