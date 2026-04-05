import "dotenv/config"
import { sql } from "drizzle-orm"

// Re-export the service's db — this ensures setup and services share
// the SAME connection pool, preventing data visibility issues.
import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"

export const testDb = db

/**
 * Truncates all application tables in a single TRUNCATE statement.
 */
export async function resetDb() {
  await db.execute(sql`
    TRUNCATE TABLE
      transactions,
      transaction_categories,
      financial_snapshots,
      creditor_repayments,
      creditor_investments,
      creditors,
      payments,
      collateral,
      loans,
      audit_log,
      message_attachments,
      messages,
      conversation_participants,
      conversations,
      notifications,
      customers,
      system_settings,
      verification,
      account,
      session,
      "user"
    CASCADE
  `)
}

/**
 * Seeds the transaction categories needed for auto-posting.
 * Call after resetDb() in tests that exercise payment/creditor flows.
 */
export async function seedCategories() {
  await db.insert(schema.transactionCategories).values([
    { name: "Interest Earned", type: "income", isDefault: true },
    { name: "Interest Payments", type: "expense", isDefault: true },
    { name: "Share Capital", type: "income", isDefault: true },
  ])
}
