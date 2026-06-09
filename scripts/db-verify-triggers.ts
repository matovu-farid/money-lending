// scripts/db-verify-triggers.ts
//
// Deploy-time assertion that the loan_balances projection layer exists.
// Runs after `drizzle-kit migrate` in postbuild.
//
// What we check (must all be present, or we exit non-zero and fail the build):
//   - function   refresh_loan_balance(uuid)
//   - function   on_transactions_change_for_loan_balance()
//   - function   on_payments_change_for_loan_balance()
//   - trigger    trg_transactions_loan_balance on transactions
//   - trigger    trg_payments_loan_balance     on payments
//
// Why this exists: drizzle-kit migrate runs each numbered migration exactly
// once per env, so it cannot self-heal if something external drops the
// triggers (which has happened — see commit a4b7fb9). This script is the
// cheap insurance — every deploy verifies the invariant and screams if it's
// gone.

import postgres from "postgres"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("[db:verify-triggers] DATABASE_URL is required")
  process.exit(1)
}

const EXPECTED_FUNCTIONS = [
  "refresh_loan_balance",
  "on_transactions_change_for_loan_balance",
  "on_payments_change_for_loan_balance",
]

const EXPECTED_TRIGGERS = [
  { name: "trg_transactions_loan_balance", table: "transactions" },
  { name: "trg_payments_loan_balance", table: "payments" },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const fnRows = await sql<{ proname: string }[]>`
      select proname from pg_proc
      where proname = any(${EXPECTED_FUNCTIONS})
    `
    const presentFns = new Set(fnRows.map((r) => r.proname))
    const missingFns = EXPECTED_FUNCTIONS.filter((f) => !presentFns.has(f))

    const triggerRows = await sql<{ tgname: string; relname: string }[]>`
      select t.tgname, c.relname
      from pg_trigger t
      join pg_class c on t.tgrelid = c.oid
      where not t.tgisinternal
        and t.tgname = any(${EXPECTED_TRIGGERS.map((e) => e.name)})
    `
    const presentTriggers = new Set(
      triggerRows.map((r) => `${r.tgname}@${r.relname}`),
    )
    const missingTriggers = EXPECTED_TRIGGERS.filter(
      (e) => !presentTriggers.has(`${e.name}@${e.table}`),
    )

    if (missingFns.length === 0 && missingTriggers.length === 0) {
      console.log(
        `[db:verify-triggers] OK — ${EXPECTED_FUNCTIONS.length} function(s) and ${EXPECTED_TRIGGERS.length} trigger(s) present`,
      )
      return
    }

    console.error("")
    console.error("╔══════════════════════════════════════════════════════════════════════╗")
    console.error("║  PROJECTION LAYER BROKEN — DEPLOY ABORTED                           ║")
    console.error("╚══════════════════════════════════════════════════════════════════════╝")
    if (missingFns.length > 0) {
      console.error(`Missing functions: ${missingFns.join(", ")}`)
    }
    if (missingTriggers.length > 0) {
      console.error(
        `Missing triggers:  ${missingTriggers.map((t) => `${t.name} on ${t.table}`).join(", ")}`,
      )
    }
    console.error("")
    console.error("Without these, loan_balances does not update on writes —")
    console.error("Principal Balance and Total Due will silently go wrong.")
    console.error("")
    console.error("Likely causes:")
    console.error("  - 0025_loan_balances_projection.sql failed to run")
    console.error("  - an external process dropped the triggers")
    console.error("")
    console.error("To repair: re-run the SQL in 0025_loan_balances_projection.sql")
    console.error("against the affected DB. The file is idempotent.")
    console.error("")
    process.exit(1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error("[db:verify-triggers] failed:", err)
  process.exit(1)
})
