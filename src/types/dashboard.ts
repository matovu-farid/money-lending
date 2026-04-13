export interface DashboardKPIs {
  loansOutstanding: string   // BigNumber string
  repaymentsCollected: string
  interestEarned: string
  activeBorrowers: number
  overdueCount: number
  capitalInSystem: string    // Aggregated from creditor investments
}

export interface WatchlistEntry {
  customerId: string
  customerName: string
  loanId: string
  loanAmount: string
  outstandingBalance: string
  daysOverdue: string
  dailyRate: string
  lastPaymentDate: Date | null
}

export interface ActivityFeedItem {
  id: string
  type: "payment_received" | "loan_issued" | "overdue_flagged"
  description: string
  timestamp: Date
  loanId?: string
  customerId?: string
  detail?: Record<string, string | number | null | undefined>
}
