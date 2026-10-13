/** Rehearse one exact production-derived allocation plan on its isolated local restore. */
import "dotenv/config"
import { createHash } from "node:crypto"
import { lstat, open, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { transactions } from "@/lib/db/schema/transactions"
import { isIsolatedPortfolioRehearsalDatabase } from
  "@/lib/interest/portfolio-accrual-backup"
import { validPaymentAllocationPlanProof, verifyPaymentAllocationBackup } from
  "@/lib/interest/payment-allocation-backup"
import { planFullyPaidAllocationRepair, type FullyPaidAllocationPlan } from
  "@/lib/interest/fully-paid-allocation-repair"
import { correctionTempDirectory } from "@/lib/interest/rollover-snapshot-guard"
import { applyFullyPaidAllocationRepair, reviewFullyPaidAllocationRepair } from
  "@/services/payment-allocation-repair-apply.service"
import { loadFullyPaidAllocationSnapshot } from
  "@/services/payment-allocation-repair.service"
import { loadPortfolioAccrualPlan } from
  "@/services/portfolio-accrual-repair.service"

type QueryDb = Pick<typeof db, "select">
type RowHashes = { cash: string; loans: string; payments: string; savedSnapshots: string }
type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as JsonObject
}

function exactTempPath(value: string | undefined, suffix: string): string {
  if (!value || resolve(value) !== value || dirname(value) !== correctionTempDirectory ||
      !value.endsWith(suffix)) {
    throw new Error(`Expected an absolute ${suffix} file directly under ${correctionTempDirectory}`)
  }
  return value
}

async function ownerOnlyJson(path: string): Promise<JsonObject> {
  const stat = await lstat(path)
  if (!stat.isFile() || !stat.size || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`Proof input is not an owner-only regular file: ${path}`)
  }
  return object(JSON.parse(await readFile(path, "utf8")) as unknown, path)
}

function canonicalDate(value: unknown, label: string): Date {
  if (typeof value !== "string") throw new Error(`${label} must be a canonical UTC instant`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC instant`)
  }
  return date
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

async function protectedRowHashes(queryDb: QueryDb): Promise<RowHashes> {
  const cashCategories = await queryDb.select({ id: transactionCategories.id,
    type: transactionCategories.type })
    .from(transactionCategories).where(eq(transactionCategories.name, "Cash"))
  if (cashCategories.length !== 1 || cashCategories[0].type !== "asset") {
    throw new Error("Restored Cash category is ambiguous or wrong-type")
  }
  const [cashRows, loanRows, paymentRows, snapshotRows] = await Promise.all([
    queryDb.select().from(transactions).where(eq(transactions.categoryId, cashCategories[0].id))
      .orderBy(transactions.id),
    queryDb.select().from(loans).orderBy(loans.id),
    queryDb.select().from(payments).orderBy(payments.id),
    queryDb.select().from(financialSnapshots).orderBy(financialSnapshots.id),
  ])
  return { cash: sha({ category: cashCategories[0], rows: cashRows }),
    loans: sha(loanRows), payments: sha(paymentRows),
    savedSnapshots: sha(snapshotRows) }
}

function options(): { manifestPath: string; dumpSha256: string; reportPath: string;
  loanId: string; checkpoints: Array<{ date: string; delta: string }> } {
  const allowed = new Set(["backup-manifest", "backup-sha256", "report", "loan-id",
    "expect-checkpoint"])
  const found = new Map<string, string[]>()
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z0-9-]+)=(.*)$/.exec(arg)
    if (!match || !allowed.has(match[1])) throw new Error("Unknown rehearsal argument")
    const values = found.get(match[1]) ?? []
    values.push(match[2])
    found.set(match[1], values)
  }
  const one = (name: string): string => {
    const values = found.get(name)
    if (!values || values.length !== 1 || !values[0]) {
      throw new Error(`Exactly one --${name} is required`)
    }
    return values[0]
  }
  const dumpSha256 = one("backup-sha256")
  const loanId = one("loan-id")
  if (!/^[a-f0-9]{64}$/.test(dumpSha256) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(loanId)) {
    throw new Error("Exact archive SHA-256 and loan UUID are required")
  }
  const checkpoints = (found.get("expect-checkpoint") ?? []).map((value) => {
    const match = /^(\d{4}-\d{2}-\d{2}):([+-]?(?:0|[1-9]\d*)\.\d{2})$/.exec(value)
    if (!match || new Date(`${match[1]}T00:00:00.000Z`).toISOString().slice(0, 10) !==
        match[1]) throw new Error("Checkpoint must be YYYY-MM-DD:+/-amount.00")
    return { date: match[1], delta: match[2].replace(/^\+/, "") }
  })
  if (new Set(checkpoints.map((row) => row.date)).size !== checkpoints.length) {
    throw new Error("Duplicate expected checkpoint date")
  }
  return { manifestPath: exactTempPath(one("backup-manifest"), ".dump.manifest.json"),
    dumpSha256, reportPath: exactTempPath(one("report"), ".json"), loanId, checkpoints }
}

function exactSourcePlan(report: JsonObject, loanId: string, sourceHost: string,
  sourceDatabase: string): { asOf: Date; plan: FullyPaidAllocationPlan } {
  const database = object(report.database, "Source report database")
  if (typeof database.host !== "string" ||
      database.host.replace("-pooler.", ".") !== sourceHost ||
      database.name !== sourceDatabase || !Array.isArray(report.plans)) {
    throw new Error("Owner-only preview report does not identify the archive source database")
  }
  const asOf = canonicalDate(report.asOf, "Source report asOf")
  if (asOf > new Date()) throw new Error("Source report asOf is in the future")
  const matches = report.plans.filter((row): row is FullyPaidAllocationPlan =>
    !!row && typeof row === "object" && (row as FullyPaidAllocationPlan).loanId === loanId)
  if (matches.length !== 1 || matches[0].status !== "ready" ||
      matches[0].asOf !== asOf.toISOString() ||
      !/^[a-f0-9]{64}$/.test(matches[0].planHash) ||
      !/^[a-f0-9]{64}$/.test(matches[0].sourceFingerprint)) {
    throw new Error("Source report has no single exact ready allocation plan")
  }
  return { asOf, plan: matches[0] }
}

function assertSameReady(source: FullyPaidAllocationPlan,
  restored: FullyPaidAllocationPlan): void {
  if (restored.status !== "ready" || source.planHash !== restored.planHash ||
      source.sourceFingerprint !== restored.sourceFingerprint ||
      source.policyVersion !== restored.policyVersion ||
      source.loanId !== restored.loanId || source.asOf !== restored.asOf) {
    throw new Error("Restored ready allocation plan differs from the source preview")
  }
}

function assertAllocationNoop(plan: FullyPaidAllocationPlan, label: string): void {
  if (plan.status !== "noop" || plan.effects.length !== 0 ||
      plan.finalPrincipal !== "0.00" || plan.loanId === "" ||
      plan.allocations.length === 0 || plan.allocations.some((row) =>
        row.current.interest !== row.after.interest ||
        row.current.principal !== row.after.principal ||
        row.current.overpayment !== row.after.overpayment)) {
    throw new Error(`${label} allocation did not reconcile to an exact noop`)
  }
}

async function main(): Promise<void> {
  const selected = options()
  const primaryUrl = process.env.DATABASE_URL ?? ""
  const directUrl = process.env.DATABASE_URL_UNPOOLED ?? ""
  if (!isIsolatedPortfolioRehearsalDatabase(primaryUrl, directUrl)) {
    throw new Error("Allocation rehearsal may only use one exact isolated loopback database")
  }
  const restoredDatabase = decodeURIComponent(new URL(primaryUrl).pathname.slice(1))
  if (restoredDatabase !== `money_lending_rehearsal_${selected.dumpSha256.slice(0, 12)}`) {
    throw new Error("Restored database name does not match the exact archive SHA-256")
  }
  const manifest = await ownerOnlyJson(selected.manifestPath)
  if (manifest.dumpSha256 !== selected.dumpSha256 ||
      typeof manifest.sourceHost !== "string" ||
      typeof manifest.sourceDatabase !== "string" ||
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(manifest.sourceHost)) {
    throw new Error("Manifest does not identify the exact production-derived archive")
  }
  const gate = { manifestPath: selected.manifestPath,
    expectedDumpSha256: selected.dumpSha256, primaryUrl, directUrl }
  // This validates the archive manifest, full-data catalog, restore proof, build and schema.
  const verified = await verifyPaymentAllocationBackup(gate)
  if (verified.dumpSha256 !== selected.dumpSha256) {
    throw new Error("Verified dump checksum differs from the requested archive")
  }
  const restore = await ownerOnlyJson(`${verified.dumpPath}.restore.json`)
  if (restore.dumpSha256 !== verified.dumpSha256 ||
      restore.restoredDatabase !== restoredDatabase) {
    throw new Error("Restore proof belongs to a different database or archive")
  }
  const outputPath = exactTempPath(`${verified.dumpPath}.allocation-plans.json`, ".json")
  try {
    await lstat(outputPath)
    throw new Error("Exact allocation rehearsal proof already exists")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  const sourceReport = await ownerOnlyJson(selected.reportPath)
  const { asOf, plan: sourcePlan } = exactSourcePlan(sourceReport, selected.loanId,
    manifest.sourceHost, manifest.sourceDatabase)
  const identity = await db.execute<{ name: string; role: string }>(sql`
    SELECT current_database() AS name, current_user AS role`)
  if (identity[0]?.name !== restoredDatabase ||
      identity[0]?.role !== decodeURIComponent(new URL(primaryUrl).username)) {
    throw new Error("Connected database does not match the isolated restore URL")
  }

  const before = await db.transaction(async (tx) => {
    const snapshot = await loadFullyPaidAllocationSnapshot(selected.loanId, asOf, tx)
    return { plan: planFullyPaidAllocationRepair(snapshot), hashes: await protectedRowHashes(tx) }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  assertSameReady(sourcePlan, before.plan)

  const review = await reviewFullyPaidAllocationRepair(before.plan,
    "agent:allocation-rehearsal-reviewer",
    `allocation-rehearsal:${before.plan.loanId}:${before.plan.planHash}`)
  if (review.verdict !== "pass" || review.findings.length !== 0) {
    throw new Error(`Rehearsal review failed: ${review.findings.join("; ")}`)
  }
  const applied = await applyFullyPaidAllocationRepair(before.plan,
    "agent:allocation-rehearsal-executor", gate, { rehearsal: true })
  if (applied.alreadyApplied || !applied.runId) {
    throw new Error("Rehearsal did not create one fresh allocation repair run")
  }

  const observedAt = new Date()
  const after = await db.transaction(async (tx) => {
    const historicalSource = await loadFullyPaidAllocationSnapshot(selected.loanId, asOf, tx)
    const currentSource = await loadFullyPaidAllocationSnapshot(selected.loanId, observedAt, tx)
    const portfolio = await loadPortfolioAccrualPlan(selected.loanId, asOf, tx)
    return { historicalSource, currentSource,
      historical: planFullyPaidAllocationRepair(historicalSource),
      current: planFullyPaidAllocationRepair(currentSource), portfolio,
      hashes: await protectedRowHashes(tx) }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  if (JSON.stringify(before.hashes) !== JSON.stringify(after.hashes)) {
    throw new Error("Rehearsal changed Cash, loans, payments, or saved snapshots")
  }
  if (after.historicalSource.correctionProof?.run.id !== applied.runId ||
      after.currentSource.correctionProof?.run.id !== applied.runId) {
    throw new Error("Historical/current allocation noops lack the fresh run proof")
  }
  assertAllocationNoop(after.historical, "Historical")
  assertAllocationNoop(after.current, "Current")
  if (after.portfolio.classification !== "ready" || after.portfolio.exceptions.length ||
      after.portfolio.entries.length === 0 || after.portfolio.loanId !== selected.loanId ||
      after.portfolio.asOf.toISOString() !== asOf.toISOString() ||
      after.portfolio.entries.some((entry) => !Number.isFinite(entry.date.getTime()) ||
        entry.date > asOf || entry.period !== entry.date.toISOString().slice(0, 7) ||
        !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(entry.delta))) {
    throw new Error(`Portfolio did not produce exact dated ready entries: ${after.portfolio.exceptions.join("; ")}`)
  }
  for (const expected of selected.checkpoints) {
    const matches = after.portfolio.entries.filter((entry) =>
      entry.date.toISOString().slice(0, 10) === expected.date)
    if (matches.length !== 1 || matches[0].delta !== expected.delta) {
      throw new Error(`Portfolio checkpoint ${expected.date}:${expected.delta} differs from rehearsal`)
    }
  }

  const proof = { dumpSha256: verified.dumpSha256, restoredDatabase,
    loanId: before.plan.loanId, planHash: before.plan.planHash,
    inputFingerprint: before.plan.sourceFingerprint, asOf: before.plan.asOf,
    classification: "ready", rehearsalAppliedAndReconciled: true,
    unchangedCashLoansPaymentsSnapshots: true, completedAt: new Date().toISOString(),
    runId: applied.runId, historicalNoopPlanHash: after.historical.planHash,
    currentNoopPlanHash: after.current.planHash,
    portfolioPlanHash: after.portfolio.planHash,
    portfolioEntries: after.portfolio.entries.map((entry) => ({
      date: entry.date.toISOString(), delta: entry.delta,
      resultingReceivable: entry.resultingReceivable })),
    protectedRowHashes: after.hashes }
  if (!validPaymentAllocationPlanProof(proof, {
    dumpSha256: verified.dumpSha256, restoredDatabase, loanId: before.plan.loanId,
    planHash: before.plan.planHash, inputFingerprint: before.plan.sourceFingerprint,
    asOf: before.plan.asOf })) {
    throw new Error("Successful rehearsal did not satisfy the exact proof contract")
  }
  const file = await open(outputPath, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(proof, null, 2)}\n`)
    await file.sync()
  }
  finally { await file.close() }
  console.log(JSON.stringify({ proofPath: outputPath, loanId: before.plan.loanId,
    runId: applied.runId, portfolioEntries: after.portfolio.entries.length,
    unchangedCashLoansPaymentsSnapshots: true }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Allocation rehearsal failed")
  process.exitCode = 1
})
