import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core"

export const customerStatusEnum = pgEnum("customer_status", [
  "active",
  "blacklisted",
  "inactive",
])

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  nin: text("nin").notNull(),
  contact: text("contact").notNull(),
  address: text("address").notNull(),
  status: customerStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
