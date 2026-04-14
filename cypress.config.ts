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
              DELETE FROM fund_transfers;
              DELETE FROM delegation;
              DELETE FROM rate_change_requests;
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
              SELECT id, customer_id, principal_amount, interest_rate, status, penalty_waived, penalty_multiplier
              FROM loans ORDER BY created_at DESC
            `
            return rows
          })
        },

        async "db:setPenaltyMultiplier"({ loanId, multiplier }: { loanId: string; multiplier: string }) {
          return withSql(async (sql) => {
            await sql`
              UPDATE loans SET penalty_multiplier = ${multiplier}
              WHERE id = ${loanId}
            `
            return null
          })
        },

        async "db:setLoanStartDate"({ loanId, startDate }: { loanId: string; startDate: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE loans SET start_date = ${startDate}::timestamptz WHERE id = ${loanId}`
            return null
          })
        },

        async "db:injectCapital"({ amount, location }: { amount: string; location?: string }) {
          return withSql(async (sql) => {
            const loc = location ?? "cash"
            const users = await sql`SELECT id FROM "user" LIMIT 1`
            const actorId = users[0]?.id
            if (!actorId) throw new Error("No users found")

            const transfers = await sql`
              INSERT INTO fund_transfers (transfer_type, from_location, to_location, amount, transferred_by)
              VALUES ('capital_injection', NULL, ${loc}, ${amount}, ${actorId})
              RETURNING id, created_at
            `
            const transfer = transfers[0]
            const journalGroupId = crypto.randomUUID()

            // Debit: Cash (asset) — money arrives at location
            let cashCats = await sql`SELECT id FROM transaction_categories WHERE name = 'Cash'`
            if (cashCats.length === 0) {
              cashCats = await sql`INSERT INTO transaction_categories (name, type) VALUES ('Cash', 'asset') RETURNING id`
            }
            await sql`
              INSERT INTO transactions (category_id, amount, type, description, transaction_date, recorded_by, reference_type, reference_id, deposit_location, journal_group_id)
              VALUES (${cashCats[0].id}, ${amount}, 'debit', 'Capital injection', ${transfer.created_at}, ${actorId}, 'capital_injection', ${transfer.id}, ${loc}, ${journalGroupId})
            `

            // Credit: Share Capital (equity)
            let eqCats = await sql`SELECT id FROM transaction_categories WHERE name = 'Share Capital'`
            if (eqCats.length === 0) {
              eqCats = await sql`INSERT INTO transaction_categories (name, type) VALUES ('Share Capital', 'equity') RETURNING id`
            }
            await sql`
              INSERT INTO transactions (category_id, amount, type, description, transaction_date, recorded_by, reference_type, reference_id, journal_group_id)
              VALUES (${eqCats[0].id}, ${amount}, 'credit', 'Capital injection', ${transfer.created_at}, ${actorId}, 'capital_injection', ${transfer.id}, ${journalGroupId})
            `

            return null
          })
        },

        async "auth:createUser"({ name, email, role }: { name: string; email?: string; role: string }) {
          const userEmail = email ?? `${role.toLowerCase()}-${Date.now()}@fidexa.org`
          const res = await fetch("http://localhost:3000/api/test/create-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email: userEmail, role }),
          })
          if (!res.ok) throw new Error(`Failed to create user: ${await res.text()}`)
          return res.json()
        },

        async "db:seedCustomerAndLoan"({
          customerName,
          contact,
          nin,
          principalAmount,
          issuedBy,
        }: {
          customerName: string
          contact: string
          nin: string
          principalAmount: string
          issuedBy: string
        }) {
          return withSql(async (sql) => {
            const customers = await sql`
              INSERT INTO customers (full_name, nin, contact, address, status)
              VALUES (${customerName}, ${nin}, ${contact}, 'Kampala, Uganda', 'active')
              RETURNING id
            `
            const customerId = customers[0].id

            // Seed collateral nature if not exists
            const loans = await sql`
              INSERT INTO loans (
                customer_id, principal_amount, issuance_fee, interest_rate,
                min_interest_days, start_date, status, issued_by, disbursement_source, loan_type
              )
              VALUES (
                ${customerId}, ${principalAmount}, '50000', '0.1000',
                30, NOW(), 'active', ${issuedBy}, 'cash', 'perpetual'
              )
              RETURNING id
            `
            const loanId = loans[0].id

            // Insert collateral
            await sql`
              INSERT INTO collateral (loan_id, nature, description)
              VALUES (${loanId}, 'Land Title', 'Plot 42, Nakawa')
            `

            return { customerId, loanId }
          })
        },

        async "db:seedPayment"({
          loanId,
          amount,
          recordedBy,
        }: {
          loanId: string
          amount: string
          recordedBy: string
        }) {
          return withSql(async (sql) => {
            const rows = await sql`
              INSERT INTO payments (loan_id, amount, payment_date, recorded_by, deposit_location)
              VALUES (${loanId}, ${amount}, NOW(), ${recordedBy}, 'cash')
              RETURNING id
            `
            return { paymentId: rows[0].id }
          })
        },

        async "db:getPayments"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, loan_id, amount, payment_date, recorded_by, deleted_at
              FROM payments ORDER BY created_at DESC
            `
            return rows
          })
        },
      })
    },
  },
})
