import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"

export const creditors = pgTable("creditors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
