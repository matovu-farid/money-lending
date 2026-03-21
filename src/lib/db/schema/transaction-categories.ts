import { pgTable, uuid, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core"

export const categoryTypeEnum = pgEnum("category_type", ["expense", "income"])

export const transactionCategories = pgTable("transaction_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: categoryTypeEnum("type").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
