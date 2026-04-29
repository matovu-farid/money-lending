// scripts/audit-bank-sub-location.ts
// Finds rows where deposit/disbursement location = 'bank' but sub_location_id
// is NULL across transactions, payments, loans, fund_transfers (both sides).
//
// Usage: pnpm tsx scripts/audit-bank-sub-location.ts
// Exit code 0 if no orphans; 1 if any orphans found.

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

async function main() {
  const queries = [
    {
      label: "transactions (deposit_location='bank', sub_location_id IS NULL)",
      sql: sql`SELECT id, type, amount, category_id, reference_type, reference_id, transaction_date
               FROM transactions
               WHERE deposit_location = 'bank' AND sub_location_id IS NULL
               ORDER BY transaction_date DESC`,
    },
    {
      label: "payments (deposit_location='bank', sub_location_id IS NULL)",
      sql: sql`SELECT id, loan_id, amount, payment_date
               FROM payments
               WHERE deposit_location = 'bank' AND sub_location_id IS NULL
               ORDER BY payment_date DESC`,
    },
    {
      label: "loans (disbursement_source='bank', sub_location_id IS NULL)",
      sql: sql`SELECT id, customer_id, principal_amount, start_date
               FROM loans
               WHERE disbursement_source = 'bank' AND sub_location_id IS NULL
               ORDER BY start_date DESC`,
    },
    {
      label: "fund_transfers from-side (from_location='bank', from_sub_location_id IS NULL)",
      sql: sql`SELECT id, transfer_type, amount, created_at
               FROM fund_transfers
               WHERE from_location = 'bank' AND from_sub_location_id IS NULL
               ORDER BY created_at DESC`,
    },
    {
      label: "fund_transfers to-side (to_location='bank', to_sub_location_id IS NULL)",
      sql: sql`SELECT id, transfer_type, amount, created_at
               FROM fund_transfers
               WHERE to_location = 'bank' AND to_sub_location_id IS NULL
               ORDER BY created_at DESC`,
    },
  ]

  let totalOrphans = 0
  for (const q of queries) {
    const rows = (await db.execute(q.sql)) as unknown as Record<string, unknown>[]
    console.log(`\n=== ${q.label} ===`)
    console.log(`count: ${rows.length}`)
    if (rows.length > 0) {
      console.table(rows.slice(0, 20))
      if (rows.length > 20) console.log(`... and ${rows.length - 20} more`)
    }
    totalOrphans += rows.length
  }

  console.log(`\nTotal orphan rows: ${totalOrphans}`)
  process.exit(totalOrphans > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
