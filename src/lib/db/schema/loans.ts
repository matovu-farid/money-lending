import { pgTable, uuid, numeric, integer, timestamp, text, pgEnum, index, boolean } from "drizzle-orm/pg-core"
import { customers } from "./customers"
import { depositLocationEnum } from "./fund-transfers"

export const loanStatusEnum = pgEnum("loan_status", [
  "pending",
  "active",
  "fully_paid",
  "settled_with_collateral",
  "rolled_over",
])

export const loanTypeEnum = pgEnum("loan_type", [
  "perpetual",
  "fixed_rate",
  "reducing_balance",
])

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  principalAmount: numeric("principal_amount", { precision: 15, scale: 2 }).notNull(),
  issuanceFee: numeric("issuance_fee", { precision: 15, scale: 2 }).notNull(),
  interestRate: numeric("interest_rate", { precision: 5, scale: 4 }).notNull(),
  minInterestDays: integer("min_interest_days").notNull().default(30),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  status: loanStatusEnum("status").notNull().default("active"),
  interestRateOverride: numeric("interest_rate_override", { precision: 5, scale: 4 }),
  minPeriodOverride: integer("min_period_override"),
  issuedBy: text("issued_by").notNull(),
  disbursementSource: depositLocationEnum("disbursement_source").notNull(),
  loanType: loanTypeEnum("loan_type").notNull().default("perpetual"),
  termMonths: integer("term_months"),
  penaltyMultiplier: numeric("penalty_multiplier", { precision: 5, scale: 4 }).notNull().default("0.1000"),
  penaltyWaived: boolean("penalty_waived").notNull().default(false),
  penaltyWaivedBy: text("penalty_waived_by"),
  penaltyWaivedAt: timestamp("penalty_waived_at", { withTimezone: true }),
  rolledOverFrom: uuid("rolled_over_from").references((): any => loans.id),
  rolloverAmount: numeric("rollover_amount", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("idx_loans_customer_id").on(table.customerId),
])
