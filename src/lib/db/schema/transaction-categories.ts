import { pgTable, uuid, text, timestamp, pgEnum, boolean, index } from "drizzle-orm/pg-core"

export const categoryTypeEnum = pgEnum("category_type", ["asset", "liability", "equity", "revenue", "expense"])

export const transactionCategories = pgTable("transaction_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: categoryTypeEnum("type").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_categories_name").on(table.name),
])
