/** Rehearse every exact ready plan on a local restored database, never production. */
import "dotenv/config"
import { open, readFile } from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema/auth"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"
import { approvePortfolioAccrualRepair, applyPortfolioAccrualRepair } from
  "@/services/portfolio-accrual-repair-apply.service"

function option(name: string): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  if (!value) throw new Error(`--${name} is required`)
  return value.slice(name.length + 3)
}

async function stateSignature() {
  const cashCategory = await db.select({ id: transactionCategories.id })
    .from(transactionCategories).where(eq(transactionCategories.name, "Cash"))
  if (cashCategory.length !== 1) throw new Error("Cash account is ambiguous")
  return JSON.stringify({
    loans: await db.select().from(loans),
    payments: await db.select().from(payments),
    cash: await db.select().from(transactions)
      .where(eq(transactions.categoryId, cashCategory[0].id)),
    snapshots: await db.select().from(financialSnapshots),
  })
}

async function main() {
  const selected = new URL(process.env.DATABASE_URL ?? "")
  const direct = new URL(process.env.DATABASE_URL_UNPOOLED ?? "")
  if (!["localhost", "127.0.0.1", "::1"].includes(selected.hostname) ||
      !/^money_lending_rehearsal_[a-z0-9_]+$/.test(selected.pathname.slice(1)) ||
      selected.toString() !== direct.toString()) {
    throw new Error("Exact-plan rehearsal is limited to one isolated local database")
  }
  const report = JSON.parse(await readFile(option("report"), "utf8")) as {
    asOf: string; plans: Array<{ loanId: string; classification: string;
      planHash: string; inputFingerprint: string; policyVersion: string }>
  }
  const manifestPath = option("backup-manifest")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { dumpSha256: string }
  const gate = { manifestPath, expectedDumpSha256: manifest.dumpSha256,
    primaryUrl: selected.toString(), directUrl: direct.toString() }
  const asOf = new Date(report.asOf)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== report.asOf) {
    throw new Error("Rehearsal report as-of is invalid")
  }
  const [actor] = (await db.select({ id: user.id, role: user.role }).from(user))
    .filter((row) => row.role === "admin" || row.role === "superAdmin")
  if (!actor) throw new Error("Restored database has no administrator")
  const before = await stateSignature()
  const ready = report.plans.filter((plan) => plan.classification === "ready")
  const applied: Array<{ loanId: string; planHash: string; runId: string }> = []
  for (const reviewed of ready) {
    const plan = await loadPortfolioAccrualPlan(reviewed.loanId, asOf)
    if (plan.classification !== "ready" || plan.planHash !== reviewed.planHash ||
        plan.inputFingerprint !== reviewed.inputFingerprint ||
        plan.policyVersion !== reviewed.policyVersion) {
      throw new Error(`Local exact plan changed for loan ${reviewed.loanId}`)
    }
    await approvePortfolioAccrualRepair(plan, actor.id,
      "Isolated exact-plan rehearsal after a verified full restore")
    const result = await applyPortfolioAccrualRepair(plan, actor.id, gate)
    if (result.alreadyApplied) throw new Error("Rehearsal encountered a prior repair run")
    const after = await loadPortfolioAccrualPlan(plan.loanId, asOf)
    if (after.classification !== "noop") {
      throw new Error(`Rehearsed loan ${plan.loanId} did not reconcile`)
    }
    applied.push({ loanId: plan.loanId, planHash: plan.planHash, runId: result.runId })
  }
  if (before !== await stateSignature()) {
    throw new Error("Rehearsal changed Cash, loans, payments, or saved snapshots")
  }
  const runs = await db.select({ id: portfolioAccrualRepairRuns.id })
    .from(portfolioAccrualRepairRuns)
    .where(inArray(portfolioAccrualRepairRuns.id, applied.map((row) => row.runId)))
  if (runs.length !== ready.length) throw new Error("Rehearsed run count did not match ready plans")
  const output = option("output")
  const file = await open(output, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify({ asOf: report.asOf, database: selected.pathname.slice(1),
      count: applied.length, unchangedCashLoansPaymentsSnapshots: true,
      applied }, null, 2)}\n`)
  } finally { await file.close() }
  console.log(JSON.stringify({ rehearsed: applied.length, unchangedCashLoansPaymentsSnapshots: true,
    report: output }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Exact-plan rehearsal failed")
  process.exitCode = 1
})
