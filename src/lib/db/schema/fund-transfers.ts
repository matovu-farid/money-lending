import { pgTable, uuid, numeric, timestamp, text, pgEnum, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { bankAccounts } from "./bank-accounts"

export const depositLocationEnum = pgEnum("deposit_location", [
  "cash",
  "bank",
  "strong_room",
])

export const transferTypeEnum = pgEnum("transfer_type", [
  "internal",
  "capital_injection",
])

export const fundTransfers = pgTable(
  "fund_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferType: transferTypeEnum("transfer_type").default("internal").notNull(),
    fromLocation: depositLocationEnum("from_location"),
    toLocation: depositLocationEnum("to_location"),
    fromSubLocationId: uuid("from_sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
    toSubLocationId: uuid("to_sub_location_id").references(() => bankAccounts.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    transferredBy: text("transferred_by").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "fund_transfers_bank_requires_sub_location",
      sql`(${table.fromLocation} IS DISTINCT FROM 'bank' OR ${table.fromSubLocationId} IS NOT NULL)
       AND (${table.toLocation} IS DISTINCT FROM 'bank' OR ${table.toSubLocationId} IS NOT NULL)`,
    ),
    check("fund_transfers_amount_positive", sql`${table.amount} > 0`),
  ],
)
