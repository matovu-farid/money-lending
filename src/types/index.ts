import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { customers } from "@/lib/db/schema/customers"
import type { loans } from "@/lib/db/schema/loans"
import type { collateral } from "@/lib/db/schema/collateral"
import type { payments } from "@/lib/db/schema/payments"
import type { auditLog } from "@/lib/db/schema/audit"
import type { notifications } from "@/lib/db/schema/notifications"

export type Customer = InferSelectModel<typeof customers>
export type NewCustomer = InferInsertModel<typeof customers>
export type Loan = InferSelectModel<typeof loans>
export type NewLoan = InferInsertModel<typeof loans>
export type Collateral = InferSelectModel<typeof collateral>
export type NewCollateral = InferInsertModel<typeof collateral>
export type Payment = InferSelectModel<typeof payments>
export type NewPayment = InferInsertModel<typeof payments>
export type AuditLogEntry = InferSelectModel<typeof auditLog>

export type LoanStatus = "pending" | "active" | "fully_paid"
export type CustomerStatus = "active" | "blacklisted" | "inactive"

export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  admin: 2,
  superAdmin: 3,
} as const
export type UserRole = keyof typeof ROLE_LEVELS

export type ApiResponse<T> = { data: T } | { error: string; details?: unknown }

// --- Customer input types ---
export interface CreateCustomerInput {
  fullName: string
  contact: string
  address: string
}

export interface UpdateCustomerInput {
  fullName?: string
  contact?: string
  address?: string
}

// --- Collateral input type ---
export interface CollateralInput {
  nature: string
  description?: string
}

// --- Loan input types ---
export interface CreateLoanInput {
  customerId: string
  principalAmount: string   // string for NUMERIC precision -- no float
  interestRate: string      // string decimal e.g. "0.10" for 10%/month, defaults to "0.10"
  minInterestDays: number   // defaults to 30
  startDate: string         // ISO 8601 datetime string
  collateral: CollateralInput
  interestRateOverride?: string | null  // admin-only override
  minPeriodOverride?: number | null     // admin-only override
}

// --- Payment input types ---
export interface RecordPaymentInput {
  loanId: string
  paymentDate: string  // ISO 8601
  amount: string       // NUMERIC string
  note?: string
}

export interface EditPaymentInput {
  paymentId: string
  amount?: string
  paymentDate?: string
  reason: string       // required for audit
}

export interface DeletePaymentInput {
  paymentId: string
  reason: string       // required for audit
}

// --- Phase 3 types ---

export type Notification = InferSelectModel<typeof notifications>
export type NewNotification = InferInsertModel<typeof notifications>

export interface CustomerSearchParams {
  name?: string
  status?: CustomerStatus[]
  loanStatus?: LoanStatus[]
  daysRemainingFilter?: "any" | "due_within_30" | "overdue_30_plus"
  page?: number
  pageSize?: number
}

export interface DashboardKPIs {
  loansOutstanding: string   // BigNumber string
  repaymentsCollected: string
  interestEarned: string
  activeBorrowers: number
  overdueCount: number
  capitalInSystem: string    // "0.00" until Phase 4
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
}

export interface ChangeStatusInput {
  customerId: string
  newStatus: CustomerStatus
  reason: string
}
