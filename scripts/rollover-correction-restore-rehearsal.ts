/** Restore a verified rollover archive into a new local database and record proof. */
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
import BigNumber from "bignumber.js";
import { eq } from "drizzle-orm";
import { verifyHistoricalRateArchive } from "../src/lib/interest/historical-rate-backup";
import { rolloverCorrectionDataInCatalog, validRolloverRestoreProof } from
  "../src/lib/interest/rollover-backup";
import { correctionAuditTablesInCatalog, validateCorrectionDatabaseEndpoints } from
  "../src/lib/interest/rollover-snapshot-guard";

function option(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!arg) throw new Error(`${prefix.slice(0, -1)} is required`);
  return arg.slice(prefix.length);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { env, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr ?? "").slice(0, 1200)}`);
  }
}

async function main() {
  const planHash = option("plan-hash");
  const inputFingerprint = option("input-fingerprint");
  if (![planHash, inputFingerprint].every((value) => /^[a-f0-9]{64}$/.test(value))) {
    throw new Error("Exact target plan hash and input fingerprint are required");
  }
  const gate = { manifestPath: option("backup-manifest"),
    expectedDumpSha256: option("backup-sha256"),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "" };
  const verified = await verifyHistoricalRateArchive(gate);
  const manifest = JSON.parse(await readFile(gate.manifestPath, "utf8")) as Record<string, unknown>;
  const catalog = execFileSync("pg_restore", ["--list", verified.dumpPath], {
    encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
  if (manifest.correctionAuditTablesInDump !== true ||
      !correctionAuditTablesInCatalog(catalog) ||
      !rolloverCorrectionDataInCatalog(catalog)) {
    throw new Error("Rollover archive lacks ledger or agent review schema and data");
  }
  const local = new URL(process.env.DATABASE_URL_TEST ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(local.hostname) ||
      decodeURIComponent(local.pathname.slice(1)) !== "money_lending") {
    throw new Error("Rollover rehearsal requires the local money_lending database");
  }
  const databaseName = `money_lending_rehearsal_rollover_${verified.dumpSha256.slice(0, 12)}`;
  const root = postgres(local.toString(), { max: 1 });
  try {
    const existing = await root`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
    if (existing.length) throw new Error("The isolated rollover rehearsal database already exists");
  } finally { await root.end(); }
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: local.hostname, PGPORT: local.port || "5432",
    PGUSER: decodeURIComponent(local.username),
    PGPASSWORD: decodeURIComponent(local.password),
    PGDATABASE: "money_lending", PGSSLMODE: "disable" };
  delete env.PGSERVICE;
  run("createdb", ["--no-password", "--template=template0", databaseName], env);
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error",
    `--dbname=${databaseName}`, verified.dumpPath], env);

  local.pathname = `/${databaseName}`;
  const restored = postgres(local.toString(), { max: 1 });
  let counts: { loanRows: number; paymentRows: number;
    transactionRows: number; auditTablesPresent: boolean };
  try {
    const [row] = await restored<{
      loan_rows: number; payment_rows: number; transaction_rows: number;
      approvals_table: string | null; runs_table: string | null;
      reviews_table: string | null;
    }[]>`SELECT
      (SELECT count(*)::int FROM loans) AS loan_rows,
      (SELECT count(*)::int FROM payments) AS payment_rows,
      (SELECT count(*)::int FROM transactions) AS transaction_rows,
      to_regclass('public.rollover_correction_approvals')::text AS approvals_table,
      to_regclass('public.rollover_correction_runs')::text AS runs_table,
      to_regclass('public.financial_correction_agent_reviews')::text AS reviews_table`;
    counts = { loanRows: row.loan_rows, paymentRows: row.payment_rows,
      transactionRows: row.transaction_rows,
      auditTablesPresent: !!row.approvals_table && !!row.runs_table &&
        !!row.reviews_table };
  } finally { await restored.end(); }
  // Service modules capture DATABASE_URL when imported. Switch only after the
  // restore has been checked, and allow the backup gate only this exact local DB.
  process.env.DATABASE_URL = local.toString();
  process.env.DATABASE_URL_UNPOOLED = local.toString();
  process.env.DATABASE_URL_TEST = local.toString();
  const { db } = await import("../src/lib/db");
  const { loans } = await import("../src/lib/db/schema/loans");
  const { payments } = await import("../src/lib/db/schema/payments");
  const { transactions } = await import("../src/lib/db/schema/transactions");
  const { transactionCategories } = await import("../src/lib/db/schema/transaction-categories");
  const { financialCorrectionAgentReviews } = await import(
    "../src/lib/db/schema/financial-correction-agent-reviews");
  const { rolloverCorrectionRuns } = await import(
    "../src/lib/db/schema/rollover-correction-runs");
  const { loadRolloverCorrectionPlans } = await import(
    "../src/services/rollover-correction.service");
  const { reviewRolloverCorrection, applyRolloverCorrection } = await import(
    "../src/services/rollover-correction-apply.service");
  const digest = (value: unknown) => createHash("sha256")
    .update(JSON.stringify(value)).digest("hex");
  const cashCategories = await db.select({ id: transactionCategories.id })
    .from(transactionCategories).where(eq(transactionCategories.name, "Cash"));
  if (cashCategories.length !== 1) throw new Error("Restored Cash category is ambiguous");
  const [cashCategory] = cashCategories;
  const beforePayments = digest(await db.select().from(payments).orderBy(payments.id));
  const beforeTransactions = await db.select().from(transactions).orderBy(transactions.id);
  const beforeTransactionById = new Map(beforeTransactions.map((row) =>
    [row.id, digest(row)]));
  const beforeCash = digest(beforeTransactions.filter((row) =>
    row.categoryId === cashCategory.id));
  const beforeLoans = await db.select({ id: loans.id, status: loans.status })
    .from(loans).orderBy(loans.id);
  const portfolio = await loadRolloverCorrectionPlans();
  if (portfolio.plans.reduce((n, plan) => n + plan.edges.length, 0) !==
      portfolio.liveLinks + portfolio.deletedLinks) {
    throw new Error("Restored rollover portfolio link inventory does not reconcile");
  }
  const plan = portfolio.plans.find((item) => item.planHash === planHash);
  if (!plan || plan.inputFingerprint !== inputFingerprint ||
      plan.classification === "blocked" || !plan.edges.length) {
    throw new Error("Target chain is absent, changed, or blocked on the restored database");
  }
  const chainRootId = plan.edges[0].predecessorId;
  const review = await reviewRolloverCorrection(plan, "agent:rollover-rehearsal-reviewer",
    `rehearsal:${verified.dumpSha256}:${planHash}`);
  if (review.verdict !== "pass") {
    throw new Error(`Restored target agent review failed: ${review.findings.join("; ")}`);
  }
  const [reviewRow] = await db.select().from(financialCorrectionAgentReviews)
    .where(eq(financialCorrectionAgentReviews.id, review.reviewId));
  if (!reviewRow || reviewRow.planHash !== planHash ||
      reviewRow.inputFingerprint !== inputFingerprint) {
    throw new Error("Restored agent review did not bind the target plan");
  }
  const result = await applyRolloverCorrection(plan, "agent:rollover-rehearsal-executor", {
    manifestPath: gate.manifestPath, expectedDumpSha256: verified.dumpSha256,
    primaryUrl: local.toString(), directUrl: local.toString(),
    rehearsalSourceUrl: gate.directUrl,
  });
  if (!result.applied || !result.runId) {
    throw new Error("Restored target did not produce a new correction run");
  }
  const [runRow] = await db.select().from(rolloverCorrectionRuns)
    .where(eq(rolloverCorrectionRuns.id, result.runId));
  if (!runRow || runRow.planHash !== planHash || runRow.agentReviewId !== review.reviewId ||
      runRow.chainRootId !== chainRootId ||
      runRow.inputFingerprint !== inputFingerprint ||
      runRow.policyVersion !== plan.policyVersion) {
    throw new Error("Restored correction run did not bind plan and review");
  }
  const [consumedReview] = await db.select().from(financialCorrectionAgentReviews)
    .where(eq(financialCorrectionAgentReviews.id, review.reviewId));
  if (!consumedReview?.consumedAt || consumedReview.consumedByRunId !== result.runId) {
    throw new Error("Restored agent review was not consumed by the correction run");
  }
  const after = (await loadRolloverCorrectionPlans()).plans.find((item) =>
    item.edges[0]?.predecessorId === chainRootId);
  const reconciled = !!after && after.classification !== "blocked" &&
    after.edges.every((edge) => new BigNumber(edge.deltaPrincipal).isZero()) &&
    after.settlementChanges.every((change) =>
      new BigNumber(change.newInterest).eq(change.oldInterest) &&
      new BigNumber(change.newPrincipal).eq(change.oldPrincipal) &&
      new BigNumber(change.newOverpayment).eq(change.oldOverpayment));
  const paymentsUnchanged = beforePayments === digest(await db.select().from(payments)
    .orderBy(payments.id));
  const afterTransactions = await db.select().from(transactions).orderBy(transactions.id);
  const afterTransactionById = new Map(afterTransactions.map((row) =>
    [row.id, digest(row)]));
  const sourceJournalsUnchanged = beforeTransactions.every((row) =>
    afterTransactionById.get(row.id) === beforeTransactionById.get(row.id));
  const cashUnchanged = beforeCash === digest(afterTransactions.filter((row) =>
    row.categoryId === cashCategory.id));
  const statusesUnchanged = JSON.stringify(beforeLoans) === JSON.stringify(
    await db.select({ id: loans.id, status: loans.status }).from(loans).orderBy(loans.id));
  const correctionRows = afterTransactions.filter((row) =>
    !beforeTransactionById.has(row.id));
  const groups = new Map<string, BigNumber>();
  for (const row of correctionRows) {
    if (!row.journalGroupId) throw new Error("Correction journal lacks a group");
    const sum = groups.get(row.journalGroupId) ?? new BigNumber(0);
    groups.set(row.journalGroupId, sum.plus(row.type === "debit"
      ? row.amount : new BigNumber(row.amount).negated()));
  }
  const journalGroupsBalanced = [...groups.values()].every((sum) => sum.isZero());
  const nonCashCorrection =
    correctionRows.every((row) => row.categoryId !== cashCategory.id &&
      row.recordedBy === "agent:rollover-rehearsal-executor" &&
      row.description?.includes(result.runId!));
  if (!reconciled || !paymentsUnchanged || !cashUnchanged || !statusesUnchanged ||
      !sourceJournalsUnchanged || !journalGroupsBalanced || !nonCashCorrection) {
    throw new Error("Restored rollover correction failed post-apply reconciliation");
  }
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl);
  const proof = { dumpSha256: verified.dumpSha256, sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
    restoredDatabase: databaseName, restoredAt: new Date().toISOString(), ...counts,
    chainRootId, planHash, inputFingerprint, policyVersion: plan.policyVersion,
    reviewEvidenceSha256: reviewRow.evidenceSha256,
    reviewId: review.reviewId, reviewVerdict: review.verdict,
    runId: result.runId, applied: true, reconciled,
    paymentsUnchanged, cashUnchanged, statusesUnchanged, sourceJournalsUnchanged,
    journalGroupsBalanced, nonCashCorrection };
  if (!validRolloverRestoreProof(proof, proof)) {
    throw new Error("Restored rollover database failed proof checks");
  }
  const proofPath = `${verified.dumpPath}.rollover-restore.json`;
  const file = await open(proofPath, "wx", 0o600);
  try { await file.writeFile(`${JSON.stringify(proof, null, 2)}\n`); }
  finally { await file.close(); }
  console.log(JSON.stringify({ proofPath, restoredDatabase: databaseName,
    planHash, runId: result.runId, ...counts }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Rollover restore rehearsal failed");
  process.exitCode = 1;
});
