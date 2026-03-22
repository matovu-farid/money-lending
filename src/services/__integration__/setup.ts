import "dotenv/config"
import { sql } from "drizzle-orm"

// Force test DB by setting CYPRESS=true BEFORE db/index.ts is imported
process.env.CYPRESS = "true"

if (!process.env.DATABASE_URL_TEST_UNPOOLED) {
  throw new Error(
    "DATABASE_URL_TEST_UNPOOLED must be set for integration tests"
  )
}

// Re-export the service's db — this ensures setup and services share
// the SAME connection pool, preventing data visibility issues.
// CYPRESS=true was set above, so this import gets the test DB connection.
import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"

export const testDb = db

/**
 * Truncates all application tables in a single TRUNCATE statement.
 * Hardcoded table list avoids the dynamic PL/pgSQL approach that
 * occasionally deadlocks on Neon's connection routing.
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
