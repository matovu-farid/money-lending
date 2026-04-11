"use client"

import { useEffect, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, CreditCard as PaymentIcon, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { useDashboard } from "@/hooks/use-dashboard"
import { getRecentActivityAction } from "@/actions/dashboard.actions"
import { queryKeys } from "@/hooks/query-keys"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import type { ActivityFeedItem } from "@/types"
import { formatDate, formatCurrency, formatRelativeTime } from "@/lib/utils"

const PAGE_SIZE = 5

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
  const { data, isLoading: loading, error: queryError } = useDashboard()
  const kpis = data?.kpis ?? null
  const error = queryError?.message ?? null
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const {
    data: activityData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: activityLoading,
  } = useInfiniteQuery({
    queryKey: queryKeys.dashboard.activity(),
    queryFn: async ({ pageParam }) => {
      const result = await getRecentActivityAction(pageParam, PAGE_SIZE)
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE
      return fetched < lastPage.total ? allPages.length + 1 : undefined
    },
  })

  const activity = activityData?.pages.flatMap((p) => p.items) ?? []

  // Intersection observer for infinite scroll + eager prefetch
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: "100px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

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
      </div>

      {/* Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0 max-h-[420px] overflow-y-auto">
          {activityLoading ? (
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
                                <dd className={["amount", "interestPortion", "principalPortion", "interestRate"].includes(key) ? "font-mono tabular-nums" : undefined}>{formatDetailValue(key, value as string | number | null | undefined)}</dd>
                              </div>
                            )
                          })}
                        </dl>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Sentinel for infinite scroll — triggers fetch 200px before visible */}
              <div ref={sentinelRef} className="h-1" />

              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {!hasNextPage && activity.length > 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  No more activity
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
