"use client"

import { useEffect, useState } from "react"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, CreditCard as PaymentIcon } from "lucide-react"
import { getDashboardAction } from "@/actions/dashboard.actions"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardKPIs, ActivityFeedItem } from "@/types"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

function relativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins} minutes ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} hours ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} days ago`
}

function activityIcon(type: ActivityFeedItem["type"]) {
  if (type === "loan_issued") return <Landmark className="h-4 w-4 text-muted-foreground shrink-0" />
  if (type === "overdue_flagged") return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
  return <PaymentIcon className="h-4 w-4 text-muted-foreground shrink-0" />
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [activity, setActivity] = useState<ActivityFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDashboardAction().then((result) => {
      if (result.error) {
        setError(result.error)
      } else if (result.data) {
        setKpis(result.data.kpis)
        setActivity(result.data.activity)
      }
      setLoading(false)
    })
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Portfolio health at a glance</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <KpiCard
          label="Loans Outstanding"
          value={loading ? "—" : formatUGX(kpis?.loansOutstanding ?? "0")}
          icon={Banknote}
        />
        <KpiCard
          label="Repayments Collected"
          value={loading ? "—" : formatUGX(kpis?.repaymentsCollected ?? "0")}
          icon={CreditCard}
        />
        <KpiCard
          label="Interest Earned"
          value={loading ? "—" : formatUGX(kpis?.interestEarned ?? "0")}
          icon={TrendingUp}
        />
        <KpiCard
          label="Active Borrowers"
          value={loading ? "—" : String(kpis?.activeBorrowers ?? 0)}
          icon={Users}
        />
        <KpiCard
          label="Overdue Count"
          value={loading ? "—" : String(kpis?.overdueCount ?? 0)}
          icon={AlertTriangle}
          valueClassName={kpis && kpis.overdueCount > 0 ? "text-destructive" : undefined}
        />
        <KpiCard
          label="Capital in System"
          value={loading ? "—" : formatUGX(kpis?.capitalInSystem ?? "0")}
          icon={Landmark}
          subtitle="Creditor data available in Phase 4"
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
              {activity.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-6 py-4 ${index < activity.length - 1 ? "border-b" : ""}`}
                >
                  {activityIcon(item.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {relativeTime(item.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
