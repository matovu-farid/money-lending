"use client"

import { useQuery } from "@tanstack/react-query"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, ExternalLink } from "lucide-react"
import Link from "next/link"
import { useSession } from "@/lib/auth-client"
import { useDashboard } from "@/hooks/use-dashboard"
import { getDashboardActivityAction } from "@/actions/dashboard.actions"
import { queryKeys } from "@/hooks/query-keys"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { usePermissions } from "@/hooks/use-permissions"
import { formatCurrency, formatRelativeTime } from "@/lib/utils"

export default function DashboardPage() {
  const { data: session } = useSession()
  const { has } = usePermissions()
  const isAdmin = has("settings:read")

  const { data, isLoading: loading, error: queryError } = useDashboard()
  const kpis = data?.kpis ?? null
  const error = queryError?.message ?? null

  const {
    data: activityData,
    isLoading: activityLoading,
  } = useQuery({
    queryKey: queryKeys.dashboard.activity(),
    queryFn: async () => {
      const result = await getDashboardActivityAction() as { data: { items: any[]; total: number } } | { error: string }
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const activity = activityData?.items ?? []

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="Portfolio health at a glance" />

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
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Loans Outstanding</p>
              <p className="text-xs text-muted-foreground mb-2">
                Total principal still owed across all active loans. This is the remaining balance after subtracting the principal portions of all payments made.
              </p>
              <p className="text-xs text-muted-foreground">
                Does not include accrued interest — only the unpaid principal.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Active Borrowers"
          value={String(kpis?.activeBorrowers ?? 0)}
          icon={Users}
          loading={loading}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Active Borrowers</p>
              <p className="text-xs text-muted-foreground mb-2">
                Number of unique customers who have at least one active (not fully paid) loan.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Overdue Count"
          value={String(kpis?.overdueCount ?? 0)}
          icon={AlertTriangle}
          valueClassName={kpis && kpis.overdueCount > 0 ? "text-destructive" : undefined}
          loading={loading}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Overdue Count</p>
              <p className="text-xs text-muted-foreground mb-2">
                Number of active loans where unpaid interest exceeds 30 days worth. A loan is overdue when the borrower has not paid enough interest to cover the time elapsed.
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                Days overdue = Unpaid Interest ÷ Daily Interest Amount
              </p>
              <p className="text-xs text-muted-foreground">
                Flagged when days overdue reaches 30 or more.
              </p>
            </InfoPopover>
          }
        />
        {isAdmin && (
          <>
            <KpiCard
              label="Repayments Collected"
              value={formatCurrency(kpis?.repaymentsCollected ?? "0")}
              icon={CreditCard}
              loading={loading}
              labelExtra={
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Repayments Collected</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Total amount of all payments received across all loans (both interest and principal portions combined).
                  </p>
                </InfoPopover>
              }
            />
            <KpiCard
              label="Interest Earned"
              value={formatCurrency(kpis?.interestEarned ?? "0")}
              icon={TrendingUp}
              loading={loading}
              labelExtra={
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Interest Earned</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Total interest portions collected from all payments. When a borrower pays, interest is deducted first before any principal reduction.
                  </p>
                  <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                    Interest = Principal × (Monthly Rate ÷ 30) × Days
                  </p>
                </InfoPopover>
              }
            />
            <KpiCard
              label="Cash Available"
              value={formatCurrency(kpis?.capitalInSystem ?? "0")}
              icon={Landmark}
              loading={loading}
              labelExtra={
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Cash Available</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Total cash balance across all locations (cash on hand, bank, and strong room). This is the money available for new loan disbursements.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Increases when payments are received and decreases when loans are disbursed or expenses are recorded.
                  </p>
                </InfoPopover>
              }
            />
          </>
        )}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-semibold">Recent Activity</CardTitle>
          {has("activity:read") && (
            <Link href="/activities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {activityLoading ? (
            <div className="space-y-0">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-4 border-b last:border-b-0">
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-48 rounded bg-muted-foreground/10 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted-foreground/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 px-6">
              No recent activity
            </p>
          ) : (
            <div>
              {activity.map((item: any, index: number) => {
                const href = "href" in item ? item.href : item.loanId ? `/loans/${item.loanId}` : null
                const description = item.description ?? ""
                const actorName = item.actorName ?? undefined
                const timestamp = item.occurredAt ?? item.timestamp
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-6 py-4 ${index < activity.length - 1 ? "border-b" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm">{description}</p>
                        {href && (
                          <Link
                            href={href}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            title="View details"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground font-mono">
                          {formatRelativeTime(timestamp)}
                        </p>
                        {actorName && (
                          <span className="text-xs text-muted-foreground">
                            · by {actorName}
                          </span>
                        )}
                      </div>
                    </div>
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
