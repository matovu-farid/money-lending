import { defineConfig } from "cypress"
import postgres, { type Sql } from "postgres"

const PGLITE_URL = "postgres://localhost:5488/postgres"

function freshSql(): Sql {
  return postgres(PGLITE_URL, { max: 1 })
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
    baseUrl: "http://localhost:3001",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    setupNodeEvents(on) {
      on("task", {
        async "db:reset"() {
          return withSql(async (sql) => {
            await sql.unsafe(`
              DELETE FROM test.financial_snapshots;
              DELETE FROM test.transactions;
              DELETE FROM test.transaction_categories;
              DELETE FROM test.creditor_repayments;
              DELETE FROM test.creditor_investments;
              DELETE FROM test.creditors;
              DELETE FROM test.session;
              DELETE FROM test.account;
              DELETE FROM test.verification;
              DELETE FROM test.audit_log;
              DELETE FROM test.notifications;
              DELETE FROM test.payments;
              DELETE FROM test.collateral;
              DELETE FROM test.loans;
              DELETE FROM test.customers;
              DELETE FROM test.system_settings;
              DELETE FROM test."user";
            `)
            return null
          })
        },

        async "db:getUserRole"({ email }: { email: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT role, email_verified FROM test."user"
              WHERE email = ${email}
            `
            if (rows.length === 0) return null
            return { role: rows[0].role, emailVerified: rows[0].email_verified }
          })
        },

        async "db:promoteUser"({ email, role }: { email: string; role: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE test."user" SET role = ${role}, email_verified = true WHERE email = ${email}`
            // Invalidate sessions so the user picks up the new role
            const users = await sql`SELECT id FROM test."user" WHERE email = ${email}`
            for (const u of users) {
              await sql`DELETE FROM test.session WHERE user_id = ${u.id}`
            }
            return null
          })
        },

        async "db:promoteUserKeepSession"({ email, role }: { email: string; role: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE test."user" SET role = ${role}, email_verified = true WHERE email = ${email}`
            return null
          })
        },

        async "db:getCustomers"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, full_name, contact, address, status FROM test.customers
              ORDER BY created_at DESC
            `
            return rows
          })
        },

        async "db:getLoans"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, customer_id, principal_amount, interest_rate, status
              FROM test.loans ORDER BY created_at DESC
            `
            return rows
          })
        },
      })
    },
  },
})
