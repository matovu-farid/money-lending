/** Restore the exact production archive, apply locally, and attest accounting invariants. */
import "dotenv/config"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import BigNumber from "bignumber.js"
import { and, eq, inArray } from "drizzle-orm"
import postgres from "postgres"
import { verifyHistoricalRateArchive } from
  "../src/lib/interest/historical-rate-backup"
import { validDeletedRolloverRestoreProof } from
  "../src/lib/financial-corrections/deleted-rollover-backup"
import { validateCorrectionDatabaseEndpoints } from
  "../src/lib/interest/rollover-snapshot-guard"

function option(name: string): string {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
  if (!arg) throw new Error(`--${name} is required`)
  return arg.slice(name.length + 3)
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { env, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr ?? "").slice(0, 1200)}`)
  }
}

async function main() {
  const predecessorId = option("predecessor-id")
  const planHash = option("plan-hash")
  const inputFingerprint = option("input-fingerprint")
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(predecessorId) ||
      ![planHash, inputFingerprint].every((value) => /^[a-f0-9]{64}$/.test(value))) {
    throw new Error("Exact predecessor, plan hash and fingerprint are required")
  }
  const gate = { manifestPath: option("backup-manifest"),
    expectedDumpSha256: option("backup-sha256"),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "" }
  const verified = await verifyHistoricalRateArchive(gate)
  const { backup } = validateCorrectionDatabaseEndpoints(gate.primaryUrl, gate.directUrl)
  const local = new URL(process.env.DATABASE_URL_TEST ?? "")
  if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) ||
      decodeURIComponent(local.pathname.slice(1)) !== "money_lending_integration_test") {
    throw new Error("Rehearsal root must be the isolated local integration-test server")
  }
  const databaseName = `money_lending_rehearsal_deleted_${verified.dumpSha256.slice(0, 12)}`
  const root = postgres(local.toString(), { max: 1 })
  try {
    const existing = await root`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`
    if (existing.length) throw new Error("The exact isolated rehearsal database already exists")
  } finally { await root.end() }
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: local.hostname, PGPORT: local.port || "5432",
    PGUSER: decodeURIComponent(local.username),
    PGPASSWORD: decodeURIComponent(local.password),
    PGDATABASE: "money_lending_integration_test", PGSSLMODE: "disable" }
  delete env.PGSERVICE
  run("createdb", ["--no-password", "--template=template0", databaseName], env)
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error",
    `--dbname=${databaseName}`, verified.dumpPath], env)
  local.pathname = `/${databaseName}`
  process.env.DATABASE_URL = local.toString()
  process.env.DATABASE_URL_UNPOOLED = local.toString()
  const { db } = await import("../src/lib/db")
  const { loans } = await import("../src/lib/db/schema/loans")
  const { payments } = await import("../src/lib/db/schema/payments")
  const { transactions } = await import("../src/lib/db/schema/transactions")
  const { transactionCategories } = await import("../src/lib/db/schema/transaction-categories")
  const { financialCorrectionAgentReviews } = await import(
    "../src/lib/db/schema/financial-correction-agent-reviews")
  const { auditLog } = await import("../src/lib/db/schema/audit")
  const { financialSnapshots } = await import(
    "../src/lib/db/schema/financial-snapshots")
  const { loadDeletedRolloverSource } = await import(
    "../src/services/deleted-rollover-ledger.service")
  const { planDeletedRolloverLedgerRepair } = await import(
    "../src/lib/financial-corrections/deleted-rollover-ledger")
  const { applyDeletedRolloverLedgerRepair } = await import(
    "../src/services/deleted-rollover-ledger-apply.service")
  const source = await loadDeletedRolloverSource(predecessorId)
  const plan = planDeletedRolloverLedgerRepair(source)
  if (plan.classification !== "ready" || plan.planHash !== planHash ||
      plan.inputFingerprint !== inputFingerprint) {
    throw new Error("Restored source does not match the exact reviewed plan")
  }
  const [review] = await db.select().from(financialCorrectionAgentReviews)
    .where(and(eq(financialCorrectionAgentReviews.kind, "deleted_rollover_ledger"),
      eq(financialCorrectionAgentReviews.planHash, planHash)))
  if (!review || review.verdict !== "pass" || review.consumedAt) {
    throw new Error("Restored archive lacks the unconsumed passing agent review")
  }
  const [cashCategory] = await db.select().from(transactionCategories)
    .where(eq(transactionCategories.name, "Cash"))
  if (!cashCategory || cashCategory.type !== "asset") {
    throw new Error("Cash category is missing or ambiguous")
  }
  const beforeLoans = digest(await db.select().from(loans).orderBy(loans.id))
  const beforePayments = digest(await db.select().from(payments).orderBy(payments.id))
  const beforeSnapshots = digest(await db.select().from(financialSnapshots)
    .orderBy(financialSnapshots.id))
  const beforeJournals = await db.select().from(transactions).orderBy(transactions.id)
  const journalDigests = new Map(beforeJournals.map((row) => [row.id, digest(row)]))
  const beforeCash = digest(beforeJournals.filter((row) => row.categoryId === cashCategory.id))
  const result = await applyDeletedRolloverLedgerRepair(plan,
    `agent:${process.env.CODEX_THREAD_ID ?? ""}`, gate, { rehearsal: true })
  const afterLoans = digest(await db.select().from(loans).orderBy(loans.id))
  const afterPayments = digest(await db.select().from(payments).orderBy(payments.id))
  const snapshotsUnchanged = beforeSnapshots === digest(await db.select()
    .from(financialSnapshots).orderBy(financialSnapshots.id))
  const afterJournals = await db.select().from(transactions).orderBy(transactions.id)
  const newRows = afterJournals.filter((row) => !journalDigests.has(row.id))
  const originalJournalsUnchanged = beforeJournals.every((row) =>
    journalDigests.get(row.id) === digest(afterJournals.find((after) => after.id === row.id)))
  const cashUnchanged = beforeCash === digest(afterJournals.filter((row) =>
    row.categoryId === cashCategory.id))
  const paymentsUnchanged = beforePayments === afterPayments
  const categories = await db.select().from(transactionCategories).where(inArray(
    transactionCategories.name, ["Loans Receivable", "Interest Earned"]))
  const categoryById = new Map(categories.map((row) => [row.id, row.name]))
  const journalGroupsBalanced = newRows.length === 2 &&
    newRows.every((row) => row.journalGroupId === result.journalGroupId &&
      row.referenceId === planHash && row.loanId === plan.successorId) &&
    newRows.reduce((sum, row) => row.type === "debit" ? sum.plus(row.amount) :
      sum.minus(row.amount), new BigNumber(0)).isZero()
  const nonCashCorrection = newRows.length === 2 && newRows.every((row) =>
    categoryById.has(row.categoryId) && row.categoryId !== cashCategory.id)
  const [consumedReview] = await db.select().from(financialCorrectionAgentReviews)
    .where(eq(financialCorrectionAgentReviews.id, review.id))
  const correctionAudit = await db.select().from(auditLog).where(and(
    eq(auditLog.action, "deleted_rollover_ledger_repair"),
    eq(auditLog.entityId, predecessorId)))
  const chainAfter = await loadDeletedRolloverSource(predecessorId)
  const categoriesToCheck = ["Cash", "Loans Receivable", "Interest Earned",
    "Issuance Fees", "Overpayment Revenue", "Loan Losses"]
  const reconciled = beforeLoans === afterLoans &&
    categoriesToCheck.every((category) => [predecessorId, plan.successorId]
      .every((loanId) => chainAfter.journals.filter((row) =>
        row.loanId === loanId && row.categoryName === category)
        .reduce((sum, row) => row.type === "debit" ? sum.plus(row.amount) :
          sum.minus(row.amount), new BigNumber(0)).isZero())) &&
    consumedReview?.consumedByRunId === result.runId &&
    correctionAudit.some((row) => row.afterValue?.includes(result.runId))
  const proof = { dumpSha256: verified.dumpSha256,
    sourceHost: backup.hostname,
    sourceDatabase: decodeURIComponent(backup.pathname.slice(1)),
    predecessorId, successorId: plan.successorId, planHash, inputFingerprint,
    reviewEvidenceSha256: review.evidenceSha256,
    amount: plan.legs[0].amount, effectiveDate: plan.effectiveDate.toISOString(),
    sourceGroupId: plan.sourceGroupId, journalGroupId: result.journalGroupId,
    restoredDatabase: databaseName, restoredAt: new Date().toISOString(),
    reviewVerdict: review.verdict, reviewId: review.id, runId: result.runId,
    applied: !result.alreadyApplied, reconciled, cashUnchanged,
    paymentsUnchanged, snapshotsUnchanged, originalJournalsUnchanged,
    journalGroupsBalanced, nonCashCorrection }
  if (!validDeletedRolloverRestoreProof(proof, proof)) {
    throw new Error("Restored correction did not satisfy exact proof checks")
  }
  const proofPath = `${verified.dumpPath}.deleted-rollover-restore.json`
  const handle = await open(proofPath, "wx", 0o600)
  try { await handle.writeFile(JSON.stringify(proof, null, 2)) }
  finally { await handle.close() }
  console.log(JSON.stringify({ proofPath, ...proof }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Rehearsal failed")
  process.exitCode = 1
})
