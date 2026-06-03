import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { transactionCategories, transactions, financialSnapshots } from "@/lib/db/schema"
import type { DepositLocation, TransactionType } from "./common"

export type TransactionCategory = InferSelectModel<typeof transactionCategories>
export type NewTransactionCategory = InferInsertModel<typeof transactionCategories>
export type Transaction = InferSelectModel<typeof transactions>
export type NewTransaction = InferInsertModel<typeof transactions>
export type FinancialSnapshot = InferSelectModel<typeof financialSnapshots>

export interface CreateTransactionInput {
  id?: string
  categoryName: string
  amount: string
  transactionDate: string
  notes?: string
  location: DepositLocation
  subLocationId?: string
  backdateNote?: string
}

export interface CreateCategoryInput {
  name: string
  type: "asset" | "liability" | "equity" | "revenue" | "expense"
}

/** UI-facing transaction row shape (used by income/expense/transaction list pages) */
export interface TransactionRow {
  id: string
  type: string
  amount: string
  categoryId: string
  /**
   * Display label. For manual income/expense rows this is the user-typed
   * `transactions.category` text; for system journal lines it's the
   * `transaction_categories.name` joined via `categoryId`.
   */
  category: string
  description: string | null
  transactionDate: Date
  recordedBy: string
  referenceType: string | null
  referenceId: string | null
  createdAt: Date
  isOptimistic?: boolean
}

/**
 * Raw transaction shape from Electric shape sync (no JOINed categoryName).
 * This is a re-export of the schema-derived `TransactionRow` from
 * `@/lib/schemas/collections` — kept here under the old name for callers that
 * already import `TransactionShapeRow` from `@/types`.
 *
 * Date columns (`transactionDate`, `createdAt`) are coerced to `Date` by the
 * collection schema, so consumers can call `.getTime()` directly without
 * defensive `instanceof Date` checks.
 */
export type { TransactionRow as TransactionShapeRow } from "@/lib/schemas/collections"

/** UI-facing category shape */
export interface CategoryRow {
  id: string
  name: string
  type: string
  isDefault: boolean
}

export interface TransactionLogFilters {
  type?: TransactionType
  categoryId?: string
  dateFrom?: string
  dateTo?: string
  manualOnly?: boolean
}

export interface PnlData {
  period: string
  income: { category: string; amount: string }[]
  totalIncome: string
  expenses: { category: string; amount: string }[]
  totalExpenses: string
  netProfit: string
}

export interface CashflowMonth {
  month: string  // "YYYY-MM"
  inflows: string
  outflows: string
  net: string
}

export interface CashflowData {
  /** Anchor month for the "Breakdown" section (most recent month displayed). */
  period: string
  /** Sequential months ending at `period`, oldest first. */
  months: CashflowMonth[]
  /** Per-source totals for `period`. */
  inflowsByType: { label: string; amount: string }[]
  outflowsByType: { label: string; amount: string }[]
  /** Sum across `months`. */
  totalInflows: string
  totalOutflows: string
  totalNet: string
}

export interface BalanceSheetData {
  asOf: string
  assets: {
    cashBalance: string
    bankBalance: string
    strongRoomBalance: string
    totalLoansOutstanding: string
    interestReceivable: string
    seizedCollateralValue: string
    totalAssets: string
    bankAccountBalances: Record<string, string>
  }
  liabilities: { totalCreditorBalances: string; interestPayable?: string }
  equity: { shareCapital: string; retainedEarnings: string; totalEquity: string }
}

export interface RetainedEarningsData {
  period: string
  beginningBalance: string
  netIncome: string
  endingBalance: string
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
