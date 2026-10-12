/** Restore a verified full-data archive into a new isolated local database. */
import "dotenv/config"
import { execFileSync, spawnSync } from "node:child_process"
import { open, readFile } from "node:fs/promises"
import postgres from "postgres"
import { verifyHistoricalRateArchive } from "@/lib/interest/historical-rate-backup"
import { portfolioAccrualDataInCatalog, portfolioApplicationBuildSha256,
  portfolioSchemaSha256, validPortfolioRestoreProof } from
  "@/lib/interest/portfolio-accrual-backup"
import { validateCorrectionDatabaseEndpoints } from
  "@/lib/interest/rollover-snapshot-guard"

function option(name: string): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  if (!value) throw new Error(`--${name} is required`)
  return value.slice(name.length + 3)
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr ?? "").slice(0, 1200)}`)
  }
}

async function main() {
  const gate = {
    manifestPath: option("backup-manifest"),
    expectedDumpSha256: option("backup-sha256"),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "",
  }
  const verified = await verifyHistoricalRateArchive(gate)
  const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>
  if (manifest.portfolioAccrualAuditTablesInDump !== true) {
    throw new Error("Archive predates the portfolio repair tables")
  }
  const catalog = execFileSync("pg_restore", ["--list", verified.dumpPath],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  if (!portfolioAccrualDataInCatalog(catalog)) {
    throw new Error("Archive lacks the portfolio repair tables and data")
  }
  const local = new URL(process.env.DATABASE_URL_TEST ?? "")
  if (!["localhost", "127.0.0.1", "::1"].includes(local.hostname) ||
      decodeURIComponent(local.pathname.slice(1)) !== "money_lending") {
    throw new Error("Rehearsal source must be the local money_lending database")
  }
  const databaseName = `money_lending_rehearsal_${verified.dumpSha256.slice(0, 12)}`
  const root = postgres(local.toString(), { max: 1 })
  try {
    const existing = await root`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`
    if (existing.length) throw new Error("The isolated rehearsal database already exists")
  } finally {
    await root.end()
  }
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: local.hostname, PGPORT: local.port || "5432",
    PGUSER: decodeURIComponent(local.username),
    PGPASSWORD: decodeURIComponent(local.password),
    PGDATABASE: "money_lending", PGSSLMODE: "disable",
  }
  delete env.PGSERVICE
  run("createdb", ["--no-password", "--template=template0", databaseName], env)
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error",
    `--dbname=${databaseName}`, verified.dumpPath], env)

  local.pathname = `/${databaseName}`
  const restored = postgres(local.toString(), { max: 1 })
  let counts: { loanRows: number; paymentRows: number;
    transactionRows: number; snapshotRows: number; auditTablesPresent: boolean }
  try {
    const [row] = await restored<{
      loan_rows: number; payment_rows: number; transaction_rows: number;
      snapshot_rows: number; approvals_table: string | null; runs_table: string | null;
      agent_reviews_table: string | null
    }[]>`SELECT
      (SELECT count(*)::int FROM loans) AS loan_rows,
      (SELECT count(*)::int FROM payments) AS payment_rows,
      (SELECT count(*)::int FROM transactions) AS transaction_rows,
      (SELECT count(*)::int FROM financial_snapshots) AS snapshot_rows,
      to_regclass('public.portfolio_accrual_repair_approvals')::text AS approvals_table,
      to_regclass('public.portfolio_accrual_repair_runs')::text AS runs_table,
      to_regclass('public.financial_correction_agent_reviews')::text AS agent_reviews_table`
    counts = { loanRows: row.loan_rows, paymentRows: row.payment_rows,
      transactionRows: row.transaction_rows, snapshotRows: row.snapshot_rows,
      auditTablesPresent: !!row.approvals_table && !!row.runs_table &&
        !!row.agent_reviews_table }
  } finally {
    await restored.end()
  }
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl)
  const [applicationBuildSha256, schemaSha256] = await Promise.all([
    portfolioApplicationBuildSha256(), portfolioSchemaSha256(local.toString()),
  ])
  const proof = { dumpSha256: verified.dumpSha256, sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
    restoredDatabase: databaseName, restoredAt: new Date().toISOString(),
    applicationBuildSha256, schemaSha256, ...counts }
  if (!validPortfolioRestoreProof(proof, proof)) {
    throw new Error("Restored database did not pass the portfolio proof checks")
  }
  const proofPath = `${verified.dumpPath}.restore.json`
  const file = await open(proofPath, "wx", 0o600)
  try { await file.writeFile(`${JSON.stringify(proof, null, 2)}\n`) }
  finally { await file.close() }
  console.log(JSON.stringify({ proofPath, restoredDatabase: databaseName, ...counts }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Restore rehearsal failed")
  process.exitCode = 1
})
