import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { customers } from "@/lib/db/schema/customers"
import type { loans } from "@/lib/db/schema/loans"
import type { collateral } from "@/lib/db/schema/collateral"
import type { payments } from "@/lib/db/schema/payments"
import type { auditLog } from "@/lib/db/schema/audit"
import type { notifications } from "@/lib/db/schema/notifications"
import type { creditors, creditorInvestments, creditorRepayments, transactionCategories, transactions, financialSnapshots } from "@/lib/db/schema"
import type { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import type { fundTransfers } from "@/lib/db/schema/fund-transfers"
import type { conversations, conversationParticipants } from "@/lib/db/schema/conversations"
import type { messages, messageAttachments } from "@/lib/db/schema/messages"

export type Customer = InferSelectModel<typeof customers>
export type NewCustomer = InferInsertModel<typeof customers>
export type Loan = InferSelectModel<typeof loans>
export type LoanWithCustomer = Loan & { customerName: string; customerContact: string | null }
export type LoanListEntry = LoanWithCustomer & {
  daysOverdue: number          // 0 for non-overdue or non-active loans
  outstandingBalance: string   // last payment's principalBalanceAfter, or principalAmount if no payments
  dailyRate: string            // daily interest amount in UGX as string, "0" for non-active
  lastPaymentDate: Date | null // date of most recent payment, null if none
  unpaidInterest: string       // total interest accrued minus total interest paid, "0" for non-active
}
export type NewLoan = InferInsertModel<typeof loans>
export type Collateral = InferSelectModel<typeof collateral>
export type NewCollateral = InferInsertModel<typeof collateral>
export type Payment = InferSelectModel<typeof payments>
export type NewPayment = InferInsertModel<typeof payments>
export type AuditLogEntry = InferSelectModel<typeof auditLog>

export type LoanStatus = "active" | "fully_paid" | "settled_with_collateral" | "rolled_over"
export type LoanType = "perpetual" | "fixed_rate" | "reducing_balance"

export interface ScheduleEntry {
  month: number
  monthlyPrincipal: string
  monthlyInterest: string
  monthlyInstallment: string
  balanceAfter: string
}

export type CustomerStatus = "active" | "blacklisted" | "inactive"
export type DepositLocation = "cash" | "bank" | "strong_room"

export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  supervisor: 2,
  admin: 3,
  superAdmin: 4,
} as const
export type UserRole = keyof typeof ROLE_LEVELS

export type ApiResponse<T> = { data: T } | { error: string; details?: unknown }

// --- Customer input types ---
export interface CreateCustomerInput {
  fullName: string
  nin: string
  contact: string
  address: string
}

export interface UpdateCustomerInput {
  fullName?: string
  nin?: string
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
  issuanceFee: string        // string NUMERIC, minimum "50000"
  description: string        // required loan description/purpose
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
}

export interface UpdateLoanInput {
  loanId: string
  principalAmount?: string    // NUMERIC string
  interestRate?: string       // decimal string e.g. "0.10"
  startDate?: string          // ISO 8601
  issuanceFee?: string        // NUMERIC string
  description?: string        // loan description/purpose
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

// --- Payment input types ---
export interface RecordPaymentInput {
  loanId: string
  paymentDate: string  // ISO 8601
  amount: string       // NUMERIC string
  depositLocation: DepositLocation
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

// --- Phase 6: Global Payments List types ---
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
  recordedBy: string
  depositLocation: DepositLocation
  createdAt: Date
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
  capitalInSystem: string    // Aggregated from creditor investments
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
  detail?: Record<string, string | number | null | undefined>
}

export interface ChangeStatusInput {
  customerId: string
  newStatus: CustomerStatus
  reason: string
}

// Phase 4: Creditor types
export type Creditor = InferSelectModel<typeof creditors>
export type NewCreditor = InferInsertModel<typeof creditors>
export type CreditorInvestment = InferSelectModel<typeof creditorInvestments>
export type NewCreditorInvestment = InferInsertModel<typeof creditorInvestments>
export type CreditorRepayment = InferSelectModel<typeof creditorRepayments>
export type NewCreditorRepayment = InferInsertModel<typeof creditorRepayments>

// Phase 4: Transaction types
export type TransactionCategory = InferSelectModel<typeof transactionCategories>
export type NewTransactionCategory = InferInsertModel<typeof transactionCategories>
export type Transaction = InferSelectModel<typeof transactions>
export type NewTransaction = InferInsertModel<typeof transactions>
export type FinancialSnapshot = InferSelectModel<typeof financialSnapshots>

// Phase 4: Input types
export interface CreateCreditorInput {
  name: string
  contact: string
  address: string
}

export interface UpdateCreditorInput {
  name?: string
  contact?: string
  address?: string
}

export interface AddInvestmentInput {
  creditorId: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
  depositLocation?: DepositLocation
}

export interface RecordCreditorRepaymentInput {
  investmentId: string
  amount: string
  repaymentDate: string
  sourceLocation?: DepositLocation
}

export interface CreateExpenseInput {
  categoryId: string
  amount: string
  transactionDate: string
  notes?: string
  location?: "cash" | "bank" | "strong_room"
}

export interface CreateIncomeInput {
  categoryId: string
  amount: string
  transactionDate: string
  notes?: string
  location?: "cash" | "bank" | "strong_room"
}

export interface CreateCategoryInput {
  name: string
  type: "expense" | "income"
}

export type CategoryType = "expense" | "income"
export type TransactionType = "credit" | "debit"

// Phase 4: Dashboard types
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

// Phase 4: Report types
export interface PnlData {
  period: string
  income: { category: string; amount: string }[]
  totalIncome: string
  expenses: { category: string; amount: string }[]
  totalExpenses: string
  netProfit: string
}

export interface BalanceSheetData {
  asOf: string
  assets: {
    cashBalance: string
    bankBalance: string
    strongRoomBalance: string
    totalLoansOutstanding: string
    totalAssets: string
  }
  liabilities: { totalCreditorBalances: string }
  equity: { shareCapital: string; retainedEarnings: string; totalEquity: string }
}

export interface PortfolioEntry {
  loanId: string
  customerName: string
  principalAmount: string
  outstandingBalance: string
  interestAccrued: string
  daysOverdue: string
  status: string
  riskFlag: boolean
}

export interface TransactionLogFilters {
  type?: TransactionType
  categoryId?: string
  dateFrom?: string
  dateTo?: string
}

// --- Phase 8: Quick-Record Workflow types ---
export interface ActiveLoanSearchResult {
  loanId: string
  customerId: string
  customerName: string
  principalAmount: string
}

export interface RecentlyCollectedLoan {
  loanId: string
  customerName: string
  paymentDate: Date
}

// --- Phase 7: Daily Collections types ---
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

export interface LoanDueToday {
  loanId: string
  customerId: string
  customerName: string
  loanAmount: string
  outstandingBalance: string
  daysSinceLastPayment: number
  lastPaymentDate: Date | null
}

// --- Rate Change Request types ---
export type RateChangeRequest = InferSelectModel<typeof rateChangeRequests>
export type NewRateChangeRequest = InferInsertModel<typeof rateChangeRequests>

export interface CreateRateChangeRequestInput {
  loanId: string
  requestedRate: string  // decimal string e.g. "0.08" for 8%/month
}

export interface ReviewRateChangeRequestInput {
  requestId: string
  action: "approved" | "rejected"
  reviewNote?: string
}

// --- Cash Management: Fund Transfer types ---
export type FundTransfer = InferSelectModel<typeof fundTransfers>
export type NewFundTransfer = InferInsertModel<typeof fundTransfers>

export interface CreateFundTransferInput {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string       // NUMERIC string
  note?: string
}

// --- Chat types ---
export type Conversation = InferSelectModel<typeof conversations>
export type ConversationParticipant = InferSelectModel<typeof conversationParticipants>
export type Message = InferSelectModel<typeof messages>
export type MessageAttachment = InferSelectModel<typeof messageAttachments>

export interface ConversationListItem {
  id: string
  name: string | null
  isGroup: boolean
  participants: { id: string; name: string }[]
  lastMessage: { content: string; senderName: string; createdAt: Date } | null
  unreadCount: number
  updatedAt: Date
}

export interface MessageWithSender {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  mentions: string[]
  attachments: { id: string; mimeType: string; fileName: string; fileSize: number; data: string; expired: boolean }[]
  deletedAt: Date | null
  createdAt: Date
}

export interface SendMessageInput {
  conversationId: string
  content: string
  mentions?: string[]
  attachments?: { data: string; mimeType: string; fileName: string; fileSize: number }[]
}

export interface CreateConversationInput {
  participantIds: string[]
  name?: string
}

export interface ChatUser {
  id: string
  name: string
  role: string
}
