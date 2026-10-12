import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"
import postgres from "postgres"
import { verifyHistoricalRateArchive } from "./historical-rate-backup"
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from "./rollover-snapshot-guard"

const execFileAsync = promisify(execFile)

/** Additional catalog gate for durable correction reviews and run data. */
export function portfolioAccrualDataInCatalog(catalog: string): boolean {
  const names = ["portfolio_accrual_repair_approvals", "portfolio_accrual_repair_runs",
    "financial_correction_agent_reviews"]
  const lines = catalog.split(/\r?\n/)
  return names.every((name) => lines.some((line) =>
    new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE public ${name}(?:\\s|$)`).test(line)) &&
    lines.some((line) =>
      new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE DATA public ${name}(?:\\s|$)`).test(line)))
}

type RestoreIdentity = { dumpSha256: string; sourceHost: string; sourceDatabase: string }
type ApplicationIdentity = { applicationBuildSha256: string; schemaSha256: string }
type BackupGate = Parameters<typeof verifyHistoricalRateArchive>[0]

/** The archive source differs from the target only for an exact loopback restore. */
export function archiveGateForPortfolioVerification(
  gate: BackupGate, manifest: Record<string, unknown>,
): BackupGate {
  if (!isIsolatedPortfolioRehearsalDatabase(gate.primaryUrl, gate.directUrl)) return gate
  if (typeof manifest.sourceHost !== "string" ||
      typeof manifest.sourceDatabase !== "string" ||
      !/^[a-zA-Z0-9.\-[\]:]+$/.test(manifest.sourceHost) ||
      !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(manifest.sourceDatabase)) {
    throw new Error("Portfolio archive source identity is invalid")
  }
  const source = new URL("postgresql://archive-source@localhost/")
  source.hostname = manifest.sourceHost
  source.pathname = `/${encodeURIComponent(manifest.sourceDatabase)}`
  if (source.hostname !== manifest.sourceHost ||
      decodeURIComponent(source.pathname.slice(1)) !== manifest.sourceDatabase) {
    throw new Error("Portfolio archive source identity is invalid")
  }
  return { ...gate, primaryUrl: source.toString(), directUrl: source.toString() }
}

/** A clean checkout and its deployment have the same identity; local edits change it. */
export async function portfolioApplicationBuildSha256(): Promise<string> {
  const paths = ["src", "scripts", "drizzle", "package.json", "pnpm-lock.yaml",
    "next.config.ts"]
  let commit: string
  try {
    commit = (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim()
  } catch {
    commit = process.env.VERCEL_GIT_COMMIT_SHA ?? ""
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      throw new Error("Portfolio application build identity is unavailable")
    }
    return createHash("sha256").update(`git:${commit}`).digest("hex")
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Portfolio application Git commit is invalid")
  }
  const hash = createHash("sha256").update(`git:${commit}`)
  const { stdout: diff } = await execFileAsync("git", ["diff", "--binary", "HEAD", "--", ...paths],
    { maxBuffer: 32 * 1024 * 1024 })
  const { stdout: untracked } = await execFileAsync("git", ["ls-files", "--others",
    "--exclude-standard", "-z", "--", ...paths], { encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024 })
  hash.update(diff)
  // Include new correction source before it is committed, but do not bind a
  // production proof to unrelated local-only scripts or notes.
  const relevantUntracked = untracked.toString().split("\0").filter((path) =>
    /^(?:src\/.*\.(?:ts|tsx)|scripts\/[^/]+\.ts|drizzle\/.*\.(?:sql|json))$/.test(path))
  for (const path of relevantUntracked.sort()) {
    hash.update(path).update("\0").update(await readFile(path))
  }
  return hash.digest("hex")
}

/** Fingerprint the live public schema rather than trusting the archive catalog alone. */
export async function portfolioSchemaSha256(url: string): Promise<string> {
  const sql = postgres(url, { max: 1 })
  try {
    const columns = await sql`SELECT table_name, column_name, ordinal_position,
      data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`
    const indexes = await sql`SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename, indexname`
    const constraints = await sql`SELECT c.conrelid::regclass::text AS table_name,
      c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' ORDER BY table_name, c.conname`
    const triggers = await sql`SELECT t.tgrelid::regclass::text AS table_name,
      t.tgname, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY table_name, t.tgname`
    const functions = await sql`SELECT p.proname, p.oid::regprocedure::text AS signature,
      pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY signature`
    if (!columns.length || !indexes.length) throw new Error("Portfolio schema is empty")
    return createHash("sha256").update(JSON.stringify({ columns, indexes,
      constraints, triggers, functions })).digest("hex")
  } finally {
    await sql.end()
  }
}

export function isIsolatedPortfolioRehearsalDatabase(
  primaryText: string, directText: string,
): boolean {
  try {
    const primary = new URL(primaryText)
    const direct = new URL(directText)
    return ["localhost", "127.0.0.1", "[::1]"].includes(primary.hostname) &&
      primary.toString() === direct.toString() &&
      /^money_lending_rehearsal_[a-f0-9]{12}$/.test(
        decodeURIComponent(primary.pathname.slice(1)))
  } catch { return false }
}

/** A proof is valid only for this archive and a fresh isolated local restore. */
export function validPortfolioRestoreProof(
  value: unknown, expected: RestoreIdentity & Partial<ApplicationIdentity> & {
    restoredDatabase?: string
  }, now = Date.now(),
): boolean {
  if (!value || typeof value !== "object") return false
  const proof = value as Record<string, unknown>
  const restoredAt = Date.parse(String(proof.restoredAt))
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.sourceHost === expected.sourceHost &&
    proof.sourceDatabase === expected.sourceDatabase &&
    proof.restoredDatabase !== proof.sourceDatabase &&
    typeof proof.applicationBuildSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(proof.applicationBuildSha256) &&
    typeof proof.schemaSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(proof.schemaSha256) &&
    (expected.applicationBuildSha256 === undefined ||
      proof.applicationBuildSha256 === expected.applicationBuildSha256) &&
    (expected.schemaSha256 === undefined || proof.schemaSha256 === expected.schemaSha256) &&
    typeof proof.restoredDatabase === "string" &&
    /^money_lending_rehearsal_[a-z0-9_]+$/.test(proof.restoredDatabase) &&
    (expected.restoredDatabase === undefined ||
      proof.restoredDatabase === expected.restoredDatabase) &&
    proof.auditTablesPresent === true &&
    Number.isFinite(restoredAt) && restoredAt <= now &&
    now - restoredAt <= 24 * 60 * 60 * 1000 &&
    ["loanRows", "paymentRows", "transactionRows", "snapshotRows"].every((key) =>
      Number.isSafeInteger(proof[key]) && Number(proof[key]) > 0)
}

export function validPortfolioPlanProof(value: unknown, expected: Pick<RestoreIdentity, "dumpSha256"> & {
  restoredDatabase: string; planHash: string; asOf: string
}, now = Date.now()): boolean {
  if (!value || typeof value !== "object") return false
  const proof = value as Record<string, unknown>
  const completedAt = Date.parse(String(proof.completedAt))
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.restoredDatabase === expected.restoredDatabase &&
    proof.asOf === expected.asOf &&
    proof.unchangedCashLoansPaymentsSnapshots === true &&
    Array.isArray(proof.planHashes) && proof.planHashes.length > 0 &&
    proof.planHashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) &&
    proof.planHashes.includes(expected.planHash) &&
    Number.isFinite(completedAt) && completedAt <= now &&
    now - completedAt <= 24 * 60 * 60 * 1000
}

/** Verify the full existing ledger archive plus the new repair tables. */
export async function verifyPortfolioAccrualBackup(
  gate: BackupGate,
  exactPlan?: { planHash: string; asOf: Date },
): ReturnType<typeof verifyHistoricalRateArchive> {
  // This correction has its own source/build-bound restore proof and exact-plan
  // rehearsal. An unrelated historical-rate rehearsal is not a prerequisite.
  if (resolve(gate.manifestPath) !== gate.manifestPath ||
      dirname(gate.manifestPath) !== correctionTempDirectory ||
      !gate.manifestPath.endsWith(".dump.manifest.json")) {
    throw new Error("Portfolio archive manifest path is unsafe")
  }
  const manifestFile = await lstat(gate.manifestPath)
  if (!manifestFile.isFile() || !manifestFile.size ||
      (manifestFile.mode & 0o077) !== 0 ||
      (process.getuid && manifestFile.uid !== process.getuid())) {
    throw new Error("Portfolio archive manifest must be an owner-only regular file")
  }
  const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>
  const archiveGate = archiveGateForPortfolioVerification(gate, manifest)
  const verified = await verifyHistoricalRateArchive(archiveGate)
  if (manifest.portfolioAccrualAuditTablesInDump !== true) {
    throw new Error("Portfolio accrual backup manifest lacks repair audit tables")
  }
  const { stdout: catalog } = await execFileAsync("pg_restore", ["--list", verified.dumpPath], {
    maxBuffer: 10 * 1024 * 1024,
  })
  if (!portfolioAccrualDataInCatalog(catalog)) {
    throw new Error("Portfolio accrual backup lacks repair tables or data entries")
  }
  const proofPath = `${verified.dumpPath}.restore.json`
  if (resolve(proofPath) !== proofPath || dirname(proofPath) !== correctionTempDirectory) {
    throw new Error("Portfolio restore proof path is unsafe")
  }
  const file = await lstat(proofPath)
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Portfolio restore proof must be an owner-only regular file")
  }
  const { backup } = validateCorrectionDatabaseEndpoints(
    archiveGate.primaryUrl, archiveGate.directUrl)
  const isolated = isIsolatedPortfolioRehearsalDatabase(gate.primaryUrl, gate.directUrl)
  const restoredDatabase = isolated
    ? decodeURIComponent(new URL(gate.primaryUrl).pathname.slice(1)) : undefined
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as unknown
  const [applicationBuildSha256, schemaSha256] = await Promise.all([
    portfolioApplicationBuildSha256(), portfolioSchemaSha256(gate.primaryUrl),
  ])
  if (!validPortfolioRestoreProof(proof, {
    dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
    restoredDatabase,
    applicationBuildSha256, schemaSha256,
  })) {
    throw new Error("Portfolio restore rehearsal is absent, stale, or mismatched")
  }
  if (exactPlan) {
    const planProofPath = `${verified.dumpPath}.plans.json`
    if (resolve(planProofPath) !== planProofPath ||
        dirname(planProofPath) !== correctionTempDirectory) {
      throw new Error("Portfolio plan rehearsal path is unsafe")
    }
    const planFile = await lstat(planProofPath)
    if (!planFile.isFile() || !planFile.size || (planFile.mode & 0o077) !== 0 ||
        (process.getuid && planFile.uid !== process.getuid())) {
      throw new Error("Portfolio plan rehearsal must be an owner-only regular file")
    }
    const planProof = JSON.parse(await readFile(planProofPath, "utf8")) as unknown
    if (!validPortfolioPlanProof(planProof, {
      dumpSha256: verified.dumpSha256,
      restoredDatabase: String((proof as Record<string, unknown>).restoredDatabase),
      planHash: exactPlan.planHash, asOf: exactPlan.asOf.toISOString(),
    })) {
      throw new Error("Exact portfolio plan was not successfully rehearsed on this backup")
    }
  }
  return verified
}
