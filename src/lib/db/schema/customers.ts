import { pgTable, uuid, text, timestamp, pgEnum, index, unique, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

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
}, (table) => [
  index("idx_customers_full_name").on(table.fullName),
  index("idx_customers_status").on(table.status),
  unique("uq_customers_nin").on(table.nin),
  uniqueIndex("uq_customers_contact")
    .on(table.contact)
    .where(sql`${table.contact} <> ''`),
])
