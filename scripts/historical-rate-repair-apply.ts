/** Explicit two-step operator command; no batch or implicit production writes. */
import "dotenv/config";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { buildHistoricalRateRepairReport } from
  "../src/lib/interest/historical-rate-repair-report";
import { correctionTempDirectory } from
  "../src/lib/interest/rollover-snapshot-guard";
import { loadHistoricalRateRepairPlan } from
  "../src/services/historical-rate-repair.service";
import { approveHistoricalRateRepair, applyHistoricalRateRepair } from
  "../src/services/historical-rate-repair-apply.service";

const allowed = new Set([
  "mode", "expect-host", "expect-database", "report", "actor-id",
  "review-note", "backup-manifest", "backup-sha256",
]);
function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
function privateReportPath(path: string | undefined): string {
  if (!path) throw new Error("An exact reviewed report path is required");
  const canonical = resolve(path);
  if (canonical !== path || dirname(canonical) !== correctionTempDirectory ||
      !canonical.endsWith(".json")) {
    throw new Error(`Report must be a JSON file directly under ${correctionTempDirectory}`);
  }
  return canonical;
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown historical rate repair argument");
    }
  }
  const mode = option("mode");
  if (mode !== "approve" && mode !== "apply") {
    throw new Error("Explicit --mode=approve or --mode=apply is required");
  }
  const expectedHost = option("expect-host");
  const expectedDatabase = option("expect-database");
  const urlText = process.env.DATABASE_URL;
  const actorId = option("actor-id");
  if (!urlText || !expectedHost || !expectedDatabase || !actorId) {
    throw new Error("Explicit database identity and administrator ID are required");
  }
  const url = new URL(urlText);
  if (url.hostname !== expectedHost ||
      decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Database identity does not match the requested target");
  }
  if (mode === "approve" &&
      !["localhost", "127.0.0.1", "::1"].includes(expectedHost)) {
    throw new Error("Production approval requires an authenticated administrator review, not an operator-supplied actor ID");
  }
  const identity = await db.execute(sql`SELECT current_database() AS name`);
  if (identity[0]?.name !== expectedDatabase) {
    throw new Error("Connected database identity does not match");
  }
  const reportPath = privateReportPath(option("report"));
  const file = await lstat(reportPath);
  if (!file.isFile() || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Reviewed report must be an owner-only regular file");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    summary: { databaseHost: string; databaseName: string; loanId: string;
      asOf: string; policyVersion: string; classification: string;
      planHash: string; inputFingerprint: string };
  };
  const summary = report.summary;
  if (summary.databaseHost !== expectedHost ||
      summary.databaseName !== expectedDatabase ||
      summary.classification !== "review" ||
      !/^[a-f0-9-]{36}$/.test(summary.loanId) ||
      !/^[a-f0-9]{64}$/.test(summary.planHash) ||
      !/^[a-f0-9]{64}$/.test(summary.inputFingerprint)) {
    throw new Error("Reviewed report identity or plan is invalid");
  }
  const asOf = new Date(summary.asOf);
  if (!Number.isFinite(asOf.getTime()) || asOf > new Date()) {
    throw new Error("Reviewed report as-of instant is invalid");
  }
  const plan = await loadHistoricalRateRepairPlan(
    summary.loanId, asOf, summary.policyVersion,
  );
  const currentReport = buildHistoricalRateRepairReport({
    databaseHost: expectedHost, databaseName: expectedDatabase, plan,
  });
  if (JSON.stringify(currentReport) !== JSON.stringify(report)) {
    throw new Error("Reviewed report is stale or does not match current database state");
  }
  if (mode === "approve") {
    const note = option("review-note");
    if (!note) throw new Error("A substantive --review-note is required");
    const approvalId = await approveHistoricalRateRepair(plan, actorId, note);
    console.log(JSON.stringify({ approvalId, loanId: plan.loanId, planHash: plan.planHash }));
    return;
  }
  const manifestPath = option("backup-manifest");
  const expectedDumpSha256 = option("backup-sha256");
  if (!manifestPath || !expectedDumpSha256 || !process.env.DATABASE_URL_UNPOOLED) {
    throw new Error("An exact backup manifest, SHA-256, and direct database URL are required");
  }
  const result = await applyHistoricalRateRepair(plan, actorId, {
    manifestPath, expectedDumpSha256,
    primaryUrl: urlText, directUrl: process.env.DATABASE_URL_UNPOOLED,
  });
  console.log(JSON.stringify({ ...result, loanId: plan.loanId, planHash: plan.planHash }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Historical rate repair failed");
  process.exit(1);
});
