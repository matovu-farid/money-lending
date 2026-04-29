import { pgTable, uuid, numeric, timestamp, text, index, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { creditorInvestments } from "./creditor-investments"

export const creditorRepayments = pgTable("creditor_repayments", {
  id: uuid("id").primaryKey().defaultRandom(),
  investmentId: uuid("investment_id").notNull().references(() => creditorInvestments.id),
  repaymentDate: timestamp("repayment_date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_creditor_repayments_investment_id").on(table.investmentId),
  check("creditor_repayments_amount_positive", sql`${table.amount} > 0`),
])
