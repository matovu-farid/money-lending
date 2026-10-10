import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  historicalRateAuditTablesInCatalog,
  historicalRateDataInCatalog,
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

function privateTmpChild(path: string, suffix: string): string {
  const canonical = resolve(path);
  if (canonical !== path || dirname(canonical) !== "/private/tmp" ||
      !canonical.endsWith(suffix)) {
    throw new Error(`Backup path must be a ${suffix} file directly under /private/tmp`);
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

/** Verify the dump itself, its checksum, and its catalog before any repair write. */
export async function verifyHistoricalRateBackup(gate: BackupGate): Promise<{
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
