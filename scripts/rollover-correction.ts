/** Read-only rollover portfolio dry run. There is intentionally no apply mode. */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { loadRolloverCorrectionPlans } from "../src/services/rollover-correction.service";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  if (process.argv.some((arg) => arg === "--apply" || arg.startsWith("--apply="))) {
    throw new Error("This command is dry-run only; --apply is unavailable");
  }
  const urlText = process.env.DATABASE_URL;
  if (!urlText) throw new Error("DATABASE_URL is required");
  const url = new URL(urlText);
  const expectedHost = option("expect-host");
  const expectedDatabase = option("expect-database");
  if (!expectedHost || !expectedDatabase || url.hostname !== expectedHost ||
      decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Explicit --expect-host and --expect-database must match DATABASE_URL");
  }
  const identity = await db.execute(sql`SELECT current_database() AS name, current_user AS role`);
  if (identity[0]?.name !== expectedDatabase) {
    throw new Error("Connected database identity does not match the requested database");
  }
  const report = await loadRolloverCorrectionPlans();
  const coveredLinks = report.plans.reduce((count, plan) => count + plan.edges.length, 0);
  if (coveredLinks !== report.liveLinks + report.deletedLinks) {
    throw new Error("Portfolio inventory did not account for every rollover link");
  }
  const summary = {
    databaseHost: expectedHost,
    databaseName: expectedDatabase,
    liveLinks: report.liveLinks,
    deletedLinks: report.deletedLinks,
    coveredLinks,
    chains: report.plans.length,
    ready: report.plans.filter((plan) => plan.classification === "ready").length,
    review: report.plans.filter((plan) => plan.classification === "review").length,
    blocked: report.plans.filter((plan) => plan.classification === "blocked").length,
  };
  const output = option("out");
  if (output) {
    const path = resolve(output);
    const projectTmp = resolve(process.cwd(), "tmp") + sep;
    const systemTmp = resolve(tmpdir()) + sep;
    const privateTmp = resolve("/private/tmp") + sep;
    if (!path.startsWith(projectTmp) && !path.startsWith(systemTmp) && !path.startsWith(privateTmp)) {
      throw new Error("Report output must be under project tmp/ or the system temp directory");
    }
    await writeFile(path, JSON.stringify({ summary, plans: report.plans }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Wrote anonymized report to ${path}`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dry run failed");
  process.exitCode = 1;
});
