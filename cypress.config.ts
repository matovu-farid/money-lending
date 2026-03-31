import "dotenv/config"
import { defineConfig } from "cypress"
import postgres, { type Sql } from "postgres"

const DB_URL = process.env.DATABASE_URL_TEST ?? "postgres://localhost:5432/money_lending"

function freshSql(): Sql {
  return postgres(DB_URL, { max: 1 })
}

/** Run a callback with a disposable connection that is always closed afterwards. */
async function withSql<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = freshSql()
  try {
    return await fn(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    setupNodeEvents(on) {
      on("task", {
        async "db:reset"() {
          return withSql(async (sql) => {
            await sql.unsafe(`
              DELETE FROM financial_snapshots;
              DELETE FROM transactions;
              DELETE FROM transaction_categories;
              DELETE FROM creditor_repayments;
              DELETE FROM creditor_investments;
              DELETE FROM creditors;
              DELETE FROM session;
              DELETE FROM account;
              DELETE FROM verification;
              DELETE FROM audit_log;
              DELETE FROM notifications;
              DELETE FROM payments;
              DELETE FROM collateral;
              DELETE FROM loans;
              DELETE FROM customers;
              DELETE FROM system_settings;
              DELETE FROM "user";
            `)
            return null
          })
        },

        async "db:getUserRole"({ email }: { email: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT role, email_verified FROM "user"
              WHERE email = ${email}
            `
            if (rows.length === 0) return null
            return { role: rows[0].role, emailVerified: rows[0].email_verified }
          })
        },

        async "db:promoteUser"({ email, role }: { email: string; role: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE "user" SET role = ${role}, email_verified = true WHERE email = ${email}`
            // Invalidate sessions so the user picks up the new role
            const users = await sql`SELECT id FROM "user" WHERE email = ${email}`
            for (const u of users) {
              await sql`DELETE FROM session WHERE user_id = ${u.id}`
            }
            return null
          })
        },

        async "db:promoteUserKeepSession"({ email, role }: { email: string; role: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE "user" SET role = ${role}, email_verified = true WHERE email = ${email}`
            return null
          })
        },

        async "db:getCustomers"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, full_name, contact, address, status FROM customers
              ORDER BY created_at DESC
            `
            return rows
          })
        },

        async "db:getLoans"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, customer_id, principal_amount, interest_rate, status
              FROM loans ORDER BY created_at DESC
            `
            return rows
          })
        },
      })
    },
  },
})
