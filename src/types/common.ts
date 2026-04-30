export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  supervisor: 2,
  admin: 3,
  superAdmin: 4,
} as const
export type UserRole = keyof typeof ROLE_LEVELS

export type Permission =
  // operations – loans
  | "loan:create" | "loan:read" | "loan:update" | "loan:disburse" | "loan:rollover" | "loan:settle"
  // operations – customers
  | "customer:create" | "customer:read" | "customer:update"
  // operations – payments
  | "payment:create" | "payment:read" | "payment:update" | "payment:delete" | "payment:edit-any" | "payment:delete-any"
  // operations – expenses
  | "expense:create" | "expense:read"
  // operations – income
  | "income:create" | "income:read"
  // operations – fund transfers
  | "fund-transfer:create" | "fund-transfer:read"
  // approvals
  | "backdate:beyond-3-days"
  | "rate-change:create" | "rate-change:approve-standard" | "rate-change:approve-low"
  // creditors
  | "creditor:read" | "creditor:create" | "creditor:update"
  // admin
  | "dashboard:read"
  | "reports:read" | "reports:financial"
  | "settings:read" | "settings:update"
  | "user:list" | "user:ban" | "user:impersonate" | "user:invite"
  | "session:list" | "session:revoke" | "session:delete"
  | "ip-allowlist:manage"
  // delegation
  | "delegation:create" | "delegation:revoke" | "delegation:read"
  // activity monitoring
  | "activity:read"
  // roles
  | "role:assign-loan-officer" | "role:assign-supervisor" | "role:assign-admin" | "role:assign-super-admin"

export type ApiResponse<T> = { data: T } | { error: string; details?: unknown }

export type DepositLocation = "cash" | "bank" | "strong_room"

export type CategoryType = "asset" | "liability" | "equity" | "revenue" | "expense"
export type TransactionType = "credit" | "debit"
