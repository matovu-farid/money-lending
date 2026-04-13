export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  supervisor: 2,
  admin: 3,
  superAdmin: 4,
} as const
export type UserRole = keyof typeof ROLE_LEVELS

export type ApiResponse<T> = { data: T } | { error: string; details?: unknown }

export type DepositLocation = "cash" | "bank" | "strong_room"

export type CategoryType = "asset" | "liability" | "equity" | "revenue" | "expense"
export type TransactionType = "credit" | "debit"
