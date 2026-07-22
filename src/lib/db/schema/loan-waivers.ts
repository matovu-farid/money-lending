import {
  pgTable,
  uuid,
  numeric,
  timestamp,
  text,
  index,
  check,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { loans } from "./loans"
import { user } from "./auth"

export const loanWaivers = pgTable(
  "loan_waivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    waiverDate: timestamp("waiver_date", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_loan_waivers_loan_id").on(table.loanId),
    index("idx_loan_waivers_active_date")
      .on(table.loanId, table.waiverDate)
      .where(sql`deleted_at IS NULL`),
    check("loan_waivers_amount_positive", sql`${table.amount} > 0`),
  ],
)
