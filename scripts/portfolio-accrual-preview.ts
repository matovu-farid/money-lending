import "dotenv/config"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import BigNumber from "bignumber.js"
import { isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"
import { assessPortfolioSnapshotPeriod } from "@/lib/interest/portfolio-accrual-snapshot"
import type { PortfolioAccrualPlan } from "@/lib/interest/portfolio-accrual-repair"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"

function option(name: string): string {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`${name}=`))
  if (!argument) throw new Error(`Required option ${name}=... is missing`)
  return argument.slice(name.length + 1)
}

async function main() {
  const asOf = new Date(option("--as-of"))
  const output = option("--output")
  if (!Number.isFinite(asOf.getTime()) || !isAbsolute(output)) {
    throw new Error("A valid --as-of instant and absolute --output path are required")
  }
  if (process.argv.slice(2).some((value) => value.includes("--apply"))) {
    throw new Error("The portfolio preview has no write mode")
  }
  const url = new URL(process.env.DATABASE_URL ?? "")
  const report = await db.transaction(async (tx) => {
    const [identity] = await tx.execute<{ name: string }>(sql`SELECT current_database() AS name`)
    const loanRows = await tx.select({ id: loans.id, startDate: loans.startDate }).from(loans)
      .where(isNull(loans.deletedAt)).orderBy(loans.id)
    const plans: PortfolioAccrualPlan[] = []
    for (const loan of loanRows) {
      plans.push(await loadPortfolioAccrualPlan(loan.id, asOf, tx))
    }
    const savedSnapshots = await tx.select({ type: financialSnapshots.type,
      periodStart: financialSnapshots.periodStart,
      periodEnd: financialSnapshots.periodEnd })
      .from(financialSnapshots)
    const periods = [...new Set(savedSnapshots.map((row) => row.periodStart.toISOString().slice(0, 7)))]
      .sort()
    const snapshotReadiness = periods.map((period) => {
      const rows = savedSnapshots.filter((row) => row.periodStart.toISOString().startsWith(period))
      const periodEnd = rows[0].periodEnd
      const assessment = assessPortfolioSnapshotPeriod(periodEnd,
        loanRows.map((loan, index) => ({ ...loan, plan: plans[index] })))
      return { period, savedTypes: rows.map((row) => row.type).sort(), ...assessment }
    })
    return { database: { host: url.hostname, name: identity.name },
      asOf: asOf.toISOString(), generatedAt: new Date().toISOString(),
      plans, snapshotReadiness }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  const counts = { ready: 0, noop: 0, blocked: 0 }
  const periodTotals = new Map<string, BigNumber>()
  for (const plan of report.plans) {
    counts[plan.classification] += 1
    if (plan.classification !== "ready") continue
    for (const entry of plan.entries) {
      periodTotals.set(entry.period,
        (periodTotals.get(entry.period) ?? new BigNumber(0)).plus(entry.delta))
    }
  }
  const result = { ...report, summary: {
    totalLoans: report.plans.length, counts,
    savedPeriodsEligibleToRestate: report.snapshotReadiness.filter((row) => row.eligible)
      .map((row) => row.period),
    periodIncomeAndAssetDeltas: Object.fromEntries([...periodTotals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, total]) => [period, total.toFixed(2)])),
  } }
  const file = await open(output, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await file.close()
  }
  console.log(JSON.stringify({ output, database: result.database, ...result.summary }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
