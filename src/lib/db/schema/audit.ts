import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_audit_entity_type").on(table.entityType),
  index("idx_audit_occurred_at").on(table.occurredAt),
  index("idx_audit_actor_id").on(table.actorId),
])
