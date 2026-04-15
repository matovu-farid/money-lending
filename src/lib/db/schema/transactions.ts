import { pgTable, uuid, numeric, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core"
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
])
