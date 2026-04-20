import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { creditors, creditorInvestments, creditorRepayments } from "@/lib/db/schema"
import type { DepositLocation } from "./common"

export type Creditor = InferSelectModel<typeof creditors>
export type NewCreditor = InferInsertModel<typeof creditors>
export type CreditorInvestment = InferSelectModel<typeof creditorInvestments>
export type NewCreditorInvestment = InferInsertModel<typeof creditorInvestments>
export type CreditorRepayment = InferSelectModel<typeof creditorRepayments>
export type NewCreditorRepayment = InferInsertModel<typeof creditorRepayments>

export interface CreateCreditorInput {
  id?: string
  name: string
  contact: string
  address: string
}

export interface UpdateCreditorInput {
  name?: string
  contact?: string
  address?: string
}

export interface CreateCreditorWithInvestmentInput {
  id?: string
  name: string
  contact: string
  address: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
  depositLocation?: DepositLocation
  subLocationId?: string
}

export interface AddInvestmentInput {
  id?: string
  creditorId: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
  depositLocation?: DepositLocation
  subLocationId?: string
}

export interface RecordCreditorRepaymentInput {
  id?: string
  investmentId: string
  amount: string
  repaymentDate: string
  sourceLocation?: DepositLocation
}

export interface CreditorDashboard {
  totalInvested: string
  interestAccrued: string
  repaymentsMade: string
  outstandingBalance: string
  investments: CreditorInvestmentSummary[]
}

export interface CreditorInvestmentSummary {
  id: string
  amount: string
  interestRateMonthly: string
  investmentDate: Date
  principalBalance: string
  interestAccrued: string
  totalRepaid: string
}

export interface MonthlySummaryRow {
  /** Format: "YYYY-MM" */
  month: string
  /** Interest due for this month (principal_balance * monthly_rate) */
  interestDue: string
  /** Interest portion of repayments made this month */
  interestPaid: string
  /** Principal portion of repayments made this month */
  principalPaid: string
  /** interestPaid + principalPaid */
  totalPaid: string
  /** Running remaining principal balance after this month */
  remainingBalance: string
}
