import { defineConfig } from "cypress"
import postgres from "postgres"
import dotenv from "dotenv"

dotenv.config()

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3001",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    setupNodeEvents(on) {
      const sql = postgres(process.env.DATABASE_URL_TEST_UNPOOLED!)

      on("task", {
        async "db:reset"() {
          await sql.unsafe(`
            DELETE FROM test.session;
            DELETE FROM test.account;
            DELETE FROM test.verification;
            DELETE FROM test.audit_log;
            DELETE FROM test.payments;
            DELETE FROM test.collateral;
            DELETE FROM test.loans;
            DELETE FROM test.customers;
            DELETE FROM test.system_settings;
            DELETE FROM test."user";
          `)
          return null
        },

        async "db:getUserRole"({ email }: { email: string }) {
          const rows = await sql`
            SELECT role, email_verified FROM test."user"
            WHERE email = ${email}
          `
          if (rows.length === 0) return null
          return { role: rows[0].role, emailVerified: rows[0].email_verified }
        },

        async "db:promoteUser"({ email, role }: { email: string; role: string }) {
          await sql`
            UPDATE test."user" SET role = ${role} WHERE email = ${email}
          `
          return null
        },

        async "db:getCustomers"() {
          const rows = await sql`
            SELECT id, full_name, contact, address, status FROM test.customers
            ORDER BY created_at DESC
          `
          return rows
        },

        async "db:getLoans"() {
          const rows = await sql`
            SELECT id, customer_id, principal_amount, interest_rate, status
            FROM test.loans ORDER BY created_at DESC
          `
          return rows
        },
      })
    },
  },
})
