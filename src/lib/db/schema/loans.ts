import { pgTable, uuid, numeric, integer, timestamp, text, pgEnum } from "drizzle-orm/pg-core"
import { customers } from "./customers"

export const loanStatusEnum = pgEnum("loan_status", [
  "active",
  "fully_paid",
])

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  principalAmount: numeric("principal_amount", { precision: 15, scale: 2 }).notNull(),
  interestRate: numeric("interest_rate", { precision: 5, scale: 4 }).notNull(),
  minInterestDays: integer("min_interest_days").notNull().default(30),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  status: loanStatusEnum("status").notNull().default("active"),
  interestRateOverride: numeric("interest_rate_override", { precision: 5, scale: 4 }),
  minPeriodOverride: integer("min_period_override"),
  issuedBy: text("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
