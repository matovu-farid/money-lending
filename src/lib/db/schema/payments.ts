import { pgTable, uuid, numeric, timestamp, text, boolean, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { loans } from "./loans"
import { depositLocationEnum } from "./fund-transfers"

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  depositLocation: depositLocationEnum("deposit_location").notNull(),
  editReason: text("edit_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  markedWrong: boolean("marked_wrong").default(false).notNull(),
  markedWrongReason: text("marked_wrong_reason"),
  markedWrongBy: text("marked_wrong_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_payments_active_date")
    .on(table.paymentDate)
    .where(sql`deleted_at IS NULL`),
  index("idx_payments_loan_id").on(table.loanId),
  index("idx_payments_loan_deleted")
    .on(table.loanId, table.paymentDate)
    .where(sql`deleted_at IS NULL`),
])
