import { pgTable, uuid, text, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core"

export const notificationTypeEnum = pgEnum("notification_type", [
  "loan_due_soon",
  "chat_mention",
])

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
