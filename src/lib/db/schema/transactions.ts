import { pgTable, uuid, numeric, text, timestamp, pgEnum, index, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { transactionCategories } from "./transaction-categories"
import { loans } from "./loans"
import { depositLocationEnum } from "./fund-transfers"
import { bankAccounts } from "./bank-accounts"

export const transactionTypeEnum = pgEnum("transaction_type", ["credit", "debit"])

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: transactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  categoryId: uuid("category_id").notNull().references(() => transactionCategories.id, { onDelete: "restrict" }),
  // User-typed category label for manual income/expense entries. NULL for
  // system-posted journal lines (loan disbursement, payments, etc.) which
  // rely solely on `categoryId` → `transaction_categories.name` for their
  // accounting label. P&L coalesces this column with the joined category name.
  category: text("category"),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  loanId: uuid("loan_id").references(() => loans.id, { onDelete: "set null" }),
  description: text("description"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  depositLocation: depositLocationEnum("deposit_location"),
  subLocationId: uuid("sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
  journalGroupId: uuid("journal_group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_transactions_date").on(table.transactionDate),
  index("idx_transactions_category_id").on(table.categoryId),
  index("idx_transactions_journal_group_id").on(table.journalGroupId),
  index("idx_transactions_loan_id").on(table.loanId),
  index("idx_transactions_reference_id").on(table.referenceId),
  // Powers the SELECT DISTINCT category lookup that drives the
  // expense/income category combobox.
  index("idx_transactions_category_text").on(table.type, table.category),
  // Composite index for location-balance aggregation (GROUP BY type, deposit_location, sub_location_id WHERE category_id = ?)
  index("idx_transactions_balances").on(
    table.categoryId,
    table.type,
    table.depositLocation,
    table.subLocationId,
  ),
  check(
    "transactions_bank_requires_sub_location",
    sql`${table.depositLocation} IS DISTINCT FROM 'bank' OR ${table.subLocationId} IS NOT NULL`,
  ),
  check("transactions_amount_positive", sql`${table.amount} > 0`),
])
