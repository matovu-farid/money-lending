// scripts/backfill-bank-sub-location.ts
// One-shot: assigns sub_location_id to transactions/payments/loans/fund_transfers
// rows where the location is 'bank' but sub_location_id is NULL.
//
// If exactly one bank account exists, all orphans are tagged to that account.
// Otherwise the script aborts and prints the choices.
//
// Usage: pnpm tsx scripts/backfill-bank-sub-location.ts

import { db } from "@/lib/db"
import { bankAccounts } from "@/lib/db/schema/bank-accounts"
import { sql } from "drizzle-orm"

async function main() {
  const accounts = await db.select().from(bankAccounts)
  if (accounts.length === 0) {
    console.error("No bank accounts exist; cannot backfill.")
    process.exit(2)
  }
  if (accounts.length > 1) {
    console.error(
      `Multiple bank accounts exist (${accounts.length}); cannot pick automatically. Backfill by hand.`,
    )
    console.table(accounts)
    process.exit(2)
  }
  const target = accounts[0]
  console.log(`Backfilling all bank-but-no-subaccount rows to: ${target.name} (${target.id})`)

  const updates = [
    {
      label: "transactions",
      sql: sql`UPDATE transactions
               SET sub_location_id = ${target.id}
               WHERE deposit_location = 'bank' AND sub_location_id IS NULL`,
    },
    {
      label: "payments",
      sql: sql`UPDATE payments
               SET sub_location_id = ${target.id}
               WHERE deposit_location = 'bank' AND sub_location_id IS NULL`,
    },
    {
      label: "loans",
      sql: sql`UPDATE loans
               SET sub_location_id = ${target.id}
               WHERE disbursement_source = 'bank' AND sub_location_id IS NULL`,
    },
    {
      label: "fund_transfers from",
      sql: sql`UPDATE fund_transfers
               SET from_sub_location_id = ${target.id}
               WHERE from_location = 'bank' AND from_sub_location_id IS NULL`,
    },
    {
      label: "fund_transfers to",
      sql: sql`UPDATE fund_transfers
               SET to_sub_location_id = ${target.id}
               WHERE to_location = 'bank' AND to_sub_location_id IS NULL`,
    },
  ]

  for (const u of updates) {
    const result = (await db.execute(u.sql)) as unknown as { count?: number }
    console.log(`  ${u.label}: updated ${result.count ?? "?"} row(s)`)
  }
  console.log("Done.")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
