/** Bind exact local apply rehearsal results to one restored production archive. */
import "dotenv/config"
import { lstat, open, readFile } from "node:fs/promises"
import { verifyPortfolioAccrualBackup, validPortfolioPlanProof,
  validPortfolioRestoreProof } from "@/lib/interest/portfolio-accrual-backup"
import { validateCorrectionDatabaseEndpoints } from
  "@/lib/interest/rollover-snapshot-guard"

function option(name: string): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  if (!value) throw new Error(`--${name} is required`)
  return value.slice(name.length + 3)
}

async function ownerOnlyJson(path: string): Promise<Record<string, unknown>> {
  const file = await lstat(path)
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Reviewed proof inputs must be owner-only regular files")
  }
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

async function main() {
  const manifestPath = option("backup-manifest")
  const manifest = await ownerOnlyJson(manifestPath)
  const gate = { manifestPath, expectedDumpSha256: String(manifest.dumpSha256),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "" }
  const verified = await verifyPortfolioAccrualBackup(gate)
  const restore = await ownerOnlyJson(`${verified.dumpPath}.restore.json`)
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl)
  if (!validPortfolioRestoreProof(restore, { dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)) })) {
    throw new Error("Source archive has no matching restore proof")
  }
  const report = await ownerOnlyJson(option("source-report"))
  const result = await ownerOnlyJson(option("apply-result"))
  const reportDatabase = report.database as { host?: string; name?: string } | undefined
  if (reportDatabase?.name !== decodeURIComponent(backup.pathname.slice(1)) ||
      reportDatabase.host?.replace("-pooler.", ".") !== backup.hostname) {
    throw new Error("Reviewed source report belongs to another database")
  }
  const plans = report.plans
  const applied = result.applied
  if (!Array.isArray(plans) || !Array.isArray(applied) ||
      result.database !== restore.restoredDatabase ||
      result.asOf !== report.asOf ||
      result.unchangedCashLoansPaymentsSnapshots !== true) {
    throw new Error("Rehearsal result does not match the restored source report")
  }
  const ready = plans.filter((plan) => plan && typeof plan === "object" &&
    (plan as Record<string, unknown>).classification === "ready") as
    Array<{ loanId: string; planHash: string }>
  const expectedPairs = ready.map((row) => `${row.loanId}:${row.planHash}`).sort()
  const actualPairs = applied.map((row) => {
    if (!row || typeof row !== "object") throw new Error("Malformed rehearsal result")
    const item = row as Record<string, unknown>
    return `${item.loanId}:${item.planHash}`
  }).sort()
  if (ready.length === 0 || result.count !== ready.length ||
      JSON.stringify(expectedPairs) !== JSON.stringify(actualPairs)) {
    throw new Error("Not every exact ready production plan was rehearsed")
  }
  const proof = { dumpSha256: verified.dumpSha256,
    restoredDatabase: restore.restoredDatabase,
    asOf: report.asOf, planHashes: ready.map((row) => row.planHash).sort(),
    completedAt: new Date().toISOString(), unchangedCashLoansPaymentsSnapshots: true }
  if (proof.planHashes.some((hash) => !validPortfolioPlanProof(proof, {
    dumpSha256: verified.dumpSha256,
    restoredDatabase: String(restore.restoredDatabase),
    planHash: hash, asOf: String(report.asOf),
  }))) {
    throw new Error("Exact-plan proof is invalid")
  }
  const path = `${verified.dumpPath}.plans.json`
  const file = await open(path, "wx", 0o600)
  try { await file.writeFile(`${JSON.stringify(proof, null, 2)}\n`) }
  finally { await file.close() }
  console.log(JSON.stringify({ planProof: path, rehearsedPlans: ready.length,
    dumpSha256: verified.dumpSha256 }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Plan proof failed")
  process.exitCode = 1
})
