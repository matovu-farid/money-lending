import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const adminIpAllowlist = pgTable(
  "admin_ip_allowlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("admin_ip_allowlist_user_ip_idx").on(t.userId, t.ip),
    index("admin_ip_allowlist_ip_idx").on(t.ip),
    index("admin_ip_allowlist_user_idx").on(t.userId),
  ],
)

export const ipBlockLog = pgTable(
  "ip_block_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
    path: text("path"),
  },
  (t) => [index("ip_block_log_attempted_at_idx").on(t.attemptedAt)],
)
