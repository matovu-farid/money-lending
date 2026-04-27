"use client"

import { Suspense } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, ExternalLink, Plus, DollarSign } from "lucide-react"
import Link from "next/link"
import { useDashboard } from "@/hooks/use-dashboard"
import { dashboardActivityCollection } from "@/collections/dashboard"
import dynamic from "next/dynamic"
import { KpiCard } from "@/components/dashboard/kpi-card"

const CollectionsChart = dynamic(
  () => import("@/components/dashboard/collections-chart").then((m) => m.CollectionsChart),
  { ssr: false }
)
const LoanDistributionChart = dynamic(
  () => import("@/components/dashboard/loan-distribution-chart").then((m) => m.LoanDistributionChart),
  { ssr: false }
)
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { usePermissions } from "@/hooks/use-permissions"
import type { Permission } from "@/types"
import { formatCurrency, formatRelativeTime } from "@/lib/utils"

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="h-7 w-36 rounded-md bg-muted-foreground/10 animate-pulse" />
        <div className="h-4 w-64 rounded-md bg-muted-foreground/10 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted-foreground/10 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

export default function DashboardPage() {
  const { has, isLoading: permissionsLoading } = usePermissions()
  const isAdmin = has("settings:read")

  if (permissionsLoading) {
    return <LoadingSkeleton />
  }

  return <DashboardContent has={has} isAdmin={isAdmin} />
}

function DashboardContent({ has, isAdmin }: { has: (permission: Permission) => boolean; isAdmin: boolean }) {
  const { data, isLoading: dashboardLoading } = useDashboard()
  const kpis = data?.kpis ?? null

  const { data: activityRows, isLoading: activityLoading } = useLiveQuery((q) =>
    q.from({ a: dashboardActivityCollection }).select(({ a }) => a)
  )

  const activity = activityRows?.[0]?.items ?? []
  const activityReady = !activityLoading && activityRows !== undefined

  if (dashboardLoading && !kpis) {
    return <LoadingSkeleton />
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="Portfolio health at a glance" />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <KpiCard
          label="Loans Outstanding"
          value={formatCurrency(kpis?.loansOutstanding ?? "0")}
          icon={Banknote}
          loading={false}
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
          loading={false}
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
          loading={false}
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
              loading={false}
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
              loading={false}
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
              loading={false}
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

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          href="/payments"
          className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center hover:bg-muted transition-colors"
        >
          <DollarSign className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Record Payment</span>
        </Link>
        <Link
          href="/customers/new"
          className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center hover:bg-muted transition-colors"
        >
          <Users className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">New Customer</span>
        </Link>
        <Link
          href="/loans/new"
          className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center hover:bg-muted transition-colors"
        >
          <Plus className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">New Loan</span>
        </Link>
        <Link
          href="/loans?filter=overdue"
          className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center hover:bg-muted transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <span className="text-sm font-medium">View Overdue</span>
        </Link>
      </div>

      {/* Charts */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Suspense
            fallback={
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl font-semibold">Daily Collections</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px] rounded bg-muted-foreground/10 animate-pulse" />
                </CardContent>
              </Card>
            }
          >
            <CollectionsChart />
          </Suspense>
          <Suspense
            fallback={
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl font-semibold">Loan Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px] rounded bg-muted-foreground/10 animate-pulse" />
                </CardContent>
              </Card>
            }
          >
            <LoanDistributionChart />
          </Suspense>
        </div>
      )}

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
          {!activityReady ? (
            <div className="px-6 py-4 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-muted-foreground/10 animate-pulse" />
                    <div className="h-3 w-1/3 rounded bg-muted-foreground/10 animate-pulse" />
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
