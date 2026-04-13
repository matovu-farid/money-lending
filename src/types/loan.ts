import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { loans } from "@/lib/db/schema/loans"
import type { collateral } from "@/lib/db/schema/collateral"
import type { DepositLocation } from "./common"

export type Loan = InferSelectModel<typeof loans>
export type NewLoan = InferInsertModel<typeof loans>
export type LoanWithCustomer = Loan & { customerName: string; customerContact: string | null }
export type LoanListEntry = LoanWithCustomer & {
  daysOverdue: number          // 0 for non-overdue or non-active loans
  outstandingBalance: string   // ledger-derived outstanding principal (Loans Receivable DR - CR)
  dailyRate: string            // daily interest amount in UGX as string, "0" for non-active
  lastPaymentDate: Date | null // date of most recent payment, null if none
  unpaidInterest: string       // total interest accrued minus total interest paid, "0" for non-active
}

export type Collateral = InferSelectModel<typeof collateral>
export type NewCollateral = InferInsertModel<typeof collateral>

export type LoanStatus = "pending" | "active" | "fully_paid" | "settled_with_collateral" | "rolled_over"
export type LoanType = "perpetual" | "fixed_rate" | "reducing_balance"

/** Coalesce a possibly-null loanType to a typed LoanType (defaults to "perpetual"). */
export function toLoanType(value: string | null | undefined): LoanType {
  if (value === "fixed_rate" || value === "reducing_balance" || value === "perpetual") return value
  return "perpetual"
}

export interface ScheduleEntry {
  month: number
  monthlyPrincipal: string
  monthlyInterest: string
  monthlyInstallment: string
  balanceAfter: string
}

// --- Collateral input type ---
export interface CollateralInput {
  nature: string
  description: string
}

// --- Loan input types ---
export interface CreateLoanInput {
  customerId: string
  principalAmount: string   // string for NUMERIC precision -- no float
  issuanceFee: string        // string NUMERIC, minimum "50000"
  interestRate: string      // string decimal e.g. "0.10" for 10%/month, defaults to "0.10"
  minInterestDays: number   // defaults to 30
  startDate: string         // ISO 8601 datetime string
  collateral: CollateralInput
  disbursementSource: DepositLocation
  loanType?: LoanType                    // defaults to "perpetual"
  termMonths?: number                   // required for fixed_rate and reducing_balance
  interestRateOverride?: string | null  // admin-only override
  minPeriodOverride?: number | null     // admin-only override
  rollover?: RolloverData
  backdateNote?: string                 // required when start date is before today
}

export interface UpdateLoanInput {
  loanId: string
  principalAmount?: string    // NUMERIC string
  interestRate?: string       // decimal string e.g. "0.10"
  startDate?: string          // ISO 8601
  issuanceFee?: string        // NUMERIC string
  reason: string              // required for audit
}

export interface DeleteLoanInput {
  loanId: string
  reason: string              // required for audit
}

// --- Collateral Settlement ---
export interface SettleWithCollateralInput {
  loanId: string
  reason: string
}

// --- Loan Rollover ---
export interface RolloverData {
  fromLoanId: string
  carriedPrincipal: string
  carriedInterest: string
}

// --- Quick-Record Workflow types ---
export interface ActiveLoanSearchResult {
  loanId: string
  customerId: string
  customerName: string
  principalAmount: string
}

export interface LoanDueToday {
  loanId: string
  customerId: string
  customerName: string
  loanAmount: string
  outstandingBalance: string
  daysOverdue: number
  lastPaymentDate: Date | null
}
