import type { CustomerSearchParams, ListPaymentsInput } from "@/types"

export const queryKeys = {
  dashboard: {
    all: ["dashboard"] as const,
    kpis: () => [...queryKeys.dashboard.all, "kpis"] as const,
    activity: () => [...queryKeys.dashboard.all, "activity"] as const,
  },

  customers: {
    all: ["customers"] as const,
    detail: (id: string) => [...queryKeys.customers.all, id] as const,
    search: (params: CustomerSearchParams, page: number) =>
      [...queryKeys.customers.all, params, page] as const,
    recent: () => [...queryKeys.customers.all, "recent"] as const,
  },

  loans: {
    all: ["loans"] as const,
    detail: (id: string) => [...queryKeys.loans.all, id] as const,
    balance: (id: string) => [...queryKeys.loans.detail(id), "balance"] as const,
    paymentContext: (id: string) => [...queryKeys.loans.detail(id), "paymentContext"] as const,
    byCustomer: (customerId: string) =>
      [...queryKeys.loans.all, "byCustomer", customerId] as const,
    searchActive: (query: string) =>
      [...queryKeys.loans.all, "searchActive", query] as const,
  },

  dailyCollections: {
    all: ["daily-collections"] as const,
    byDate: (date: string) =>
      [...queryKeys.dailyCollections.all, date] as const,
  },

  loansDueToday: {
    all: ["loans-due-today"] as const,
  },

  payments: {
    all: ["payments"] as const,
    list: (params: Omit<ListPaymentsInput, "page" | "pageSize">, page: number) =>
      [...queryKeys.payments.all, params, page] as const,
    detail: (id: string) => [...queryKeys.payments.all, id] as const,
    byLoan: (loanId: string) =>
      [...queryKeys.payments.all, "byLoan", loanId] as const,
    portions: (loanId: string) =>
      [...queryKeys.payments.all, "portions", loanId] as const,
  },

  adminUsers: {
    all: ["admin-users"] as const,
    list: () => [...queryKeys.adminUsers.all, "list"] as const,
  },

  notifications: {
    all: ["notifications"] as const,
    unreadCount: () => [...queryKeys.notifications.all, "unread-count"] as const,
  },

  recentLoans: {
    all: ["recent-loans"] as const,
    list: () => [...queryKeys.recentLoans.all, "list"] as const,
  },

  income: {
    all: ["income"] as const,
    list: (params: Record<string, unknown>, page: number) =>
      [...queryKeys.income.all, params, page] as const,
  },

  expenses: {
    all: ["expenses"] as const,
    list: (params: Record<string, unknown>, page: number) =>
      [...queryKeys.expenses.all, params, page] as const,
    categories: () => [...queryKeys.expenses.all, "categories"] as const,
  },

  creditors: {
    all: ["creditors"] as const,
    detail: (id: string) => [...queryKeys.creditors.all, id] as const,
    capital: () => [...queryKeys.creditors.all, "capital"] as const,
    monthlyDue: () => [...queryKeys.creditors.all, "monthly-due"] as const,
    monthlySummary: (id: string) => [...queryKeys.creditors.detail(id), "monthly-summary"] as const,
  },

  rateChangeRequests: {
    all: ["rate-change-requests"] as const,
    pending: () => [...queryKeys.rateChangeRequests.all, "pending"] as const,
    byLoan: (loanId: string) =>
      [...queryKeys.rateChangeRequests.all, "byLoan", loanId] as const,
    pendingCount: () => [...queryKeys.rateChangeRequests.all, "pending-count"] as const,
  },

  fundTransfers: {
    all: ["fund-transfers"] as const,
  },

  reports: {
    all: ["reports"] as const,
    portfolio: () => [...queryKeys.reports.all, "portfolio"] as const,
    pnl: (period: string) => [...queryKeys.reports.all, "pnl", period] as const,
    balanceSheet: (period: string) =>
      [...queryKeys.reports.all, "balance-sheet", period] as const,
    retainedEarnings: (period: string) =>
      [...queryKeys.reports.all, "retained-earnings", period] as const,
    transactions: () => [...queryKeys.reports.all, "transactions"] as const,
  },
} as const
