import "dotenv/config"
import { sql } from "drizzle-orm"

// Re-export the service's db — this ensures setup and services share
// the SAME connection pool, preventing data visibility issues.
import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"

export const testDb = db

/**
 * Truncates all application tables in a single TRUNCATE statement,
 * then seeds test users so audit log FK constraints are satisfied.
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
      loan_waivers,
      payments,
      collateral,
      loans,
      audit_log,
      customers,
      system_settings,
      verification,
      account,
      session,
      "user"
    CASCADE
  `)
  // Seed test users — required by audit_log FK on actor_id → user.id
  await seedTestUser()
}

/**
 * Seeds a test user so audit log FK constraints are satisfied.
 * Call after resetDb() — must run before any service that writes audit logs.
 */
export async function seedTestUser() {
  await db.insert(schema.user).values([
    { id: "test-actor", name: "Test Actor", email: "test-actor@test.local", emailVerified: true },
    { id: "integration-test-actor", name: "Integration Actor", email: "integration@test.local", emailVerified: true },
    { id: "fuzz-test-actor", name: "Fuzz Actor", email: "fuzz@test.local", emailVerified: true },
    { id: "actor-1", name: "Actor One", email: "actor-1@test.local", emailVerified: true },
    { id: "admin-1", name: "Admin One", email: "admin-1@test.local", emailVerified: true },
    { id: "admin-2", name: "Admin Two", email: "admin-2@test.local", emailVerified: true },
    { id: "admin-3", name: "Admin Three", email: "admin-3@test.local", emailVerified: true },
    { id: "admin-5", name: "Admin Five", email: "admin-5@test.local", emailVerified: true },
  ]).onConflictDoNothing()
}

/**
 * Seeds the transaction categories needed for auto-posting.
 * Call after resetDb() in tests that exercise payment/creditor flows.
 */
export async function seedCategories() {
  await db.insert(schema.transactionCategories).values([
    { name: "Interest Earned", type: "revenue" as const, isDefault: true },
    { name: "Interest Receivable", type: "revenue" as const, isDefault: true },
    { name: "Loans Receivable", type: "asset" as const, isDefault: true },
    { name: "Loan Losses", type: "expense" as const, isDefault: true },
    { name: "Cash", type: "asset" as const, isDefault: true },
    { name: "Interest Payments", type: "expense" as const, isDefault: true },
    { name: "Share Capital", type: "equity" as const, isDefault: true },
  ])
}
