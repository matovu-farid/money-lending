import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { payments } from "@/lib/db/schema/payments"
import type { DepositLocation } from "./common"
import type { LoanStatus } from "./loan"

export type Payment = InferSelectModel<typeof payments>
export type NewPayment = InferInsertModel<typeof payments>

export interface RecordPaymentInput {
  id?: string
  loanId: string
  paymentDate: string  // ISO 8601
  amount: string       // NUMERIC string
  depositLocation: DepositLocation
  subLocationId?: string
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

export interface ListPaymentsInput {
  page?: number          // 1-based, default 1
  pageSize?: number      // default 25
  dateFrom?: string      // ISO date string
  dateTo?: string        // ISO date string
  amountMin?: string     // NUMERIC string
  amountMax?: string     // NUMERIC string
  customerName?: string  // partial match, case-insensitive
}

export interface PaymentWithCustomer {
  id: string
  loanId: string
  customerId: string
  customerName: string
  paymentDate: Date
  amount: string
  interestPortion: string
  principalPortion: string
  principalBalanceAfter: string
  /** Principal balance + one period of interest (what borrower owes total) */
  outstandingBalance: string
  recordedBy: string
  recorderName: string
  depositLocation: DepositLocation
  createdAt: Date
  /** Present when joined from payments list — used to gate mutation UI */
  loanStatus?: LoanStatus
}

/** Ledger-derived payment allocation per payment ID */
export type PaymentPortionsMap = Record<string, { interestPortion: string; principalPortion: string }>

/** Shape returned by recordPaymentAction, extended with deposit location and allocation breakdown */
export interface ReceiptPaymentData extends Payment {
  depositLocationValue: string
  allocation?: {
    interestPortion: string
    principalPortion: string
    principalBalanceAfter: string
    outstandingBalanceAfter: string
  }
}

export interface RecentlyCollectedLoan {
  loanId: string
  customerName: string
  paymentDate: Date
}

export interface DailyCollectionRow {
  paymentId: string
  loanId: string
  customerName: string
  amount: string
  interestPortion: string
  principalPortion: string
  paymentDate: Date
  depositLocation: DepositLocation
}

export interface DailyCollectionsSummary {
  date: string             // YYYY-MM-DD
  totalCollected: string   // BigNumber string e.g. "300000.00"
  paymentCount: number
  rows: DailyCollectionRow[]
}
