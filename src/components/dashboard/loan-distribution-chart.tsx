"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { loanStatusCountsCollection } from "@/collections/loan-status-counts"
import type { LoanStatus } from "@/types"
import { LoanDistributionChartView } from "./loan-distribution-chart-view"

const EMPTY_COUNTS: Record<LoanStatus, number> = {
  pending: 0, active: 0, fully_paid: 0, settled_with_collateral: 0, rolled_over: 0,
}

export function LoanDistributionChart() {
  const { data: rows } = useLiveQuery((q) =>
    q.from({ r: loanStatusCountsCollection }).select(({ r }) => ({ counts: r.counts }))
  )
  const counts = (rows?.[0]?.counts ?? EMPTY_COUNTS) as Record<LoanStatus, number>
  return <LoanDistributionChartView counts={counts} />
}
