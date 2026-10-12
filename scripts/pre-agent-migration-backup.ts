/** Full-data safety snapshot before installing the agent-review migrations. */
import "dotenv/config";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { validateCorrectionDatabaseEndpoints, validateRolloverSnapshotTarget } from
  "../src/lib/interest/rollover-snapshot-guard";

const execFileAsync = promisify(execFile);
const requiredTables = ["loans", "payments", "loan_waivers", "transactions",
  "transaction_categories", "audit_log", "portfolio_accrual_repair_runs",
  "historical_rate_repair_runs", "rollover_correction_runs"];

function option(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

function hasFullData(catalog: string): boolean {
  return requiredTables.every((table) => ["TABLE", "TABLE DATA"].every((kind) =>
    catalog.split(/\r?\n/).some((line) => new RegExp(
      `^\\d+;\\s+\\d+\\s+\\d+\\s+${kind} public ${table}(?:\\s|$)`,
    ).test(line))));
}

async function dumpTo(fd: number, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl",
      "--no-password"], { env, stdio: ["ignore", fd, "ignore"] });
    child.once("error", () => reject(new Error("pg_dump could not start")));
    child.once("close", (code) => code === 0 ? resolve() :
      reject(new Error(`pg_dump failed with status ${code}`)));
  });
}

async function main(): Promise<void> {
  const { backup } = validateCorrectionDatabaseEndpoints(
    process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
  const { url, database, out } = validateRolloverSnapshotTarget(backup.toString(),
    option("expect-host"), option("expect-database"), option("out"));
  const client = postgres(url.toString(), { max: 1 });
  let baseline: string;
  try {
    const [row] = await client<{ name: string; migration: string }[]>`
      SELECT current_database() AS name,
        max(created_at)::text AS migration FROM drizzle.__drizzle_migrations`;
    if (row?.name !== database || !row.migration) {
      throw new Error("Backup database identity or migration baseline changed");
    }
    baseline = row.migration;
  } finally { await client.end(); }
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer" };
  if (url.searchParams.has("channel_binding")) {
    env.PGCHANNELBINDING = url.searchParams.get("channel_binding")!;
  }
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_UNPOOLED;
  delete env.PGSERVICE;
  const file = await open(out, "wx", 0o600);
  try {
    await dumpTo(file.fd, env);
  } catch (error) {
    await file.close();
    await unlink(out);
    throw error;
  }
  await file.close();
  const { stdout: catalog } = await execFileAsync("pg_restore", ["--list", out],
    { maxBuffer: 10 * 1024 * 1024 });
  if (!hasFullData(catalog)) {
    throw new Error("Pre-migration backup lacks core ledger and correction TABLE DATA");
  }
  const details = await stat(out);
  if (!details.size || (details.mode & 0o077) !== 0) {
    throw new Error("Pre-migration backup is empty or not owner-only");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(out)) hash.update(chunk);
  const manifestPath = `${out}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify({ format: "pg_dump-custom",
    sourceHost: url.hostname, sourceDatabase: database,
    baselineMigration: baseline, dumpPath: out, dumpBytes: details.size,
    dumpSha256: hash.digest("hex"), completedAt: new Date().toISOString(),
    requiredTables }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const saved = JSON.parse(await readFile(manifestPath, "utf8")) as { dumpSha256: string };
  console.log(JSON.stringify({ dumpPath: out, manifestPath,
    dumpSha256: saved.dumpSha256, baselineMigration: baseline }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pre-migration backup failed");
  process.exitCode = 1;
});
