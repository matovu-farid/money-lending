import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { user } from "./auth"

export const invitations = pgTable(
  "invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
  },
  (table) => [
    index("invitation_email_idx").on(table.email),
    index("invitation_token_idx").on(table.token),
    index("invitation_status_idx").on(table.status),
    uniqueIndex("invitation_email_pending_idx")
      .on(table.email)
      .where(sql`status = 'pending'`),
  ],
)

export const invitationRelations = relations(invitations, ({ one }) => ({
  inviter: one(user, {
    fields: [invitations.invitedBy],
    references: [user.id],
  }),
}))
