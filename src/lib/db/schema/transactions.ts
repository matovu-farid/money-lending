import { pgTable, uuid, numeric, text, timestamp, pgEnum } from "drizzle-orm/pg-core"
import { transactionCategories } from "./transaction-categories"

export const transactionTypeEnum = pgEnum("transaction_type", ["credit", "debit"])

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: transactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  categoryId: uuid("category_id").notNull().references(() => transactionCategories.id, { onDelete: "restrict" }),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  description: text("description"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
