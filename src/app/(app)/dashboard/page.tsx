"use client"

import { Suspense } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { useDashboard } from "@/hooks/use-dashboard"
import { dashboardActivityCollection } from "@/collections/dashboard"
import dynamic from "next/dynamic"
import { DashboardOverview } from "@/components/dashboard/dashboard-overview"

const CollectionsChart = dynamic(
  () => import("@/components/dashboard/collections-chart").then((m) => m.CollectionsChart),
  { ssr: false }
)
const LoanDistributionChart = dynamic(
  () => import("@/components/dashboard/loan-distribution-chart").then((m) => m.LoanDistributionChart),
  { ssr: false }
)
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { usePermissions } from "@/hooks/use-permissions"
import type { Permission } from "@/types"

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
    <DashboardOverview
      kpis={kpis}
      isAdmin={isAdmin}
      has={has}
      activity={activity}
      activityReady={activityReady}
      charts={
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
      }
    />
  )
}
