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
    recent: () => [...queryKeys.customers.all, "recent"] as const,
  },

  loans: {
    all: ["loans"] as const,
    detail: (id: string) => [...queryKeys.loans.all, id] as const,
    balance: (id: string) => [...queryKeys.loans.detail(id), "balance"] as const,
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
  },

  creditors: {
    all: ["creditors"] as const,
    detail: (id: string) => [...queryKeys.creditors.all, id] as const,
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

  chat: {
    all: ["chat"] as const,
    conversations: () => [...queryKeys.chat.all, "conversations"] as const,
    messages: (conversationId: string) => [...queryKeys.chat.all, "messages", conversationId] as const,
    users: (query: string) => [...queryKeys.chat.all, "users", query] as const,
    participants: (conversationId: string) => [...queryKeys.chat.all, "participants", conversationId] as const,
  },
} as const
