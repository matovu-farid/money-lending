/**
 * Centralized query key factory.
 *
 * Every TanStack Query / TanStack DB collection key lives here so that
 * invalidation sites stay in sync with collection definitions.
 *
 * Convention:
 *   .all        → broadest prefix (invalidates everything in the group)
 *   .list()     → the main list query
 *   .detail(id) → a single-item or parameterized query
 */

export const queryKeys = {
  // ── Loans ────────────────────────────────────────────────────────────
  loans: {
    all: ["loans"] as const,
    balance: (loanId: string) => ["loans", loanId, "balance"] as const,
    collateral: (loanId: string) => ["loans", loanId, "collateral"] as const,
    activeLoanCheck: (customerId: string) => ["active-loan-check", customerId] as const,
    dueToday: ["loans-due-today"] as const,
  },

  // ── Loan Status Counts ───────────────────────────────────────────────
  loanStatusCounts: {
    all: ["loan-status-counts"] as const,
  },

  // ── Payments ─────────────────────────────────────────────────────────
  payments: {
    all: ["payments"] as const,
    portions: (loanId: string, paymentIds: string) =>
      ["payments", "portions", loanId, paymentIds] as const,
    portionsAll: ["payments", "portions"] as const,
  },

  // ── Customers ────────────────────────────────────────────────────────
  customers: {
    all: ["customers"] as const,
  },

  // ── Expenses ─────────────────────────────────────────────────────────
  expenses: {
    all: ["expenses"] as const,
    categories: ["expenses", "categories"] as const,
  },

  // ── Income ───────────────────────────────────────────────────────────
  income: {
    all: ["income"] as const,
    categories: ["income", "categories"] as const,
  },

  // ── Fund Transfers ───────────────────────────────────────────────────
  fundTransfers: {
    all: ["fund-transfers"] as const,
  },

  // ── Bank Accounts ────────────────────────────────────────────────────
  bankAccounts: {
    all: ["bank-accounts"] as const,
  },

  // ── Creditors ────────────────────────────────────────────────────────
  creditors: {
    all: ["creditors"] as const,
    capital: ["creditors", "capital"] as const,
    monthlyDue: ["creditors", "monthly-due"] as const,
  },

  // ── Rate Change Requests ─────────────────────────────────────────────
  rateChangeRequests: {
    all: ["rate-change-requests"] as const,
  },

  // ── Dashboard ────────────────────────────────────────────────────────
  dashboard: {
    kpis: ["dashboard", "kpis"] as const,
    activity: ["dashboard", "activity"] as const,
  },

  // ── Location Balances ────────────────────────────────────────────────
  locationBalances: {
    all: ["location-balances"] as const,
  },

  // ── Daily Collections ────────────────────────────────────────────────
  dailyCollections: {
    all: ["daily-collections"] as const,
    date: (date: string) => ["daily-collections", date] as const,
  },

  // ── Reports ──────────────────────────────────────────────────────────
  reports: {
    portfolio: ["reports", "portfolio"] as const,
    transactions: ["reports", "transactions"] as const,
    pnl: (period?: string) =>
      period ? (["reports", "pnl", period] as const) : (["reports", "pnl"] as const),
    balanceSheet: (period?: string) =>
      period
        ? (["reports", "balance-sheet", period] as const)
        : (["reports", "balance-sheet"] as const),
    retainedEarnings: (period?: string) =>
      period
        ? (["reports", "retained-earnings", period] as const)
        : (["reports", "retained-earnings"] as const),
  },

  // ── Delegations ──────────────────────────────────────────────────────
  delegations: {
    all: ["delegations"] as const,
  },

  // ── Invitations ──────────────────────────────────────────────────────
  invitations: {
    all: ["invitations"] as const,
  },

  // ── Admin Users ──────────────────────────────────────────────────────
  adminUsers: {
    list: ["admin-users", "list"] as const,
  },

  // ── Auth / Permissions ───────────────────────────────────────────────
  auth: {
    currentUserRole: ["current-user-role"] as const,
    effectivePermissions: ["effective-permissions"] as const,
  },

  // ── Misc / Lookup ────────────────────────────────────────────────────
  collateralNatures: {
    all: ["collateral-natures"] as const,
  },
  userNames: {
    byIds: (key: string) => ["user-names", key] as const,
  },
  activities: {
    list: (params: Record<string, string>, page: number) => ["activities", params, page] as const,
  },
} as const
