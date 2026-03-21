import { pgTable, uuid, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const notificationTypeEnum = pgEnum("notification_type", [
  "loan_due_soon",
])

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
