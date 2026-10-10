/** Read-only inventory of applied loan-rate audits. There is no repair mode. */
import "dotenv/config"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import {
  summarizeRateCorrectionInventory,
  type RateCorrectionInventoryRow,
} from "../src/lib/interest/rate-correction-inventory"

function option(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  if (process.argv.some((argument) => argument === "--apply" || argument.startsWith("--apply="))) {
    throw new Error("This inventory is read-only; --apply is unavailable")
  }
  const urlText = process.env.DATABASE_URL
  if (!urlText) throw new Error("DATABASE_URL is required")
  const url = new URL(urlText)
  const expectedHost = option("expect-host")
  const expectedDatabase = option("expect-database")
  if (!expectedHost || !expectedDatabase ||
      url.hostname !== expectedHost ||
      decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Explicit --expect-host and --expect-database must match DATABASE_URL")
  }

  const client = postgres(urlText, { max: 1 })
  const db = drizzle(client)
  try {
    const report = await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`)
      const [identity] = await tx.execute(sql`SELECT current_database() AS name`)
      if (identity?.name !== expectedDatabase) {
        throw new Error("Connected database identity does not match the requested database")
      }
      const rows = await tx.execute(sql`
        SELECT a.entity_id AS "loanId", l.start_date AS "startDate",
               l.status AS status, a.action AS action, a.after_value AS "afterValue",
               EXISTS (SELECT 1 FROM payments p WHERE p.loan_id = l.id) AS "paymentRecorded",
               EXISTS (SELECT 1 FROM loan_waivers w WHERE w.loan_id = l.id) AS "waiverRecorded",
               EXISTS (SELECT 1 FROM loans successor WHERE successor.rolled_over_from = l.id) AS "successorRecorded"
        FROM audit_log a
        JOIN loans l ON l.id::text = a.entity_id
        WHERE a.entity_type = 'loan'
          AND a.action IN (
            'loan.rate_change.immediate', 'loan.rate_change.approved',
            'loan.rate_change.admin_adjusted', 'loan.update'
          )
      `)
      const [orphan] = await tx.execute(sql`
        SELECT COUNT(*)::integer AS count
        FROM audit_log a
        LEFT JOIN loans l ON l.id::text = a.entity_id
        WHERE a.entity_type = 'loan' AND l.id IS NULL
          AND a.action IN (
            'loan.rate_change.immediate', 'loan.rate_change.approved',
            'loan.rate_change.admin_adjusted', 'loan.update'
          )
      `)
      return {
        summary: summarizeRateCorrectionInventory(rows as unknown as RateCorrectionInventoryRow[]),
        orphanAuditRows: Number(orphan?.count ?? 0),
      }
    })
    console.log(JSON.stringify({
      databaseHost: expectedHost,
      databaseName: expectedDatabase,
      ...report,
    }, null, 2))
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Rate inventory failed")
  process.exitCode = 1
})
