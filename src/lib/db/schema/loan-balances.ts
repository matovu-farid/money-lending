import { pgTable, uuid, numeric, timestamp } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const loanBalances = pgTable("loan_balances", {
  loanId: uuid("loan_id")
    .primaryKey()
    .references(() => loans.id, { onDelete: "cascade" }),
  outstandingBalance: numeric("outstanding_balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  unpaidInterest: numeric("unpaid_interest", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
