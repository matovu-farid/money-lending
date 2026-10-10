/** Creates a verified, private, read-only database backup before any correction. */
import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { correctionAuditTablesInCatalog, historicalRateAuditTablesInCatalog,
  validateCorrectionDatabaseEndpoints,
  validateRolloverSnapshotTarget } from
  "../src/lib/interest/rollover-snapshot-guard";

const execFileAsync = promisify(execFile);

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function runQuiet(command: string, args: string[], env: NodeJS.ProcessEnv,
  outputFd?: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", outputFd ?? "ignore", "ignore"],
    });
    child.once("error", () => reject(new Error(`${command} could not start`)));
    child.once("close", (code) => code === 0
      ? resolve() : reject(new Error(`${command} failed with status ${code}`)));
  });
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { backup } = validateCorrectionDatabaseEndpoints(
    process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
  const urlText = backup.toString();
  const { url, database, out } = validateRolloverSnapshotTarget(
    urlText, option("expect-host"), option("expect-database"), option("out"));
  const client = postgres(urlText!, { max: 1 });
  let databaseRole: string;
  try {
    const [identity] = await client<{ name: string; role: string }[]>`
      SELECT current_database() AS name, current_user AS role
    `;
    if (identity?.name !== database) throw new Error("Connected database identity changed");
    databaseRole = identity.role;
  } finally {
    await client.end();
  }

  const dumpEnv: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
  };
  if (url.searchParams.has("channel_binding")) {
    dumpEnv.PGCHANNELBINDING = url.searchParams.get("channel_binding")!;
  }
  delete dumpEnv.DATABASE_URL;
  delete dumpEnv.DATABASE_URL_UNPOOLED;
  delete dumpEnv.PGSERVICE;
  const startedAt = new Date().toISOString();
  const handle = await open(out, "wx", 0o600);
  try {
    await runQuiet("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--no-password"],
      dumpEnv, handle.fd);
  } catch (error) {
    await handle.close();
    await unlink(out);
    throw error;
  }
  await handle.close();
  const { stdout: catalog } = await execFileAsync("pg_restore", ["--list", out], {
    env: dumpEnv, maxBuffer: 10 * 1024 * 1024,
  });
  const details = await stat(out);
  if (!details.size || (details.mode & 0o077) !== 0) {
    throw new Error("Snapshot is empty or accessible to other users");
  }
  const manifestPath = `${out}.manifest.json`;
  const manifest = {
    format: "pg_dump-custom",
    sourceHost: url.hostname,
    sourceDatabase: database,
    databaseRole,
    startedAt,
    completedAt: new Date().toISOString(),
    dumpPath: out,
    dumpBytes: details.size,
    dumpSha256: await fileSha256(out),
    correctionAuditTablesInDump: correctionAuditTablesInCatalog(catalog),
    historicalRateAuditTablesInDump: historicalRateAuditTablesInCatalog(catalog),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o600 });
  console.log(`Verified snapshot: ${out}`);
  console.log(`Checksum manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Snapshot failed");
  process.exitCode = 1;
});
