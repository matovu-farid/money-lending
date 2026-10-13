import "dotenv/config"
import { open } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import BigNumber from "bignumber.js"
import { and, inArray, isNull, sql } from "drizzle-orm"
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

export function parseLoanSelection(args: string[]): string[] | null {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const arg of args) {
    if (!arg.startsWith("--loan-id")) continue
    const id = arg.startsWith("--loan-id=") ? arg.slice("--loan-id=".length) : ""
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      throw new Error("Each --loan-id must be a canonical UUID")
    }
    const normalized = id.toLowerCase()
    if (seen.has(normalized)) throw new Error(`Duplicate --loan-id ${normalized}`)
    seen.add(normalized)
    ids.push(normalized)
  }
  return ids.length ? ids.sort() : null
}

export function assertCompleteLoanSelection(
  selectedIds: string[], rowIds: string[], planIds?: string[],
): void {
  const expected = new Set(selectedIds)
  const found = new Set(rowIds)
  if (found.size !== rowIds.length || rowIds.some((id) => !expected.has(id))) {
    throw new Error("Loan selection returned an unexpected or duplicate source loan")
  }
  if (selectedIds.some((id) => !found.has(id))) {
    throw new Error("One or more selected loan IDs were not found")
  }
  if (!planIds) return
  const planned = new Set(planIds)
  if (planned.size !== planIds.length || planIds.length !== selectedIds.length ||
      planIds.some((id) => !expected.has(id)) ||
      selectedIds.some((id) => !planned.has(id))) {
    throw new Error("One or more selected loan plans are missing or unexpected")
  }
}

export function buildPreviewResult<
  P extends { classification: "ready" | "noop" | "blocked";
    entries: Array<{ period: string; delta: string }> },
  R extends { period: string; eligible: boolean },
>(report: {
  database: { host: string; name: string }
  asOf: string
  generatedAt: string
  plans: P[]
  snapshotReadiness: R[]
}, selectedIds: string[] | null) {
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
  return { ...report,
    ...(selectedIds ? {
      scope: { kind: "selected_loans" as const, loanIds: selectedIds,
        savedSnapshotPeriods: "not_assessed" as const },
      snapshotReadiness: [] as R[],
    } : {}),
    summary: {
      totalLoans: report.plans.length, counts,
      savedPeriodsEligibleToRestate: selectedIds ? [] :
        report.snapshotReadiness.filter((row) => row.eligible).map((row) => row.period),
      periodIncomeAndAssetDeltas: Object.fromEntries([...periodTotals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, total]) => [period, total.toFixed(2)])),
    },
  }
}

async function main() {
  const selectedIds = parseLoanSelection(process.argv.slice(2))
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
      .where(selectedIds
        ? and(isNull(loans.deletedAt), inArray(loans.id, selectedIds))
        : isNull(loans.deletedAt)).orderBy(loans.id)
    if (selectedIds) assertCompleteLoanSelection(selectedIds, loanRows.map((loan) => loan.id))
    const plans: PortfolioAccrualPlan[] = []
    for (const loan of loanRows) {
      plans.push(await loadPortfolioAccrualPlan(loan.id, asOf, tx))
    }
    if (selectedIds) assertCompleteLoanSelection(selectedIds, loanRows.map((loan) => loan.id),
      plans.map((plan) => plan.loanId))
    type SnapshotReadiness = { period: string; savedTypes: string[] } &
      ReturnType<typeof assessPortfolioSnapshotPeriod>
    let snapshotReadiness: SnapshotReadiness[] = []
    if (!selectedIds) {
      const savedSnapshots = await tx.select({ type: financialSnapshots.type,
        periodStart: financialSnapshots.periodStart,
        periodEnd: financialSnapshots.periodEnd })
        .from(financialSnapshots)
      const periods = [...new Set(savedSnapshots.map((row) => row.periodStart.toISOString().slice(0, 7)))]
        .sort()
      snapshotReadiness = periods.map((period) => {
        const rows = savedSnapshots.filter((row) => row.periodStart.toISOString().startsWith(period))
        const periodEnd = rows[0].periodEnd
        const assessment = assessPortfolioSnapshotPeriod(periodEnd,
          loanRows.map((loan, index) => ({ ...loan, plan: plans[index] })))
        return { period, savedTypes: rows.map((row) => row.type).sort(), ...assessment }
      })
    }
    return { database: { host: url.hostname, name: identity.name },
      asOf: asOf.toISOString(), generatedAt: new Date().toISOString(),
      plans, snapshotReadiness }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  const result = buildPreviewResult(report, selectedIds)
  const file = await open(output, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await file.close()
  }
  console.log(JSON.stringify({ output, database: result.database,
    ...(selectedIds ? { scope: result.scope } : {}), ...result.summary }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
