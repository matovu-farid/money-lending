import { pgTable, uuid, numeric, timestamp, text, pgEnum } from "drizzle-orm/pg-core"

export const depositLocationEnum = pgEnum("deposit_location", [
  "cash",
  "bank",
  "strong_room",
])

export const transferTypeEnum = pgEnum("transfer_type", [
  "internal",
  "capital_injection",
])

export const fundTransfers = pgTable("fund_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferType: transferTypeEnum("transfer_type").default("internal").notNull(),
  fromLocation: depositLocationEnum("from_location"),
  toLocation: depositLocationEnum("to_location"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  transferredBy: text("transferred_by").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
