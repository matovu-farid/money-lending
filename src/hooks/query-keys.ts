import type { CustomerSearchParams, ListPaymentsInput } from "@/types"

export const queryKeys = {
  dashboard: {
    all: ["dashboard"] as const,
    kpis: () => [...queryKeys.dashboard.all, "kpis"] as const,
  },

  customers: {
    all: ["customers"] as const,
    detail: (id: string) => [...queryKeys.customers.all, id] as const,
    search: (params: CustomerSearchParams, page: number) =>
      [...queryKeys.customers.all, params, page] as const,
  },

  loans: {
    all: ["loans"] as const,
    detail: (id: string) => [...queryKeys.loans.all, id] as const,
    byCustomer: (customerId: string) =>
      [...queryKeys.loans.all, "byCustomer", customerId] as const,
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
  },

  creditors: {
    all: ["creditors"] as const,
    detail: (id: string) => [...queryKeys.creditors.all, id] as const,
  },
} as const
