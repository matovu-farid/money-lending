import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
})
