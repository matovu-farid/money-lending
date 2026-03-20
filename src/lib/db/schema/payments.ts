import { pgTable, uuid, numeric, timestamp, text } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  interestPortion: numeric("interest_portion", { precision: 15, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 15, scale: 2 }).notNull(),
  principalBalanceBefore: numeric("principal_balance_before", { precision: 15, scale: 2 }).notNull(),
  principalBalanceAfter: numeric("principal_balance_after", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
