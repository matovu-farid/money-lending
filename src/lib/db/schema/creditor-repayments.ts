import { pgTable, uuid, numeric, timestamp, text, index } from "drizzle-orm/pg-core"
import { creditorInvestments } from "./creditor-investments"

export const creditorRepayments = pgTable("creditor_repayments", {
  id: uuid("id").primaryKey().defaultRandom(),
  investmentId: uuid("investment_id").notNull().references(() => creditorInvestments.id),
  repaymentDate: timestamp("repayment_date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  interestPortion: numeric("interest_portion", { precision: 15, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 15, scale: 2 }).notNull(),
  principalBalanceBefore: numeric("principal_balance_before", { precision: 15, scale: 2 }).notNull(),
  principalBalanceAfter: numeric("principal_balance_after", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_creditor_repayments_investment_id").on(table.investmentId),
])
