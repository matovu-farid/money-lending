import type { ActivityItem, DashboardKPIs, LoanStatus } from "@/types"
import type { CollectionChartPoint } from "@/components/dashboard/collections-chart-view"

// Public marketing fixtures. These values are authored examples, never copied
// from a database, session, production export, or sanitized financial snapshot.
export const previewKpis: DashboardKPIs = {
  loansOutstanding: "8750000",
  repaymentsCollected: "3200000",
  interestEarned: "640000",
  activeBorrowers: 18,
  overdueCount: 3,
  capitalInSystem: "2500000",
}

export const previewLoanCounts: Record<LoanStatus, number> = {
  active: 24, fully_paid: 12, pending: 2, rolled_over: 3, settled_with_collateral: 1,
}

const dailyAmounts = [0, 75000, 40000, 120000, 90000, 0, 180000, 60000, 85000, 150000,
  45000, 0, 95000, 170000, 60000, 80000, 125000, 0, 210000, 70000,
  40000, 90000, 155000, 0, 100000, 55000, 190000, 65000, 110000, 150000]

export const previewCollections: CollectionChartPoint[] = dailyAmounts.map((total, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  label: `Sep ${index + 1}`,
  total,
}))

export const previewActivity: ActivityItem[] = [
  {
    id: "example-payment", actorName: "Example Officer", actorRole: "loanOfficer",
    action: "payment.create", entityType: "payment", entityId: "example-payment",
    description: "Payment of UGX 150,000 recorded for Example Borrower A",
    href: null, occurredAt: new Date("2026-09-30T09:50:00Z"),
  },
  {
    id: "example-loan", actorName: "Example Officer", actorRole: "loanOfficer",
    action: "loan.create", entityType: "loan", entityId: "example-loan",
    description: "Loan of UGX 500,000 issued to Example Borrower B",
    href: null, occurredAt: new Date("2026-09-30T09:30:00Z"),
  },
]
