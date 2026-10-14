"use client"

import dynamic from "next/dynamic"
import { useRef, useState, useSyncExternalStore } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { formatDistance } from "date-fns"
import { DashboardOverview } from "@/components/dashboard/dashboard-overview"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { previewKpis, previewLoanCounts, previewCollections, previewActivity } from "./dashboard-preview-data"

const EXAMPLE_TIME = new Date("2026-09-30T10:00:00Z")
const subscribeToHydration = () => () => {}
const clientReady = () => true
const serverReady = () => false
const formatExampleActivityTime = (date: Date | string) =>
  formatDistance(new Date(date), EXAMPLE_TIME, { addSuffix: true })

function ChartPlaceholder({ title }: { title: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><p className="h-[260px] text-sm text-muted-foreground">Loading example chart…</p></CardContent></Card>
}

const CollectionsChart = dynamic(
  () => import("@/components/dashboard/collections-chart-view").then((module) => module.CollectionsChartView),
  { ssr: false, loading: () => <ChartPlaceholder title="Daily Collections" /> },
)
const LoanDistributionChart = dynamic(
  () => import("@/components/dashboard/loan-distribution-chart-view").then((module) => module.LoanDistributionChartView),
  { ssr: false, loading: () => <ChartPlaceholder title="Loan Distribution" /> },
)

export function DashboardPreview() {
  const [expanded, setExpanded] = useState(false)
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady)
  const frameRef = useRef<HTMLElement>(null)
  const ExpandIcon = expanded ? ChevronUp : ChevronDown

  function toggleExpanded() {
    // Keep the snapshot in view when collapsing from the end of a long dashboard.
    if (expanded && frameRef.current && frameRef.current.getBoundingClientRect().top < 0) {
      frameRef.current.scrollIntoView({ block: "start", behavior: "instant" })
    }
    setExpanded((value) => !value)
  }

  return (
    <figure ref={frameRef} id="workspace" className="home-preview" data-expanded={expanded} aria-label="Kaks Credit dashboard with fictional data" tabIndex={-1}>
      <figcaption className="home-preview-topbar">
        <div className="home-preview-intro">
          <span className="home-preview-brand">Inside Kaks Credit</span>
          <span className="home-preview-label">Read-only dashboard preview · All data is fictional</span>
        </div>
      </figcaption>
      <div id="home-dashboard-preview-content" className="home-preview-main" role="region" aria-label="Dashboard preview" tabIndex={0}>
        <DashboardOverview
          kpis={previewKpis}
          isAdmin
          has={(permission) => permission === "activity:read"}
          activity={previewActivity}
          activityReady
          readOnly
          headingAs="h2"
          formatActivityTime={formatExampleActivityTime}
          charts={
            <div data-dashboard-section="charts" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CollectionsChart chartData={previewCollections} animate={false} />
              <LoanDistributionChart counts={previewLoanCounts} animate={false} />
            </div>
          }
        />
      </div>
      <div className="home-preview-footer">
        <p className="home-preview-caption">
          {expanded ? "The full dashboard, with fictional figures and example borrowers." : "Portfolio snapshot. Expand for all figures, collections and recent activity."}
        </p>
        <button className="home-preview-expand" type="button" disabled={!hydrated} aria-expanded={expanded} aria-controls="home-dashboard-preview-content" onClick={toggleExpanded}>
          {expanded ? "Collapse dashboard" : "Expand dashboard"}
          <ExpandIcon size={16} aria-hidden="true" />
        </button>
      </div>
    </figure>
  )
}
