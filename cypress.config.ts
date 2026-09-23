import "dotenv/config"
import { defineConfig } from "cypress"
import postgres, { type Sql } from "postgres"

const DB_URL = process.env.DATABASE_URL_TEST ?? "postgres://localhost:5432/money_lending"
// Neon DB is what the dev server uses when not running with CYPRESS=true.
// Tasks that need to seed/query the same DB the server reads must use this URL.
const NEON_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? DB_URL

function freshSql(): Sql {
  return postgres(DB_URL, { max: 1 })
}

function freshNeonSql(): Sql {
  return postgres(NEON_URL, { max: 1, ssl: NEON_URL.includes("neon.tech") ? "require" : false })
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

async function withNeonSql<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = freshNeonSql()
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
    pageLoadTimeout: 120000,
    setupNodeEvents(on, config) {
      const appBaseUrl = config.baseUrl ?? "http://localhost:3000"
      on("task", {
        async "db:reset"() {
          await withSql(async (sql) => {
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
              DELETE FROM ip_block_log;
              DELETE FROM admin_ip_allowlist;
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
              DELETE FROM invitation;
              DELETE FROM "user";
            `)
          })
          // Flush in-memory IP allowlist caches in both module contexts so a
          // stale toggle/IP value from a previous test can't leak across resets.
          // Best-effort — never throw if the dev server isn't reachable.
          await Promise.allSettled([
            fetch(new URL("/api/test/clear-ip-cache", appBaseUrl), { method: "POST", signal: AbortSignal.timeout(3000) }),
            fetch(new URL("/_test/clear-ip-middleware-cache", appBaseUrl), { method: "POST", signal: AbortSignal.timeout(3000) }),
          ])
          return null
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

        async "db:seedBalanceRoundingCase"() {
          return withSql(async (sql) => {
            const users = await sql`SELECT id FROM "user" LIMIT 1`
            const actorId = users[0]?.id
            if (!actorId) throw new Error("No users found")

            let cashCats = await sql`SELECT id FROM transaction_categories WHERE name = 'Cash'`
            if (cashCats.length === 0) {
              cashCats = await sql`INSERT INTO transaction_categories (name, type) VALUES ('Cash', 'asset') RETURNING id`
            }

            await sql`
              INSERT INTO transactions (category_id, amount, type, description, transaction_date, recorded_by, deposit_location)
              VALUES (${cashCats[0].id}, '0.01', 'debit', 'Balance rounding test', NOW(), ${actorId}, 'cash')
            `

            return null
          })
        },

        async "auth:createUser"({ name, email, role }: { name: string; email?: string; role: string }) {
          const userEmail = email ?? `${role.toLowerCase()}-${Date.now()}@fidexa.org`
          const res = await fetch(new URL("/api/test/create-user", appBaseUrl), {
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

        async "db:seedWeeklyReportsFixture"() {
          return withSql(async (sql) => {
            const users = await sql`SELECT id FROM "user" ORDER BY created_at LIMIT 1`
            const actorId = users[0]?.id
            if (!actorId) throw new Error("No users found")

            const week = "2026-09-21"
            const categories: Record<string, string> = {}
            for (const [name, type] of [["Cash", "asset"], ["Loans Receivable", "asset"], ["Interest Earned", "revenue"]] as const) {
              const existing = await sql`SELECT id FROM transaction_categories WHERE name = ${name} AND type = ${type}`
              const [category] = existing.length
                ? existing
                : await sql`INSERT INTO transaction_categories (name, type) VALUES (${name}, ${type}) RETURNING id`
              categories[name] = category.id
            }
            const makeLoan = async (name: string, startDate: string, principal: string, status = "active", deleted = false) => {
              const [customer] = await sql`
                INSERT INTO customers (full_name, nin, contact, address, status)
                VALUES (${name}, ${`NIN-${name}`}, ${`07${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`}, 'Kampala, Uganda', 'active')
                RETURNING id
              `
              const [loan] = await sql`
                INSERT INTO loans (customer_id, principal_amount, issuance_fee, interest_rate, min_interest_days,
                  start_date, status, issued_by, disbursement_source, loan_type, deleted_at)
                VALUES (${customer.id}, ${principal}, '0', '0.1000', 30, ${startDate}::timestamptz,
                  ${status}::loan_status, ${actorId}, 'cash', 'perpetual',
                  ${deleted ? "2026-09-23T12:00:00+03:00" : null}::timestamptz)
                RETURNING id
              `
              const disbursementGroup = crypto.randomUUID()
              await sql`
                INSERT INTO transactions (type, amount, category_id, reference_type, reference_id, loan_id, description, transaction_date, recorded_by, journal_group_id)
                VALUES ('debit', ${principal}, ${categories["Loans Receivable"]}, 'loan', ${loan.id}, ${loan.id}, 'Fixture principal disbursement', ${startDate}::timestamptz, ${actorId}, ${disbursementGroup})
              `
              await sql`
                INSERT INTO transactions (type, amount, category_id, reference_type, reference_id, loan_id, description, transaction_date, recorded_by, deposit_location, journal_group_id)
                VALUES ('credit', ${principal}, ${categories.Cash}, 'loan', ${loan.id}, ${loan.id}, 'Fixture cash disbursement', ${startDate}::timestamptz, ${actorId}, 'cash', ${disbursementGroup})
              `
              return { id: loan.id as string, customerName: name }
            }

            const loanA = await makeLoan("Weekly Report Loan A", "2026-09-22T10:00:00+03:00", "300000")
            const loanB = await makeLoan("Weekly Report Loan B", "2026-09-10T10:00:00+03:00", "500000")
            const pendingLoan = await makeLoan("Weekly Report Pending", "2026-09-22T10:00:00+03:00", "900000", "pending")
            const deletedLoan = await makeLoan("Weekly Report Deleted", "2026-09-22T10:00:00+03:00", "1000000", "active", true)
            const boundaryLoan = await makeLoan("Weekly Report Boundary", "2026-09-10T10:00:00+03:00", "100000")

            const addPayment = async (loanId: string, name: string, paymentDate: string, amount: string, interest: string, principal: string, options: { wrong?: boolean; deleted?: boolean } = {}) => {
              const [payment] = await sql`
                INSERT INTO payments (loan_id, amount, payment_date, recorded_by, deposit_location, marked_wrong, deleted_at)
                VALUES (${loanId}, ${amount}, ${paymentDate}::timestamptz, ${actorId}, 'cash', ${!!options.wrong}, ${options.deleted ? "2026-09-23T12:00:00+03:00" : null}::timestamptz)
                RETURNING id
              `
              // Wrong/deleted payments have no active journal effect after the
              // normal reversal flow, so exclude their entries from this fixture.
              if (options.wrong || options.deleted) return payment.id as string
              const post = async (categoryName: string, categoryId: string, part: string, type: "debit" | "credit") => {
                if (Number(part) <= 0) return
                const group = crypto.randomUUID()
                const cashIsDebit = type === "debit"
                const debitId = cashIsDebit ? categories.Cash : categoryId
                const creditId = cashIsDebit ? categoryId : categories.Cash
                await sql`
                  INSERT INTO transactions (type, amount, category_id, reference_type, reference_id, loan_id, description, transaction_date, recorded_by, deposit_location, journal_group_id)
                  VALUES ('debit', ${part}, ${debitId}, 'payment', ${payment.id}, ${loanId}, ${`Fixture payment ${name} ${categoryName}`}, ${paymentDate}::timestamptz, ${actorId}, 'cash', ${group}),
                         ('credit', ${part}, ${creditId}, 'payment', ${payment.id}, ${loanId}, ${`Fixture payment ${name} ${categoryName}`}, ${paymentDate}::timestamptz, ${actorId}, 'cash', ${group})
                `
              }
              await post("interest", categories["Interest Earned"], interest, "debit")
              await post("principal", categories["Loans Receivable"], principal, "debit")
              return payment.id as string
            }

            const priorPaymentId = await addPayment(loanB.id, "Loan B prior-week payment", "2026-09-14T10:00:00+03:00", "50000", "6666.67", "43333.33")
            const loanAPaymentId = await addPayment(loanA.id, "Loan A current-week payment", "2026-09-23T10:00:00+03:00", "50000", "1000", "49000")
            const loanBPaymentId = await addPayment(loanB.id, "Loan B current-week payment", "2026-09-23T11:00:00+03:00", "60000", "18666.67", "41333.33")
            await addPayment(pendingLoan.id, "pending excluded", "2026-09-23T12:00:00+03:00", "1000", "0", "1000")
            await addPayment(deletedLoan.id, "deleted loan excluded", "2026-09-23T12:00:00+03:00", "1000", "0", "1000")
            const wrongId = await addPayment(loanA.id, "marked wrong excluded", "2026-09-23T13:00:00+03:00", "1000", "0", "1000", { wrong: true })
            const deletedPaymentId = await addPayment(loanA.id, "deleted payment excluded", "2026-09-23T14:00:00+03:00", "1000", "0", "1000", { deleted: true })
            const boundaryPaymentId = await addPayment(boundaryLoan.id, "next week boundary", "2026-09-28T00:00:00+03:00", "1000", "0", "1000")
            return { week, loanAId: loanA.id, loanBId: loanB.id, priorPaymentId, loanAPaymentId, loanBPaymentId, wrongId, deletedPaymentId, boundaryPaymentId }
          })
        },

        async "db:changeWeeklyReportLedger"({ paymentId }: { paymentId: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              WITH allocation_groups AS (
                SELECT t.journal_group_id,
                       (CASE WHEN c.name = 'Loans Receivable' THEN '47000.00' ELSE '3000.00' END)::numeric AS new_amount
                FROM transactions t
                JOIN transaction_categories c ON c.id = t.category_id
                WHERE t.reference_type = 'payment'
                  AND t.reference_id = ${paymentId}
                  AND c.name IN ('Loans Receivable', 'Interest Earned')
                  AND t.type = 'credit'
              )
              UPDATE transactions t SET amount = g.new_amount
              FROM allocation_groups g
              WHERE t.journal_group_id = g.journal_group_id
              RETURNING t.amount
            `
            if (rows.length !== 4) throw new Error("Expected balanced Loan A interest and principal journal pairs to change")
            return rows[0].amount
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

        async "db:getPaymentTransactions"({ paymentId }: { paymentId: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT
                t.amount,
                t.type,
                t.reference_type,
                tc.name AS category_name
              FROM transactions t
              JOIN transaction_categories tc ON tc.id = t.category_id
              WHERE t.reference_id = ${paymentId}
              ORDER BY t.created_at ASC
            `
            return rows
          })
        },

        // Mark a loan (and all its payments) as soft-deleted by stamping
        // `deleted_at`. Mirrors what loanService.deleteLoan does in production
        // — no ledger reversal here; the test only needs the UI-side effect.
        async "db:softDeleteLoan"({ loanId }: { loanId: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE loans SET deleted_at = NOW() WHERE id = ${loanId}`
            await sql`UPDATE payments SET deleted_at = NOW() WHERE loan_id = ${loanId}`
            return null
          })
        },

        // Mark only a payment as soft-deleted — used to verify the
        // payment-history table filter independently from the loan filter.
        async "db:softDeletePayment"({ paymentId }: { paymentId: string }) {
          return withSql(async (sql) => {
            await sql`UPDATE payments SET deleted_at = NOW() WHERE id = ${paymentId}`
            return null
          })
        },

        async "db:getInvitations"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, email, name, role, status, token, expires_at, created_at
              FROM invitation ORDER BY created_at DESC
            `
            return rows
          })
        },

        async "db:getInviteUrl"({ email }: { email: string }) {
          // Read invite URL from temp file written by invitation.service.ts in test mode
          const fs = await import("fs")
          const filePath = `/tmp/invite-url-${email}`
          try {
            const url = fs.readFileSync(filePath, "utf-8").trim()
            return url || null
          } catch {
            return null
          }
        },

        async "db:cleanInvitations"() {
          return withSql(async (sql) => {
            await sql`DELETE FROM invitation`
            return null
          })
        },

        // ── Neon-backed tasks ──────────────────────────────────────────────
        // These tasks connect to the same DB the dev server uses (DATABASE_URL_UNPOOLED).
        // Use them when the dev server is NOT running with CYPRESS=true, so
        // the test DB and app DB are the same Neon instance.

        async "db:neon:seedCustomerAndLoan"({
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
          return withNeonSql(async (sql) => {
            const customers = await sql`
              INSERT INTO customers (full_name, nin, contact, address, status)
              VALUES (${customerName}, ${nin}, ${contact}, 'Kampala, Uganda', 'active')
              RETURNING id
            `
            const customerId = customers[0].id

            const loans = await sql`
              INSERT INTO loans (
                customer_id, principal_amount, issuance_fee, interest_rate,
                min_interest_days, start_date, status, issued_by, disbursement_source, loan_type
              )
              VALUES (
                ${customerId}, ${principalAmount}, '50000', '0.1000',
                30, CURRENT_DATE, 'active', ${issuedBy}, 'cash', 'perpetual'
              )
              RETURNING id
            `
            const loanId = loans[0].id

            // Insert collateral
            await sql`
              INSERT INTO collateral (loan_id, nature, description)
              VALUES (${loanId}, 'Land Title', 'Plot 42, Nakawa')
            `

            // Insert Loans Receivable debit transaction so loan_balances trigger fires
            let lrCats = await sql`SELECT id FROM transaction_categories WHERE name = 'Loans Receivable'`
            if (lrCats.length === 0) {
              lrCats = await sql`INSERT INTO transaction_categories (name, type) VALUES ('Loans Receivable', 'asset') RETURNING id`
            }
            const journalGroupId = crypto.randomUUID()
            await sql`
              INSERT INTO transactions (category_id, loan_id, amount, type, description, transaction_date, recorded_by, reference_type, reference_id, journal_group_id)
              VALUES (${lrCats[0].id}, ${loanId}, ${principalAmount}, 'debit', 'Loan disbursement', CURRENT_DATE, ${issuedBy}, 'loan', ${loanId}, ${journalGroupId})
            `

            return { customerId, loanId }
          })
        },

        async "db:neon:getLoanBalance"({ loanId }: { loanId: string }) {
          return withNeonSql(async (sql) => {
            const rows = await sql`
              SELECT outstanding_balance, unpaid_interest, last_payment_date
              FROM loan_balances WHERE loan_id = ${loanId}
            `
            return rows[0] ?? null
          })
        },

        async "db:neon:postLoansReceivableCredit"({
          loanId,
          amount,
        }: {
          loanId: string
          amount: string
        }) {
          return withNeonSql(async (sql) => {
            const users = await sql`SELECT id FROM "user" LIMIT 1`
            const actorId = users[0]?.id ?? "test-actor"
            let lrCats = await sql`SELECT id FROM transaction_categories WHERE name = 'Loans Receivable'`
            if (lrCats.length === 0) {
              lrCats = await sql`INSERT INTO transaction_categories (name, type) VALUES ('Loans Receivable', 'asset') RETURNING id`
            }
            const journalGroupId = crypto.randomUUID()
            await sql`
              INSERT INTO transactions (category_id, loan_id, amount, type, description, transaction_date, recorded_by, reference_type, reference_id, journal_group_id)
              VALUES (${lrCats[0].id}, ${loanId}, ${amount}, 'credit', 'Test credit', NOW(), ${actorId}, 'test', ${loanId}, ${journalGroupId})
            `
            return null
          })
        },

        async "db:neon:cleanupTestLoan"({ loanId }: { loanId: string }) {
          return withNeonSql(async (sql) => {
            // Delete in dependency order
            await sql`DELETE FROM transactions WHERE loan_id = ${loanId}`
            await sql`DELETE FROM payments WHERE loan_id = ${loanId}`
            await sql`DELETE FROM collateral WHERE loan_id = ${loanId}`
            const loanRows = await sql`SELECT customer_id FROM loans WHERE id = ${loanId}`
            await sql`DELETE FROM loans WHERE id = ${loanId}`
            if (loanRows.length > 0) {
              await sql`DELETE FROM customers WHERE id = ${loanRows[0].customer_id}`
            }
            return null
          })
        },

        async "db:setIpAllowlistEnabled"({ enabled }: { enabled: boolean }) {
          return withSql(async (sql) => {
            const value = enabled ? "true" : "false"
            await sql`
              INSERT INTO system_settings ("key", "value")
              VALUES ('ip_allowlist_enabled', ${value})
              ON CONFLICT ("key") DO UPDATE SET "value" = ${value}, "updated_at" = now()
            `
            return null
          })
        },

        async "db:seedAllowlistEntry"({ userId, ip }: { userId: string; ip: string }) {
          return withSql(async (sql) => {
            await sql`
              INSERT INTO admin_ip_allowlist ("user_id", "ip", "last_seen_at")
              VALUES (${userId}, ${ip}, now())
              ON CONFLICT ("user_id", "ip") DO UPDATE SET "last_seen_at" = now()
            `
            return null
          })
        },

        async "db:clearAllowlist"() {
          return withSql(async (sql) => {
            await sql`DELETE FROM admin_ip_allowlist`
            await sql`DELETE FROM ip_block_log`
            return null
          })
        },

        async "db:countAllowlistFor"({ userId }: { userId: string }) {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT count(*)::int AS n FROM admin_ip_allowlist WHERE "user_id" = ${userId}
            `
            return rows[0]?.n ?? 0
          })
        },

        async "ip:clearCaches"() {
          // Clear both the route-handler module cache and the middleware module cache.
          // They run in separate module contexts so each needs its own flush.
          const [routeRes, middlewareRes] = await Promise.all([
            fetch(new URL("/api/test/clear-ip-cache", appBaseUrl), { method: "POST" }),
            fetch(new URL("/_test/clear-ip-middleware-cache", appBaseUrl), { method: "POST" }),
          ])
          if (!routeRes.ok) throw new Error(`Failed to clear route IP caches: ${await routeRes.text()}`)
          if (!middlewareRes.ok) throw new Error(`Failed to clear middleware IP caches: ${await middlewareRes.text()}`)
          return null
        },
      })
    },
  },
})
