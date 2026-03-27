"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, CreditCard as PaymentIcon, ChevronDown, ChevronUp } from "lucide-react"
import { getDashboardAction } from "@/actions/dashboard.actions"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardKPIs, ActivityFeedItem } from "@/types"
import { formatDate, formatCurrency, formatRelativeTime } from "@/lib/utils"

function activityIcon(type: ActivityFeedItem["type"]) {
  if (type === "loan_issued") return <Landmark className="h-4 w-4 text-muted-foreground shrink-0" />
  if (type === "overdue_flagged") return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
  return <PaymentIcon className="h-4 w-4 text-muted-foreground shrink-0" />
}

const DETAIL_LABELS: Record<string, string> = {
  amount: "Amount",
  interestRate: "Interest Rate",
  startDate: "Start Date",
  customerName: "Customer",
  collateral: "Collateral",
  paymentDate: "Payment Date",
  interestPortion: "Interest Portion",
  principalPortion: "Principal Portion",
}

function formatDetailValue(key: string, value: string | number | null | undefined): string {
  if (value == null) return "—"
  const str = String(value)
  if (["amount", "interestPortion", "principalPortion"].includes(key)) {
    const num = parseFloat(str)
    if (!isNaN(num)) return formatCurrency(num)
  }
  if (key === "interestRate") {
    const num = parseFloat(str)
    if (!isNaN(num)) return `${(num * 100).toFixed(0)}% / month`
  }
  if (key === "startDate" || key === "paymentDate") {
    return formatDate(str)
  }
  return str
}

export default function DashboardPage() {
  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const result = await getDashboardAction()
      if (result.error) throw new Error(result.error)
      return result.data!
    },
  })
  const kpis = data?.kpis ?? null
  const activity = data?.activity ?? []
  const error = queryError?.message ?? null
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Portfolio health at a glance</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <KpiCard
          label="Loans Outstanding"
          value={formatCurrency(kpis?.loansOutstanding ?? "0")}
          icon={Banknote}
          loading={loading}
        />
        <KpiCard
          label="Repayments Collected"
          value={formatCurrency(kpis?.repaymentsCollected ?? "0")}
          icon={CreditCard}
          loading={loading}
        />
        <KpiCard
          label="Interest Earned"
          value={formatCurrency(kpis?.interestEarned ?? "0")}
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          label="Active Borrowers"
          value={String(kpis?.activeBorrowers ?? 0)}
          icon={Users}
          loading={loading}
        />
        <KpiCard
          label="Overdue Count"
          value={String(kpis?.overdueCount ?? 0)}
          icon={AlertTriangle}
          valueClassName={kpis && kpis.overdueCount > 0 ? "text-destructive" : undefined}
          loading={loading}
        />
        <KpiCard
          label="Capital in System"
          value={formatCurrency(kpis?.capitalInSystem ?? "0")}
          icon={Landmark}
          loading={loading}
        />
      </div>

      {/* Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-0">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-4 border-b">
                  <div className="h-4 w-4 rounded bg-muted-foreground/10 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-48 rounded bg-muted-foreground/10 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted-foreground/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 px-6">
              No recent activity yet.
            </p>
          ) : (
            <div>
              {activity.map((item, index) => {
                const isExpanded = expandedId === item.id
                const hasDetail = item.detail && Object.keys(item.detail).length > 0
                return (
                  <div
                    key={item.id}
                    className={index < activity.length - 1 ? "border-b" : ""}
                  >
                    <button
                      type="button"
                      className={`flex items-start gap-3 px-6 py-4 w-full text-left ${hasDetail ? "cursor-pointer hover:bg-muted/50 transition-colors" : "cursor-default"}`}
                      onClick={() => hasDetail && setExpandedId(isExpanded ? null : item.id)}
                      data-testid={`activity-item-${item.id}`}
                    >
                      {activityIcon(item.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{item.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {formatRelativeTime(item.timestamp)}
                        </p>
                      </div>
                      {hasDetail && (
                        isExpanded
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                    </button>
                    {isExpanded && item.detail && (
                      <div className="px-6 pb-4 pl-13" data-testid={`activity-detail-${item.id}`}>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm ml-7">
                          {Object.entries(item.detail).map(([key, value]) => {
                            const label = DETAIL_LABELS[key]
                            if (!label || value == null) return null
                            return (
                              <div key={key} className="contents">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className={["amount", "interestPortion", "principalPortion", "interestRate"].includes(key) ? "font-mono tabular-nums" : undefined}>{formatDetailValue(key, value)}</dd>
                              </div>
                            )
                          })}
                        </dl>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
