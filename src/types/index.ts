import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { customers } from "@/lib/db/schema/customers"
import type { loans } from "@/lib/db/schema/loans"
import type { collateral } from "@/lib/db/schema/collateral"
import type { payments } from "@/lib/db/schema/payments"
import type { auditLog } from "@/lib/db/schema/audit"

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
