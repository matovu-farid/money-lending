import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth"

export const delegations = pgTable(
  "delegation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delegatedBy: text("delegated_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("delegation_userId_idx").on(table.userId),
    index("delegation_active_idx").on(table.userId, table.revokedAt),
  ],
)

export const delegationRelations = relations(delegations, ({ one }) => ({
  user: one(user, { fields: [delegations.userId], references: [user.id], relationName: "delegationUser" }),
  delegator: one(user, { fields: [delegations.delegatedBy], references: [user.id], relationName: "delegationDelegator" }),
  revoker: one(user, { fields: [delegations.revokedBy], references: [user.id], relationName: "delegationRevoker" }),
}))
