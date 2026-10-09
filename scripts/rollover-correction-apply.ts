/** Single-chain, explicitly reviewed maintenance entrypoint. No bulk mode. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { rolloverCorrectionRuns } from "../src/lib/db/schema/rollover-correction-runs";
import { user } from "../src/lib/db/schema/auth";
import {
  approveRolloverCorrection,
  applyRolloverCorrection,
} from "../src/services/rollover-correction-apply.service";
import { loadRolloverCorrectionPlans } from
  "../src/services/rollover-correction.service";
import { requireCorrectionAuditTablesInDump, validateCorrectionDatabaseEndpoints } from
  "../src/lib/interest/rollover-snapshot-guard";

const allowed = new Set([
  "mode", "expect-host", "expect-database", "report", "report-sha256",
  "snapshot-manifest", "plan-hash", "input-fingerprint", "actor-id", "review-note",
]);

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function privatePath(value: string | undefined, suffix: string): string {
  if (!value || !value.startsWith("/")) throw new Error(`A private ${suffix} path is required`);
  const path = resolve(value);
  if (dirname(path) !== "/private/tmp" || !path.endsWith(suffix)) {
    throw new Error(`The ${suffix} file must be directly under /private/tmp`);
  }
  return path;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function privateRegularFile(path: string) {
  const details = await lstat(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0 ||
      (process.getuid && details.uid !== process.getuid())) {
    throw new Error("Reviewed artifacts must be private regular files owned by this user");
  }
  return details;
}

async function main() {
  for (const argument of process.argv.slice(2)) {
    if (!argument.startsWith("--") || !allowed.has(argument.slice(2).split("=")[0])) {
      throw new Error("Unknown rollover correction argument");
    }
  }
  const mode = option("mode");
  if (mode !== "approve" && mode !== "apply") {
    throw new Error("Choose exactly one mode: approve or apply");
  }
  const urlText = process.env.DATABASE_URL;
  const expectedHost = option("expect-host");
  const expectedDatabase = option("expect-database");
  if (!urlText || !expectedHost || !expectedDatabase) {
    throw new Error("Explicit database identity is required");
  }
  const url = new URL(urlText);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (url.hostname !== expectedHost || database !== expectedDatabase) {
    throw new Error("Configured database does not match the expected identity");
  }
  const identity = await db.execute(sql`SELECT current_database() AS name`);
  if (identity[0]?.name !== expectedDatabase) {
    throw new Error("Connected database identity does not match");
  }

  const reportPath = privatePath(option("report"), ".json");
  await privateRegularFile(reportPath);
  const reportText = await readFile(reportPath, "utf8");
  if (sha256(reportText) !== option("report-sha256")) {
    throw new Error("Reviewed report checksum does not match");
  }
  const report = JSON.parse(reportText) as {
    summary: { databaseHost: string; databaseName: string; coveredLinks: number };
    plans: Array<{ planHash: string; inputFingerprint: string; classification: string }>;
  };
  if (report.summary?.databaseHost !== expectedHost ||
      report.summary?.databaseName !== expectedDatabase ||
      !Array.isArray(report.plans)) {
    throw new Error("Report database identity or format does not match");
  }
  const planHash = option("plan-hash");
  const inputFingerprint = option("input-fingerprint");
  if (!/^[a-f0-9]{64}$/.test(planHash ?? "") ||
      !/^[a-f0-9]{64}$/.test(inputFingerprint ?? "")) {
    throw new Error("Exact plan hash and input fingerprint are required");
  }
  const reported = report.plans.find((plan) => plan.planHash === planHash);
  if (!reported || reported.inputFingerprint !== inputFingerprint ||
      reported.classification === "blocked") {
    throw new Error("Target plan is absent, changed, or blocked in the reviewed report");
  }

  const manifestPath = privatePath(option("snapshot-manifest"), ".dump.manifest.json");
  await privateRegularFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    format: string; sourceHost: string; sourceDatabase: string;
    completedAt: string; dumpPath: string; dumpBytes: number; dumpSha256: string;
    correctionAuditTablesInDump?: boolean;
  };
  const { backup: backupUrl } = validateCorrectionDatabaseEndpoints(
    urlText, process.env.DATABASE_URL_UNPOOLED);
  const dumpPath = privatePath(manifest.dumpPath, ".dump");
  const dump = await privateRegularFile(dumpPath);
  const snapshotAge = Date.now() - new Date(manifest.completedAt).getTime();
  if (manifest.format !== "pg_dump-custom" ||
      manifest.sourceHost !== backupUrl.hostname ||
      manifest.sourceDatabase !== expectedDatabase ||
      manifestPath !== `${dumpPath}.manifest.json` ||
      dump.size !== manifest.dumpBytes ||
      !Number.isFinite(snapshotAge) || snapshotAge < 0 ||
      snapshotAge > 24 * 60 * 60 * 1000 ||
      await fileSha256(dumpPath) !== manifest.dumpSha256) {
    throw new Error("Recent, private backup manifest does not verify");
  }
  requireCorrectionAuditTablesInDump(manifest);

  const actorId = option("actor-id");
  if (!actorId) throw new Error("An identified administrator actor is required");
  const [actor] = await db.select({ role: user.role }).from(user)
    .where(eq(user.id, actorId));
  if (!actor || !["admin", "superAdmin"].includes(actor.role ?? "")) {
    throw new Error("Rollover correction requires an identified administrator");
  }
  if (mode === "apply") {
    const [priorRun] = await db.select({ id: rolloverCorrectionRuns.id })
      .from(rolloverCorrectionRuns)
      .where(eq(rolloverCorrectionRuns.planHash, planHash!));
    if (priorRun) {
      console.log(JSON.stringify({ planHash, applied: false, runId: priorRun.id }));
      return;
    }
  }

  const portfolio = await loadRolloverCorrectionPlans();
  const coveredLinks = portfolio.plans.reduce((count, plan) => count + plan.edges.length, 0);
  if (coveredLinks !== report.summary.coveredLinks ||
      coveredLinks !== portfolio.liveLinks + portfolio.deletedLinks) {
    throw new Error("Portfolio link inventory changed since the reviewed report");
  }
  const current = portfolio.plans.find((plan) => plan.planHash === planHash);
  if (!current || current.inputFingerprint !== inputFingerprint ||
      current.classification === "blocked") {
    throw new Error("Target chain changed since the reviewed report");
  }
  if (mode === "approve") {
    const note = option("review-note");
    if (!note?.trim()) throw new Error("A substantive review note is required");
    const approvalId = await approveRolloverCorrection(current, actorId, note);
    console.log(`Approved exact plan ${planHash}; approval ID ${approvalId}`);
  } else {
    const result = await applyRolloverCorrection(current, actorId);
    console.log(JSON.stringify({ planHash, ...result }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Rollover operation failed");
  process.exitCode = 1;
});
