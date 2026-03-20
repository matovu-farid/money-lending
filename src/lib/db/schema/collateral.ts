import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const collateral = pgTable("collateral", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  nature: text("nature").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
