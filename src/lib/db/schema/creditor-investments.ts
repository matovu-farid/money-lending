import { pgTable, uuid, numeric, timestamp, text } from "drizzle-orm/pg-core"
import { creditors } from "./creditors"

export const creditorInvestments = pgTable("creditor_investments", {
  id: uuid("id").primaryKey().defaultRandom(),
  creditorId: uuid("creditor_id").notNull().references(() => creditors.id),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  interestRateMonthly: numeric("interest_rate_monthly", { precision: 5, scale: 4 }).notNull(),
  investmentDate: timestamp("investment_date", { withTimezone: true }).notNull(),
  principalBalance: numeric("principal_balance", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
