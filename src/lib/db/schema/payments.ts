import { pgTable, uuid, numeric, timestamp, text, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
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
  editReason: text("edit_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_payments_active_date")
    .on(table.paymentDate)
    .where(sql`deleted_at IS NULL`),
])
