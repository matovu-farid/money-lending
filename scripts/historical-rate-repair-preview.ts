/** Single-loan, read-only historical rate repair preview. No apply mode. */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { buildHistoricalRateRepairReport, parseHistoricalRateAsOf } from
  "../src/lib/interest/historical-rate-repair-report";
import { loadHistoricalRateRepairPlan } from
  "../src/services/historical-rate-repair.service";
import { correctionTempDirectory } from
  "../src/lib/interest/rollover-snapshot-guard";

const allowed = new Set([
  "expect-host", "expect-database", "loan-id", "as-of", "out",
]);

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown preview argument; this command has no apply mode");
    }
  }
  const urlText = process.env.DATABASE_URL;
  const expectedHost = option("expect-host");
  const expectedDatabase = option("expect-database");
  if (!urlText || !expectedHost || !expectedDatabase) {
    throw new Error("Explicit database identity is required");
  }
  const url = new URL(urlText);
  if (url.hostname !== expectedHost ||
      decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Configured database identity does not match");
  }
  const loanId = option("loan-id");
  if (!loanId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(loanId)) {
    throw new Error("Exactly one valid --loan-id is required");
  }
  const asOf = parseHistoricalRateAsOf(option("as-of"));
  const identity = await db.execute(sql`SELECT current_database() AS name`);
  if (identity[0]?.name !== expectedDatabase) {
    throw new Error("Connected database identity does not match");
  }
  const plan = await loadHistoricalRateRepairPlan(loanId, asOf);
  const report = buildHistoricalRateRepairReport({
    databaseHost: expectedHost,
    databaseName: expectedDatabase,
    plan,
  });
  const output = option("out");
  if (output) {
    const path = resolve(output);
    if (dirname(path) !== correctionTempDirectory || !path.endsWith(".json")) {
      throw new Error(`Report must be a new JSON file directly under ${correctionTempDirectory}`);
    }
    await writeFile(path, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ...report.summary, reportPath: path,
      exceptions: report.exceptions }));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Preview failed");
  process.exit(1);
});
