/** Read-only, owner-private preview of exact fully-paid payment reallocation plans. */
import "dotenv/config"
import { open } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { correctionTempDirectory } from "@/lib/interest/rollover-snapshot-guard"
import { planFullyPaidAllocationRepair } from
  "@/lib/interest/fully-paid-allocation-repair"
import { loadFullyPaidAllocationSnapshot } from
  "@/services/payment-allocation-repair.service"

function option(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

async function main() {
  const allowed = new Set(["as-of", "output", "loan-id"])
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown payment allocation preview argument")
    }
  }
  const asOfText = option("as-of")
  const asOf = new Date(asOfText ?? "")
  const output = option("output")
  const loanId = option("loan-id")
  if (!asOfText || !Number.isFinite(asOf.getTime()) ||
      asOf.toISOString() !== asOfText || asOf > new Date() ||
      !output || resolve(output) !== output ||
      dirname(output) !== correctionTempDirectory || !output.endsWith(".json") ||
      loanId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(loanId)) {
    throw new Error("Canonical --as-of, owner-private --output and optional UUID --loan-id are required")
  }
  const url = new URL(process.env.DATABASE_URL ?? "")
  const report = await db.transaction(async (tx) => {
    const [identity] = await tx.execute<{ name: string }>(sql`SELECT current_database() AS name`)
    const rows = await tx.select({ id: loans.id }).from(loans)
      .where(and(isNull(loans.deletedAt), eq(loans.status, "fully_paid"),
        ...(loanId ? [eq(loans.id, loanId)] : []))).orderBy(loans.id)
    if (loanId && (rows.length !== 1 || rows[0].id !== loanId)) {
      throw new Error("Selected fully-paid loan was not found")
    }
    const plans = []
    for (const row of rows) {
      const source = await loadFullyPaidAllocationSnapshot(row.id, asOf, tx)
      plans.push(planFullyPaidAllocationRepair(source))
    }
    return { database: { host: url.hostname, name: identity.name },
      asOf: asOf.toISOString(), generatedAt: new Date().toISOString(), plans }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  const file = await open(output, "wx", 0o600)
  try { await file.writeFile(`${JSON.stringify(report, null, 2)}\n`) }
  finally { await file.close() }
  const counts = { ready: 0, noop: 0, blocked: 0 }
  for (const plan of report.plans) counts[plan.status] += 1
  console.log(JSON.stringify({ output, database: report.database,
    loans: report.plans.length, counts }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Payment allocation preview failed")
    process.exitCode = 1
  })
}
