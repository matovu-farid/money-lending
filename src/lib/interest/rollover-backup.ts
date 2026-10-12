import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { verifyHistoricalRateArchive } from
  "./historical-rate-backup";
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from
  "./rollover-snapshot-guard";

const execFileAsync = promisify(execFile);
type BackupGate = Parameters<typeof verifyHistoricalRateArchive>[0] & {
  rehearsalSourceUrl?: string;
};
type Identity = { dumpSha256: string; sourceHost: string; sourceDatabase: string;
  chainRootId: string; planHash: string; inputFingerprint: string;
  policyVersion: string; reviewEvidenceSha256: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isIsolatedRolloverRehearsalDatabase(primary: string, direct: string,
  dumpSha256: string): boolean {
  try {
    const url = new URL(primary);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.toString() === new URL(direct).toString() &&
      decodeURIComponent(url.pathname.slice(1)) ===
        `money_lending_rehearsal_rollover_${dumpSha256.slice(0, 12)}`;
  } catch { return false; }
}

export function rolloverCorrectionDataInCatalog(catalog: string): boolean {
  const lines = catalog.split(/\r?\n/);
  return ["loans", "payments", "transactions", "audit_log",
    "rollover_correction_approvals", "rollover_correction_runs",
    "financial_correction_agent_reviews"].every((name) =>
    ["TABLE", "TABLE DATA"].every((kind) => lines.some((line) =>
      new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+${kind} public ${name}(?:\\s|$)`)
        .test(line))));
}

export function validRolloverRestoreProof(value: unknown, expected: Identity,
  now = Date.now()): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  const restoredAt = Date.parse(String(proof.restoredAt));
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.sourceHost === expected.sourceHost &&
    proof.sourceDatabase === expected.sourceDatabase &&
    proof.chainRootId === expected.chainRootId &&
    proof.planHash === expected.planHash &&
    proof.inputFingerprint === expected.inputFingerprint &&
    proof.policyVersion === expected.policyVersion &&
    proof.reviewEvidenceSha256 === expected.reviewEvidenceSha256 &&
    /^[a-f0-9]{64}$/.test(expected.planHash) &&
    /^[a-f0-9]{64}$/.test(expected.inputFingerprint) &&
    /^[a-f0-9]{64}$/.test(expected.reviewEvidenceSha256) &&
    uuid.test(expected.chainRootId) &&
    uuid.test(String(proof.reviewId)) && uuid.test(String(proof.runId)) &&
    proof.reviewVerdict === "pass" && proof.applied === true &&
    proof.reconciled === true && proof.paymentsUnchanged === true &&
    proof.cashUnchanged === true && proof.statusesUnchanged === true &&
    proof.sourceJournalsUnchanged === true &&
    proof.journalGroupsBalanced === true &&
    proof.nonCashCorrection === true &&
    typeof proof.restoredDatabase === "string" &&
    proof.restoredDatabase ===
      `money_lending_rehearsal_rollover_${expected.dumpSha256.slice(0, 12)}` &&
    proof.auditTablesPresent === true &&
    Number.isFinite(restoredAt) && restoredAt <= now &&
    now - restoredAt <= 24 * 60 * 60 * 1000 &&
    ["loanRows", "transactionRows"].every((key) =>
      Number.isSafeInteger(proof[key]) && Number(proof[key]) > 0) &&
    Number.isSafeInteger(proof.paymentRows) && Number(proof.paymentRows) >= 0;
}

async function privateProof(path: string): Promise<unknown> {
  if (resolve(path) !== path || dirname(path) !== correctionTempDirectory) {
    throw new Error("Rollover restore proof path is unsafe");
  }
  const file = await lstat(path);
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Rollover restore proof must be a private regular file");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/** Validate the full archive and an isolated restore before any rollover posting. */
export async function verifyRolloverCorrectionBackup(gate: BackupGate): Promise<{
  dumpPath: string; dumpSha256: string;
}> {
  const rehearsalSource = gate.rehearsalSourceUrl;
  const rehearsal = !!rehearsalSource &&
    isIsolatedRolloverRehearsalDatabase(gate.primaryUrl, gate.directUrl,
      gate.expectedDumpSha256);
  const archiveGate = { manifestPath: gate.manifestPath,
    expectedDumpSha256: gate.expectedDumpSha256,
    primaryUrl: rehearsal && rehearsalSource ? rehearsalSource : gate.primaryUrl,
    directUrl: rehearsal && rehearsalSource ? rehearsalSource : gate.directUrl };
  // Rollover has its own exact-chain restore proof below. Requiring an unrelated
  // historical-rate rehearsal would make a valid rollover impossible when no
  // historical-rate correction happens to exist in the same archive.
  const verified = await verifyHistoricalRateArchive(archiveGate);
  const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.correctionAuditTablesInDump !== true) {
    throw new Error("Rollover backup manifest lacks correction audit tables");
  }
  const { stdout: catalog } = await execFileAsync("pg_restore", ["--list", verified.dumpPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!rolloverCorrectionDataInCatalog(catalog)) {
    throw new Error("Rollover backup lacks ledger, run, or agent review data entries");
  }
  if (rehearsal) return verified;
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl);
  const proof = await privateProof(`${verified.dumpPath}.rollover-restore.json`);
  const sql = postgres(gate.primaryUrl, { max: 1 });
  let pending: Array<{ subject_id: string; plan_hash: string;
    input_fingerprint: string; policy_version: string; evidence_sha256: string }>;
  try {
    pending = await sql`SELECT subject_id, plan_hash, input_fingerprint,
      policy_version, evidence_sha256 FROM financial_correction_agent_reviews
      WHERE kind = 'rollover_correction' AND verdict = 'pass' AND consumed_at IS NULL`;
  } finally { await sql.end(); }
  if (pending.length !== 1) {
    throw new Error("Rollover apply requires exactly one pending passing review for proof binding");
  }
  const [review] = pending;
  if (!validRolloverRestoreProof(proof, { dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
    chainRootId: review.subject_id, planHash: review.plan_hash,
    inputFingerprint: review.input_fingerprint,
    policyVersion: review.policy_version,
    reviewEvidenceSha256: review.evidence_sha256 })) {
    throw new Error("Rollover isolated restore proof is absent, stale, or mismatched");
  }
  return verified;
}
