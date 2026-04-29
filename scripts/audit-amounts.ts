// scripts/audit-amounts.ts
// Audits that monetary amounts are within expected bounds across tables.
// Usage: pnpm tsx scripts/audit-amounts.ts
// Exit code 0 if no violations; 1 if any.

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

async function main() {
  const checks = [
    { label: "transactions.amount <= 0",            sql: sql`SELECT count(*)::int AS n FROM transactions          WHERE amount <= 0` },
    { label: "payments.amount <= 0",                sql: sql`SELECT count(*)::int AS n FROM payments              WHERE amount <= 0` },
    { label: "loans.principal_amount <= 0",         sql: sql`SELECT count(*)::int AS n FROM loans                 WHERE principal_amount <= 0` },
    { label: "loans.issuance_fee < 0",              sql: sql`SELECT count(*)::int AS n FROM loans                 WHERE issuance_fee < 0` },
    { label: "loans.rollover_amount < 0",           sql: sql`SELECT count(*)::int AS n FROM loans                 WHERE rollover_amount IS NOT NULL AND rollover_amount < 0` },
    { label: "creditor_investments.amount <= 0",    sql: sql`SELECT count(*)::int AS n FROM creditor_investments  WHERE amount <= 0` },
    { label: "creditor_repayments.amount <= 0",     sql: sql`SELECT count(*)::int AS n FROM creditor_repayments   WHERE amount <= 0` },
    { label: "fund_transfers.amount <= 0",          sql: sql`SELECT count(*)::int AS n FROM fund_transfers        WHERE amount <= 0` },
  ]

  let bad = 0
  for (const c of checks) {
    const rows = (await db.execute(c.sql)) as unknown as { n: number }[]
    const n = Number(rows[0]?.n ?? 0)
    console.log(`  ${c.label}: ${n}`)
    bad += n
  }
  console.log(`\nTotal violations: ${bad}`)
  process.exit(bad > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
