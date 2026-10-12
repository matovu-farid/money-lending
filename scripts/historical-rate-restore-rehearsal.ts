/** Restore an archive and rehearse one exact reviewed historical-rate repair locally. */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import BigNumber from "bignumber.js";
import { validHistoricalRestoreProof, verifyHistoricalRateArchive,
  withIsolatedHistoricalRehearsal } from
  "../src/lib/interest/historical-rate-backup";
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from
  "../src/lib/interest/rollover-snapshot-guard";
import { buildHistoricalRateRepairReport, parseHistoricalRateAsOf } from
  "../src/lib/interest/historical-rate-repair-report";

function option(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!arg) throw new Error(`--${name} is required`);
  return arg.slice(prefix.length);
}

type ReviewedSummary = {
  databaseHost: string; databaseName: string; loanId: string; asOf: string;
  policyVersion: string; classification: string; planHash: string;
  inputFingerprint: string;
};

async function reviewedReport(path: string, host: string, database: string): Promise<{
  summary: ReviewedSummary; report: unknown;
}> {
  if (resolve(path) !== path || dirname(path) !== correctionTempDirectory ||
      !path.endsWith(".json")) {
    throw new Error("Reviewed report must be a JSON file directly under the private temp directory");
  }
  const file = await lstat(path);
  if (!file.isFile() || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Reviewed report must be an owner-only regular file");
  }
  const report = JSON.parse(await readFile(path, "utf8")) as { summary?: ReviewedSummary };
  const summary = report.summary;
  if (!summary || summary.databaseHost !== host || summary.databaseName !== database ||
      summary.classification !== "review" || summary.policyVersion !== "v2" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(summary.loanId) ||
      ![summary.planHash, summary.inputFingerprint].every((value) =>
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error("Reviewed report identity or plan is invalid");
  }
  parseHistoricalRateAsOf(summary.asOf);
  return { summary, report };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function immutableFacts(sql: ReturnType<typeof postgres>, loanId: string) {
  const payments = await sql`SELECT row_to_json(p) AS data FROM payments p
    WHERE p.loan_id = ${loanId} ORDER BY p.id`;
  const cash = await sql`SELECT row_to_json(t) AS data FROM transactions t
    JOIN transaction_categories c ON c.id = t.category_id
    WHERE c.name = 'Cash' AND (t.loan_id = ${loanId} OR t.reference_id = ${loanId}
      OR t.reference_id IN (SELECT id::text FROM payments WHERE loan_id = ${loanId}))
    ORDER BY t.id`;
  return { payments: fingerprint(payments), cash: fingerprint(cash) };
}

async function correctionJournalsBalance(sql: ReturnType<typeof postgres>,
  loanId: string, planHash: string): Promise<boolean> {
  const rows = await sql<{ category: string; group_id: string | null;
    type: string; amount: string }[]>`SELECT c.name AS category,
      t.journal_group_id AS group_id, t.type, t.amount
    FROM transactions t JOIN transaction_categories c ON c.id = t.category_id
    WHERE t.loan_id = ${loanId} AND t.description = ${`Historical rate repair ${planHash}`}`;
  const groups = new Map<string, bigint>();
  for (const row of rows) {
    if (!row.group_id || row.category === "Cash" ||
        !["debit", "credit"].includes(row.type)) return false;
    if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(row.amount)) return false;
    const cents = BigInt(row.amount.replace(".", ""));
    groups.set(row.group_id, (groups.get(row.group_id) ?? BigInt(0)) +
      (row.type === "debit" ? cents : -cents));
  }
  return [...groups.values()].every((balance) => balance === BigInt(0));
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { env, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr ?? "").slice(0, 1200)}`);
  }
}

async function main() {
  const allowed = new Set(["backup-manifest", "backup-sha256", "report"]);
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown historical restore rehearsal argument");
    }
  }
  const gate = { manifestPath: option("backup-manifest"),
    expectedDumpSha256: option("backup-sha256"),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "" };
  const verified = await verifyHistoricalRateArchive(gate);
  const { primary, backup } = validateCorrectionDatabaseEndpoints(
    gate.primaryUrl, gate.directUrl);
  const sourceDatabase = decodeURIComponent(backup.pathname.slice(1));
  const { summary, report } = await reviewedReport(
    option("report"), primary.hostname, sourceDatabase);
  const proofPath = `${verified.dumpPath}.historical-restore.json`;
  try {
    await lstat(proofPath);
    throw new Error("Historical restore proof already exists");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const local = new URL(process.env.DATABASE_URL_TEST ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) ||
      decodeURIComponent(local.pathname.slice(1)) !== "money_lending") {
    throw new Error("Historical rehearsal requires the local money_lending database");
  }
  const databaseName = `money_lending_rehearsal_historical_${verified.dumpSha256.slice(0, 12)}_${summary.planHash.slice(0, 12)}`;
  const root = postgres(local.toString(), { max: 1 });
  try {
    const existing = await root`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
    if (existing.length) throw new Error("The isolated historical rehearsal database already exists");
  } finally { await root.end(); }

  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: local.hostname, PGPORT: local.port || "5432",
    PGUSER: decodeURIComponent(local.username),
    PGPASSWORD: decodeURIComponent(local.password),
    PGDATABASE: "money_lending", PGSSLMODE: "disable" };
  delete env.PGSERVICE;
  delete env.PGHOSTADDR;
  run("createdb", ["--no-password", "--template=template0", databaseName], env);
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error",
    `--dbname=${databaseName}`, verified.dumpPath], env);

  local.pathname = `/${databaseName}`;
  const restored = postgres(local.toString(), { max: 1 });
  let counts: { loanRows: number; paymentRows: number; transactionRows: number;
    waiverRows: number; rateRequestRows: number; categoryRows: number;
    auditRows: number; auditTablesPresent: boolean };
  try {
    const [identity] = await restored`SELECT current_database() AS name`;
    if (identity?.name !== databaseName) throw new Error("Restored database identity changed");
    const [row] = await restored<{
      loan_rows: number; payment_rows: number; transaction_rows: number;
      waiver_rows: number; rate_request_rows: number; category_rows: number;
      audit_rows: number; approvals_table: string | null; runs_table: string | null;
      reviews_table: string | null;
    }[]>`SELECT
      (SELECT count(*)::int FROM loans) AS loan_rows,
      (SELECT count(*)::int FROM payments) AS payment_rows,
      (SELECT count(*)::int FROM transactions) AS transaction_rows,
      (SELECT count(*)::int FROM loan_waivers) AS waiver_rows,
      (SELECT count(*)::int FROM rate_change_requests) AS rate_request_rows,
      (SELECT count(*)::int FROM transaction_categories) AS category_rows,
      (SELECT count(*)::int FROM audit_log) AS audit_rows,
      to_regclass('public.historical_rate_repair_approvals')::text AS approvals_table,
      to_regclass('public.historical_rate_repair_runs')::text AS runs_table,
      to_regclass('public.financial_correction_agent_reviews')::text AS reviews_table`;
    counts = { loanRows: row.loan_rows, paymentRows: row.payment_rows,
      transactionRows: row.transaction_rows, waiverRows: row.waiver_rows,
      rateRequestRows: row.rate_request_rows, categoryRows: row.category_rows,
      auditRows: row.audit_rows,
      auditTablesPresent: !!row.approvals_table && !!row.runs_table && !!row.reviews_table };
    const before = await immutableFacts(restored, summary.loanId);

    // The apply service verifies an archive bound to its own database identity.
    // A private hard link and manifest give the isolated DB that exact archive.
    const scratchDump = `${correctionTempDirectory}/historical-rehearsal-${randomUUID()}.dump`;
    const scratchManifest = `${scratchDump}.manifest.json`;
    const scratchPaths: string[] = [];
    let completedProof: Record<string, unknown> | undefined;
    try {
      await link(verified.dumpPath, scratchDump);
      scratchPaths.push(scratchDump);
      const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>;
      await writeFile(scratchManifest, JSON.stringify({ ...manifest,
        dumpPath: scratchDump, sourceHost: local.hostname,
        sourceDatabase: databaseName }), { flag: "wx", mode: 0o600 });
      scratchPaths.push(scratchManifest);

      // Import DB-backed services only after both connection URLs point at the restore.
      process.env.DATABASE_URL = local.toString();
      process.env.DATABASE_URL_UNPOOLED = local.toString();
      process.env.DATABASE_URL_TEST = local.toString();
      const { loadHistoricalRateRepairPlan } = await import(
        "../src/services/historical-rate-repair.service");
      const { reviewHistoricalRateRepair, applyHistoricalRateRepair } = await import(
        "../src/services/historical-rate-repair-apply.service");
      const asOf = new Date(summary.asOf);
      const plan = await loadHistoricalRateRepairPlan(summary.loanId, asOf, summary.policyVersion);
      if (plan.classification !== "review" || plan.planHash !== summary.planHash ||
          plan.inputFingerprint !== summary.inputFingerprint ||
          plan.endingPrincipal === null) {
        throw new Error("Restored target loan plan differs from the exact reviewed report");
      }
      const restoredReport = buildHistoricalRateRepairReport({
        databaseHost: primary.hostname, databaseName: sourceDatabase, plan,
      });
      if (JSON.stringify(restoredReport) !== JSON.stringify(report)) {
        throw new Error("Restored target loan report differs from the exact reviewed report");
      }
      const reviewed = await reviewHistoricalRateRepair(
        plan, `agent:historical-rehearsal-review-${randomUUID()}`, randomUUID());
      if (reviewed.verdict !== "pass") {
        throw new Error(`Restored target loan independent review failed: ${reviewed.findings.join("; ")}`);
      }
      const localGate = { manifestPath: scratchManifest,
        expectedDumpSha256: verified.dumpSha256,
        primaryUrl: local.toString(), directUrl: local.toString() };
      const applied = await withIsolatedHistoricalRehearsal(localGate, () =>
        applyHistoricalRateRepair(plan,
          `agent:historical-rehearsal-apply-${randomUUID()}`, localGate));
      if (applied.alreadyApplied) throw new Error("Restored target loan was already corrected");
      const afterPlan = await loadHistoricalRateRepairPlan(summary.loanId, asOf, summary.policyVersion);
      const after = await immutableFacts(restored, summary.loanId);
      const balanced = await correctionJournalsBalance(restored, summary.loanId, plan.planHash);
      const proof = { dumpSha256: verified.dumpSha256, sourceHost: backup.hostname,
        sourceDatabase, restoredDatabase: databaseName,
        restoredAt: new Date().toISOString(), ...counts,
        targetLoanId: summary.loanId, asOf: summary.asOf,
        policyVersion: summary.policyVersion, planHash: plan.planHash,
        inputFingerprint: plan.inputFingerprint,
        endingPrincipal: new BigNumber(plan.endingPrincipal).toFixed(2),
        rehearsalRunId: applied.runId, postPlanHash: afterPlan.planHash,
        postClassification: afterPlan.classification,
        postEndingPrincipal: afterPlan.endingPrincipal === null ? null :
          new BigNumber(afterPlan.endingPrincipal).toFixed(2),
        postAccrualDelta: afterPlan.accrualJournalDelta,
        paymentsUnchanged: before.payments === after.payments,
        cashUnchanged: before.cash === after.cash,
        journalGroupsBalanced: balanced, nonCashCorrection: balanced };
      if (!validHistoricalRestoreProof(proof, {
        dumpSha256: verified.dumpSha256, sourceHost: backup.hostname, sourceDatabase,
      })) {
        throw new Error("Restored historical correction failed post-apply reconciliation");
      }
      completedProof = proof;
    } finally {
      for (const path of scratchPaths.reverse()) await unlink(path);
    }
    if (!completedProof) throw new Error("Historical rehearsal did not complete");
    const file = await open(proofPath, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(completedProof, null, 2)}\n`); }
    finally { await file.close(); }
    console.log(JSON.stringify({ proofPath, restoredDatabase: databaseName,
      targetLoanId: summary.loanId, planHash: summary.planHash,
      rehearsalRunId: completedProof.rehearsalRunId, postClassification: "noop",
      ...counts }));
  } finally { await restored.end(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Historical restore rehearsal failed");
  process.exitCode = 1;
});
