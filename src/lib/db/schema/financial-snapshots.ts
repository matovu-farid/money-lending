import { pgTable, uuid, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core"

export const financialSnapshots = pgTable("financial_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  data: jsonb("data").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  generatedBy: text("generated_by").notNull(),
}, (table) => [
  unique("uq_snapshots_type_period").on(table.type, table.periodStart),
])
