import { execFile } from "node:child_process"
import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"
import { verifyHistoricalRateBackup } from "./historical-rate-backup"
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from "./rollover-snapshot-guard"

const execFileAsync = promisify(execFile)

/** Additional catalog gate for the portfolio repair's durable approval and run data. */
export function portfolioAccrualDataInCatalog(catalog: string): boolean {
  const names = ["portfolio_accrual_repair_approvals", "portfolio_accrual_repair_runs"]
  const lines = catalog.split(/\r?\n/)
  return names.every((name) => lines.some((line) =>
    new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE public ${name}(?:\\s|$)`).test(line)) &&
    lines.some((line) =>
      new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE DATA public ${name}(?:\\s|$)`).test(line)))
}

type RestoreIdentity = { dumpSha256: string; sourceHost: string; sourceDatabase: string }

export function isIsolatedPortfolioRehearsalDatabase(
  primaryText: string, directText: string,
): boolean {
  try {
    const primary = new URL(primaryText)
    const direct = new URL(directText)
    return ["localhost", "127.0.0.1", "::1"].includes(primary.hostname) &&
      primary.toString() === direct.toString() &&
      /^money_lending_rehearsal_[a-z0-9_]+$/.test(
        decodeURIComponent(primary.pathname.slice(1)))
  } catch { return false }
}

/** A proof is valid only for this archive and a fresh isolated local restore. */
export function validPortfolioRestoreProof(
  value: unknown, expected: RestoreIdentity, now = Date.now(),
): boolean {
  if (!value || typeof value !== "object") return false
  const proof = value as Record<string, unknown>
  const restoredAt = Date.parse(String(proof.restoredAt))
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.sourceHost === expected.sourceHost &&
    proof.sourceDatabase === expected.sourceDatabase &&
    typeof proof.restoredDatabase === "string" &&
    /^money_lending_rehearsal_[a-z0-9_]+$/.test(proof.restoredDatabase) &&
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
  gate: Parameters<typeof verifyHistoricalRateBackup>[0],
  exactPlan?: { planHash: string; asOf: Date },
): ReturnType<typeof verifyHistoricalRateBackup> {
  const verified = await verifyHistoricalRateBackup(gate)
  const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>
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
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl)
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as unknown
  if (!validPortfolioRestoreProof(proof, {
    dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
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
