import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import BigNumber from "bignumber.js"
import postgres from "postgres"
import { verifyHistoricalRateArchive } from "@/lib/interest/historical-rate-backup"
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from
  "@/lib/interest/rollover-snapshot-guard"

export type DeletedRolloverBackupGate = Parameters<typeof verifyHistoricalRateArchive>[0]

export type DeletedRolloverRestoreIdentity = {
  dumpSha256: string
  sourceHost: string
  sourceDatabase: string
  predecessorId: string
  successorId: string
  planHash: string
  inputFingerprint: string
  reviewEvidenceSha256: string
  amount: string
  effectiveDate: string
  sourceGroupId: string
}

const sha256 = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

/** Exact, recent rehearsal result for one reviewed source and one archive. */
export function validDeletedRolloverRestoreProof(
  value: unknown, expected: DeletedRolloverRestoreIdentity, now = Date.now(),
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const proof = value as Record<string, unknown>
  const restoredAt = Date.parse(String(proof.restoredAt))
  return Object.entries(expected).every(([key, expectedValue]) => proof[key] === expectedValue) &&
    [expected.dumpSha256, expected.planHash, expected.inputFingerprint,
      expected.reviewEvidenceSha256].every((text) => sha256.test(text)) &&
    uuid.test(expected.predecessorId) && uuid.test(expected.successorId) &&
    uuid.test(expected.sourceGroupId) &&
    /^\d+\.\d{2}$/.test(expected.amount) &&
    Number.isFinite(Date.parse(expected.effectiveDate)) &&
    proof.restoredDatabase ===
      `money_lending_rehearsal_deleted_${expected.dumpSha256.slice(0, 12)}` &&
    proof.reviewVerdict === "pass" && proof.applied === true &&
    proof.reconciled === true && proof.cashUnchanged === true &&
    proof.paymentsUnchanged === true && proof.snapshotsUnchanged === true &&
    proof.originalJournalsUnchanged === true &&
    proof.journalGroupsBalanced === true && proof.nonCashCorrection === true &&
    uuid.test(String(proof.runId)) && uuid.test(String(proof.reviewId)) &&
    uuid.test(String(proof.journalGroupId)) &&
    Number.isFinite(restoredAt) && restoredAt <= now &&
    now - restoredAt <= 24 * 60 * 60 * 1000
}

/** Recheck the actual restored DB, rather than accepting a JSON attestation alone. */
async function verifyRestoredDatabase(rootText: string | undefined,
  proof: Record<string, unknown>, expected: DeletedRolloverRestoreIdentity): Promise<void> {
  const root = new URL(rootText ?? "")
  if (!["localhost", "127.0.0.1", "[::1]"].includes(root.hostname) ||
      decodeURIComponent(root.pathname.slice(1)) !== "money_lending_integration_test") {
    throw new Error("An isolated local rehearsal root is required")
  }
  root.pathname = `/${proof.restoredDatabase}`
  const sql = postgres(root.toString(), { max: 1 })
  try {
    const [identity] = await sql<{ name: string }[]>`
      SELECT current_database() AS name`
    if (identity?.name !== proof.restoredDatabase) {
      throw new Error("Rehearsal database identity changed")
    }
    const rows = await sql<{ category_name: string; category_type: string;
      type: "debit" | "credit"; amount: string; transaction_date: Date;
      journal_group_id: string; loan_id: string; reference_type: string;
      reference_id: string }[]>`
      SELECT c.name AS category_name, c.type AS category_type, t.type,
        t.amount, t.transaction_date, t.journal_group_id,
        t.loan_id, t.reference_type, t.reference_id
      FROM transactions t JOIN transaction_categories c ON c.id = t.category_id
      WHERE t.reference_type = 'deleted_rollover_ledger_repair'
        AND t.reference_id = ${expected.planHash}`
    if (rows.length !== 2 || rows.some((row) =>
        row.journal_group_id !== proof.journalGroupId ||
        row.loan_id !== expected.successorId ||
        row.transaction_date.toISOString() !== expected.effectiveDate ||
        !new BigNumber(row.amount).eq(expected.amount)) ||
        !rows.some((row) => row.category_name === "Loans Receivable" &&
          row.category_type === "asset" && row.type === "debit") ||
        !rows.some((row) => row.category_name === "Interest Earned" &&
          row.category_type === "revenue" && row.type === "credit")) {
      throw new Error("Restored correction journal does not match the exact plan")
    }
    const [review] = await sql<{ id: string; consumed_by_run_id: string | null;
      verdict: string; evidence_sha256: string }[]>`
      SELECT id, consumed_by_run_id, verdict, evidence_sha256
      FROM financial_correction_agent_reviews WHERE id = ${String(proof.reviewId)}`
    if (!review || review.verdict !== "pass" ||
        review.consumed_by_run_id !== proof.runId ||
        review.evidence_sha256 !== expected.reviewEvidenceSha256) {
      throw new Error("Restored agent review is not consumed by the exact run")
    }
    const [audit] = await sql<{ after_value: string | null }[]>`
      SELECT after_value FROM audit_log
      WHERE action = 'deleted_rollover_ledger_repair'
        AND entity_id = ${expected.predecessorId}
      ORDER BY occurred_at DESC LIMIT 1`
    let auditValue: Record<string, unknown> = {}
    try { auditValue = JSON.parse(audit?.after_value ?? "{}") }
    catch { throw new Error("Restored correction audit is malformed") }
    if (auditValue.runId !== proof.runId ||
        auditValue.journalGroupId !== proof.journalGroupId ||
        auditValue.sourceGroupId !== expected.sourceGroupId ||
        auditValue.planHash !== expected.planHash) {
      throw new Error("Restored audit does not bind the reviewed correction")
    }
    const balances = await sql<{ loan_id: string; name: string; net: string }[]>`
      SELECT t.loan_id, c.name,
        SUM(CASE WHEN t.type = 'debit' THEN t.amount ELSE -t.amount END)::text AS net
      FROM transactions t JOIN transaction_categories c ON c.id = t.category_id
      WHERE t.loan_id IN (${expected.predecessorId}, ${expected.successorId})
      GROUP BY t.loan_id, c.name`
    if (balances.some((row) => !new BigNumber(row.net).isZero())) {
      throw new Error("Restored deleted-chain account balances are not zero")
    }
  } finally { await sql.end() }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Re-restore the verified archive and compare its baseline with the rehearsed DB. */
async function verifyFreshRestoreMatchesRehearsal(
  rootText: string | undefined, dumpPath: string, rehearsalName: string,
  planHash: string,
): Promise<void> {
  const root = new URL(rootText ?? "")
  if (!["localhost", "127.0.0.1", "[::1]"].includes(root.hostname) ||
      decodeURIComponent(root.pathname.slice(1)) !== "money_lending_integration_test") {
    throw new Error("Fresh restore needs the isolated local integration-test server")
  }
  const freshName = `money_lending_verify_deleted_${randomUUID().replaceAll("-", "")}`
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: root.hostname, PGPORT: root.port || "5432",
    PGUSER: decodeURIComponent(root.username),
    PGPASSWORD: decodeURIComponent(root.password),
    PGDATABASE: "money_lending_integration_test", PGSSLMODE: "disable" }
  delete env.PGSERVICE
  for (const [command, args] of [
    ["createdb", ["--no-password", "--template=template0", freshName]],
    ["pg_restore", ["--no-owner", "--no-acl", "--exit-on-error",
      `--dbname=${freshName}`, dumpPath]],
  ] as const) {
    const result = spawnSync(command, args, { env, stdio: "ignore" })
    if (result.error || result.status !== 0) {
      throw new Error(`Fresh ${command} verification failed with status ${result.status}`)
    }
  }
  const baselineUrl = new URL(root)
  baselineUrl.pathname = `/${freshName}`
  const rehearsedUrl = new URL(root)
  rehearsedUrl.pathname = `/${rehearsalName}`
  const baseline = postgres(baselineUrl.toString(), { max: 1 })
  const rehearsed = postgres(rehearsedUrl.toString(), { max: 1 })
  try {
    const baselineHashes = await Promise.all([
      baseline`SELECT * FROM loans ORDER BY id`,
      baseline`SELECT * FROM payments ORDER BY id`,
      baseline`SELECT * FROM loan_waivers ORDER BY id`,
      baseline`SELECT * FROM rate_change_requests ORDER BY id`,
      baseline`SELECT * FROM financial_snapshots ORDER BY id`,
      baseline`SELECT * FROM transactions ORDER BY id`,
      baseline`SELECT * FROM audit_log ORDER BY id`,
    ])
    const rehearsalHashes = await Promise.all([
      rehearsed`SELECT * FROM loans ORDER BY id`,
      rehearsed`SELECT * FROM payments ORDER BY id`,
      rehearsed`SELECT * FROM loan_waivers ORDER BY id`,
      rehearsed`SELECT * FROM rate_change_requests ORDER BY id`,
      rehearsed`SELECT * FROM financial_snapshots ORDER BY id`,
      rehearsed`SELECT * FROM transactions
        WHERE reference_type IS DISTINCT FROM 'deleted_rollover_ledger_repair'
          OR reference_id IS DISTINCT FROM ${planHash} ORDER BY id`,
      rehearsed`SELECT * FROM audit_log
        WHERE action <> 'deleted_rollover_ledger_repair' ORDER BY id`,
    ])
    const tableNames = ["loans", "payments", "loan_waivers",
      "rate_change_requests", "financial_snapshots", "transactions", "audit_log"]
    const mismatches = baselineHashes.flatMap((rows, index) =>
      digest(rows) === digest(rehearsalHashes[index]) ? [] : [tableNames[index]])
    if (mismatches.length) {
      throw new Error(`Rehearsal source differs from fresh restore: ${mismatches.join(", ")}`)
    }
  } finally {
    await Promise.all([baseline.end(), rehearsed.end()])
  }
}

export function isDeletedRolloverRehearsalDatabase(
  currentUrl: string, dumpSha256: string,
): boolean {
  try {
    const url = new URL(currentUrl)
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      decodeURIComponent(url.pathname.slice(1)) ===
        `money_lending_rehearsal_deleted_${dumpSha256.slice(0, 12)}`
  } catch { return false }
}

/** Backup integrity alone is insufficient for prod: require an exact restore proof. */
export async function verifyDeletedRolloverBackup(
  gate: DeletedRolloverBackupGate,
  expected: Omit<DeletedRolloverRestoreIdentity,
    "dumpSha256" | "sourceHost" | "sourceDatabase">,
  rehearsal = false,
  rehearsalRootUrl?: string,
): Promise<{ dumpSha256: string; dumpPath: string }> {
  const verified = await verifyHistoricalRateArchive(gate)
  const currentUrl = process.env.DATABASE_URL ?? ""
  if (rehearsal) {
    if (!isDeletedRolloverRehearsalDatabase(currentUrl, verified.dumpSha256)) {
      throw new Error("Proof-free posting requires the exact isolated restored database")
    }
    return verified
  }
  if (currentUrl !== gate.primaryUrl) {
    throw new Error("Backup database does not match the live connection")
  }
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl)
  const proofPath = `${verified.dumpPath}.deleted-rollover-restore.json`
  if (resolve(proofPath) !== proofPath ||
      dirname(proofPath) !== correctionTempDirectory) {
    throw new Error("Deleted rollover restore proof path is unsafe")
  }
  const file = await lstat(proofPath)
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      process.getuid && file.uid !== process.getuid()) {
    throw new Error("Restore proof must be a private regular file")
  }
  const proof: unknown = JSON.parse(await readFile(proofPath, "utf8"))
  const exactIdentity = {
    ...expected, dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
  }
  if (!validDeletedRolloverRestoreProof(proof, exactIdentity)) {
    throw new Error("Exact deleted rollover restore proof is missing, stale, or mismatched")
  }
  await verifyRestoredDatabase(rehearsalRootUrl, proof as Record<string, unknown>, exactIdentity)
  await verifyFreshRestoreMatchesRehearsal(rehearsalRootUrl, verified.dumpPath,
    String((proof as Record<string, unknown>).restoredDatabase), expected.planHash)
  return verified
}
