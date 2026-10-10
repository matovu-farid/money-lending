/** Explicit, backup-gated one-account install or one-approved-loan apply. */
import "dotenv/config"
import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from
  "@/lib/interest/rollover-snapshot-guard"
import { verifyPortfolioAccrualBackup } from
  "@/lib/interest/portfolio-accrual-backup"
import { installInterestReceivableAsset } from
  "@/services/interest-receivable-install.service"
import { loadPortfolioAccrualPlan } from
  "@/services/portfolio-accrual-repair.service"
import { applyPortfolioAccrualRepair } from
  "@/services/portfolio-accrual-repair-apply.service"

const allowed = new Set(["mode", "expect-host", "expect-database", "backup-manifest",
  "backup-sha256", "report", "loan-id", "actor-id"])

function option(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function privateReport(path: string | undefined): Promise<{
  database: { host: string; name: string }
  asOf: string
  plans: Array<{ loanId: string; planHash: string; inputFingerprint: string;
    policyVersion: string; classification: string }>
}> {
  if (!path) throw new Error("Exact private portfolio preview report is required")
  const canonical = resolve(path)
  if (canonical !== path || dirname(canonical) !== correctionTempDirectory ||
      !canonical.endsWith(".json")) {
    throw new Error(`Report must be an absolute JSON file directly under ${correctionTempDirectory}`)
  }
  const file = await lstat(canonical)
  if (!file.isFile() || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Reviewed report must be an owner-only regular file")
  }
  return JSON.parse(await readFile(canonical, "utf8"))
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown portfolio accrual operator argument")
    }
  }
  const mode = option("mode")
  if (mode !== "install-account" && mode !== "apply-loan") {
    throw new Error("Explicit install-account or apply-loan mode is required")
  }
  const { primary, backup } = validateCorrectionDatabaseEndpoints(
    process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED)
  const expectedHost = option("expect-host")
  const expectedDatabase = option("expect-database")
  if (!expectedHost || !expectedDatabase || primary.hostname !== expectedHost ||
      decodeURIComponent(primary.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Explicit database identity does not match the selected target")
  }
  const identity = await db.execute(sql`SELECT current_database() AS name, current_user AS role`)
  if (identity[0]?.name !== expectedDatabase ||
      identity[0]?.role !== decodeURIComponent(primary.username)) {
    throw new Error("Connected database identity changed")
  }
  const manifestPath = option("backup-manifest")
  const expectedDumpSha256 = option("backup-sha256")
  if (!manifestPath || !expectedDumpSha256 ||
      backup.hostname === primary.hostname && primary.hostname.includes("-pooler.")) {
    throw new Error("A verified direct-endpoint backup manifest and checksum are required")
  }
  const gate = { manifestPath, expectedDumpSha256,
    primaryUrl: process.env.DATABASE_URL!, directUrl: process.env.DATABASE_URL_UNPOOLED! }
  await verifyPortfolioAccrualBackup(gate)

  if (mode === "install-account") {
    if (option("loan-id") || option("report") || option("actor-id")) {
      throw new Error("Account installation accepts no loan or actor arguments")
    }
    const result = await installInterestReceivableAsset()
    console.log(JSON.stringify({ mode, database: expectedDatabase,
      categoryId: result.id, created: result.created }))
    return
  }
  const loanId = option("loan-id")
  const actorId = option("actor-id")
  if (!loanId || !/^[a-f0-9-]{36}$/i.test(loanId) || !actorId) {
    throw new Error("One exact loan and applying administrator are required")
  }
  const report = await privateReport(option("report"))
  if (report.database?.host !== expectedHost || report.database?.name !== expectedDatabase) {
    throw new Error("Reviewed report belongs to a different database")
  }
  const matching = report.plans.filter((plan) => plan.loanId === loanId)
  if (matching.length !== 1 || matching[0].classification !== "ready") {
    throw new Error("Reviewed report has no single ready plan for this loan")
  }
  const asOf = new Date(report.asOf)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== report.asOf ||
      asOf > new Date()) throw new Error("Reviewed report as-of instant is invalid")
  const current = await loadPortfolioAccrualPlan(loanId, asOf)
  if (current.classification !== "ready" ||
      current.planHash !== matching[0].planHash ||
      current.inputFingerprint !== matching[0].inputFingerprint ||
      current.policyVersion !== matching[0].policyVersion) {
    throw new Error("Reviewed loan plan changed; generate a fresh preview")
  }
  const result = await applyPortfolioAccrualRepair(current, actorId, gate)
  console.log(JSON.stringify({ mode, loanId, planHash: current.planHash, ...result }))
}

main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Portfolio accrual operator failed")
  process.exit(1)
})
