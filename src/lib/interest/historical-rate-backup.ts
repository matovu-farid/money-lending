import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  historicalRateAuditTablesInCatalog,
  historicalRateDataInCatalog,
  correctionTempDirectory,
  requireHistoricalRateAuditTablesInDump,
  validateCorrectionDatabaseEndpoints,
} from "./rollover-snapshot-guard";

const execFileAsync = promisify(execFile);

type BackupGate = {
  manifestPath: string;
  expectedDumpSha256: string;
  primaryUrl: string;
  directUrl: string;
};

type RestoreIdentity = { dumpSha256: string; sourceHost: string; sourceDatabase: string };

const isolatedRehearsal = new AsyncLocalStorage<{
  url: string; dumpSha256: string; manifestPath: string;
}>();

/** Scope a proof-free apply to one verified archive in a local restored database. */
export function withIsolatedHistoricalRehearsal<T>(
  gate: BackupGate, action: () => Promise<T>,
): Promise<T> {
  const { primary, backup } = validateCorrectionDatabaseEndpoints(
    gate.primaryUrl, gate.directUrl);
  const database = decodeURIComponent(primary.pathname.slice(1));
  const scratchName = gate.manifestPath.slice(correctionTempDirectory.length + 1);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(primary.hostname) ||
      primary.toString() !== backup.toString() ||
      !/^money_lending_rehearsal_historical_[a-z0-9_]+$/.test(database) ||
      dirname(gate.manifestPath) !== correctionTempDirectory ||
      !/^historical-rehearsal-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.dump\.manifest\.json$/.test(scratchName) ||
      !/^[a-f0-9]{64}$/.test(gate.expectedDumpSha256)) {
    throw new Error("Proof-free apply requires one isolated local historical rehearsal database");
  }
  return isolatedRehearsal.run({ url: primary.toString(),
    dumpSha256: gate.expectedDumpSha256, manifestPath: gate.manifestPath }, action);
}

/** Bind a recent, isolated restore to the exact archive and its source database. */
export function validHistoricalRestoreProof(
  value: unknown, expected: RestoreIdentity, now = Date.now(),
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  const restoredAt = Date.parse(String(proof.restoredAt));
  const asOf = Date.parse(String(proof.asOf));
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const sha256 = /^[a-f0-9]{64}$/;
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.sourceHost === expected.sourceHost &&
    proof.sourceDatabase === expected.sourceDatabase &&
    typeof proof.restoredDatabase === "string" &&
    /^money_lending_rehearsal_[a-z0-9_]+$/.test(proof.restoredDatabase) &&
    proof.restoredDatabase !== proof.sourceDatabase &&
    proof.auditTablesPresent === true &&
    Number.isFinite(restoredAt) && restoredAt <= now &&
    now - restoredAt <= 24 * 60 * 60 * 1000 &&
    typeof proof.targetLoanId === "string" && uuid.test(proof.targetLoanId) &&
    typeof proof.asOf === "string" && Number.isFinite(asOf) && asOf <= now &&
    new Date(asOf).toISOString() === proof.asOf &&
    proof.policyVersion === "v2" &&
    typeof proof.planHash === "string" && sha256.test(proof.planHash) &&
    typeof proof.inputFingerprint === "string" && sha256.test(proof.inputFingerprint) &&
    typeof proof.rehearsalRunId === "string" && uuid.test(proof.rehearsalRunId) &&
    typeof proof.postPlanHash === "string" && sha256.test(proof.postPlanHash) &&
    proof.postPlanHash !== proof.planHash && proof.postClassification === "noop" &&
    typeof proof.endingPrincipal === "string" &&
    /^(?:0|[1-9]\d*)\.\d{2}$/.test(proof.endingPrincipal) &&
    proof.postEndingPrincipal === proof.endingPrincipal &&
    proof.postAccrualDelta === "0.00" &&
    proof.paymentsUnchanged === true && proof.cashUnchanged === true &&
    proof.journalGroupsBalanced === true && proof.nonCashCorrection === true &&
    ["loanRows", "transactionRows", "categoryRows"].every((key) =>
      Number.isSafeInteger(proof[key]) && Number(proof[key]) > 0) &&
    ["paymentRows", "waiverRows", "rateRequestRows", "auditRows"].every((key) =>
      Number.isSafeInteger(proof[key]) && Number(proof[key]) >= 0);
}

function privateTmpChild(path: string, suffix: string): string {
  const canonical = resolve(path);
  if (canonical !== path || dirname(canonical) !== correctionTempDirectory ||
      !canonical.endsWith(suffix)) {
    throw new Error(`Backup path must be a ${suffix} file directly under ${correctionTempDirectory}`);
  }
  return canonical;
}

async function requirePrivateFile(path: string) {
  const file = await lstat(path);
  if (!file.isFile() || file.size === 0 || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Backup and manifest must be nonempty owner-only regular files");
  }
  return file;
}

/** Archive-only validation for creating an isolated restore proof. Never sufficient for apply. */
export async function verifyHistoricalRateArchive(gate: BackupGate): Promise<{
  dumpPath: string;
  dumpSha256: string;
}> {
  const manifestPath = privateTmpChild(gate.manifestPath, ".dump.manifest.json");
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl);
  if (!/^[a-f0-9]{64}$/.test(gate.expectedDumpSha256)) {
    throw new Error("Expected backup SHA-256 is required");
  }
  await requirePrivateFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const dumpPath = privateTmpChild(String(manifest.dumpPath), ".dump");
  if (`${dumpPath}.manifest.json` !== manifestPath ||
      manifest.format !== "pg_dump-custom" ||
      manifest.sourceHost !== backup.hostname ||
      manifest.sourceDatabase !== decodeURIComponent(backup.pathname.slice(1))) {
    throw new Error("Backup manifest does not match the selected database and dump");
  }
  requireHistoricalRateAuditTablesInDump(manifest);
  const completedAt = Date.parse(String(manifest.completedAt));
  if (!Number.isFinite(completedAt) || completedAt > Date.now() ||
      Date.now() - completedAt > 24 * 60 * 60 * 1000) {
    throw new Error("Backup is stale or has an invalid completion time");
  }
  const file = await requirePrivateFile(dumpPath);
  if (file.size !== manifest.dumpBytes) throw new Error("Backup byte count changed");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dumpPath)) hash.update(chunk);
  const dumpSha256 = hash.digest("hex");
  if (dumpSha256 !== manifest.dumpSha256 || dumpSha256 !== gate.expectedDumpSha256) {
    throw new Error("Backup SHA-256 does not match the reviewed checksum");
  }
  let catalog: string;
  try {
    ({ stdout: catalog } = await execFileAsync("pg_restore", ["--list", dumpPath], {
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch {
    throw new Error("Backup pg_restore catalog could not be read");
  }
  if (!historicalRateAuditTablesInCatalog(catalog) ||
      !historicalRateDataInCatalog(catalog)) {
    throw new Error("Backup restore catalog lacks historical repair tables or ledger data entries");
  }
  return { dumpPath, dumpSha256 };
}

/** Historical apply requires both the complete archive and its own restore proof. */
export async function verifyHistoricalRateBackup(gate: BackupGate): Promise<{
  dumpPath: string;
  dumpSha256: string;
}> {
  const verified = await verifyHistoricalRateArchive(gate);
  const rehearsal = isolatedRehearsal.getStore();
  if (rehearsal?.url === new URL(gate.primaryUrl).toString() &&
      gate.primaryUrl === gate.directUrl &&
      rehearsal.manifestPath === gate.manifestPath &&
      rehearsal.dumpSha256 === verified.dumpSha256) return verified;
  const proofPath = `${verified.dumpPath}.historical-restore.json`;
  if (resolve(proofPath) !== proofPath || dirname(proofPath) !== correctionTempDirectory) {
    throw new Error("Historical restore proof path is unsafe");
  }
  try {
    await requirePrivateFile(proofPath);
  } catch {
    throw new Error("Historical isolated restore proof is absent or not owner-only");
  }
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl);
  let proof: unknown;
  try {
    proof = JSON.parse(await readFile(proofPath, "utf8")) as unknown;
  } catch {
    throw new Error("Historical isolated restore proof is unreadable");
  }
  if (!validHistoricalRestoreProof(proof, {
    dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
  })) {
    throw new Error("Historical isolated restore proof is stale or mismatched");
  }
  return verified;
}
