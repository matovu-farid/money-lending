import { pgTable, uuid, numeric, integer, timestamp, text, pgEnum, index, boolean, check, type AnyPgColumn } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { customers } from "./customers"
import { depositLocationEnum } from "./fund-transfers"
import { bankAccounts } from "./bank-accounts"

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
  subLocationId: uuid("sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
  loanType: loanTypeEnum("loan_type").notNull().default("perpetual"),
  termMonths: integer("term_months"),
  penaltyMultiplier: numeric("penalty_multiplier", { precision: 5, scale: 4 }).notNull().default("0.1000"),
  penaltyWaived: boolean("penalty_waived").notNull().default(false),
  penaltyWaivedBy: text("penalty_waived_by"),
  penaltyWaivedAt: timestamp("penalty_waived_at", { withTimezone: true }),
  // Self-referential FK: the column type can't be inferred from inside its own
  // table declaration, so drizzle ships `AnyPgColumn` as the canonical escape
  // hatch — preferable to `any` because the column-ness is preserved.
  rolledOverFrom: uuid("rolled_over_from").references((): AnyPgColumn => loans.id),
  rolloverAmount: numeric("rollover_amount", { precision: 15, scale: 2 }),
  backdatedFrom: timestamp("backdated_from", { withTimezone: true }),
  backdatedBy: text("backdated_by"),
  backdatedAt: timestamp("backdated_at", { withTimezone: true }),
  backdateNote: text("backdate_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("idx_loans_customer_id").on(table.customerId),
  index("idx_loans_status").on(table.status),
  index("idx_loans_active").on(table.customerId, table.status).where(sql`deleted_at IS NULL`),
  check(
    "loans_bank_requires_sub_location",
    sql`${table.disbursementSource} <> 'bank' OR ${table.subLocationId} IS NOT NULL`,
  ),
  check("loans_principal_positive", sql`${table.principalAmount} > 0`),
  check("loans_issuance_fee_nonneg", sql`${table.issuanceFee} >= 0`),
  check(
    "loans_rollover_amount_nonneg",
    sql`${table.rolloverAmount} IS NULL OR ${table.rolloverAmount} >= 0`,
  ),
])
