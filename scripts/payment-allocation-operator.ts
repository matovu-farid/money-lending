/** Agent-only exact review and apply of one fully-paid allocation correction. */
import "dotenv/config"
import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { correctionTempDirectory, validateCorrectionDatabaseEndpoints } from
  "@/lib/interest/rollover-snapshot-guard"
import { verifyPaymentAllocationBackup } from
  "@/lib/interest/payment-allocation-backup"
import { planFullyPaidAllocationRepair, type FullyPaidAllocationPlan } from
  "@/lib/interest/fully-paid-allocation-repair"
import { loadFullyPaidAllocationSnapshot } from
  "@/services/payment-allocation-repair.service"
import { applyFullyPaidAllocationRepair, reviewFullyPaidAllocationRepair } from
  "@/services/payment-allocation-repair-apply.service"

const allowed = new Set(["mode", "expect-host", "expect-database", "backup-manifest",
  "backup-sha256", "report", "loan-id", "reviewer-agent-id", "review-run-id",
  "executor-agent-id"])

function option(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

async function privateReport(path: string | undefined): Promise<{
  database: { host: string; name: string }; asOf: string; plans: FullyPaidAllocationPlan[]
}> {
  if (!path || resolve(path) !== path || dirname(path) !== correctionTempDirectory ||
      !path.endsWith(".json")) {
    throw new Error(`Exact owner-private report must be a JSON file under ${correctionTempDirectory}`)
  }
  const file = await lstat(path)
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Exact payment allocation report must be an owner-only regular file")
  }
  return JSON.parse(await readFile(path, "utf8"))
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--") || !allowed.has(arg.slice(2).split("=")[0])) {
      throw new Error("Unknown payment allocation operator argument")
    }
  }
  const mode = option("mode")
  if (mode !== "review-loan" && mode !== "apply-loan") {
    throw new Error("Explicit review-loan or apply-loan mode is required")
  }
  const { primary } = validateCorrectionDatabaseEndpoints(
    process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED)
  const expectedHost = option("expect-host")
  const expectedDatabase = option("expect-database")
  if (!expectedHost || !expectedDatabase || primary.hostname !== expectedHost ||
      decodeURIComponent(primary.pathname.slice(1)) !== expectedDatabase) {
    throw new Error("Explicit database identity does not match the selected target")
  }
  const identity = await db.execute(sql`SELECT current_database() AS name, current_user AS role`)
  if (identity[0]?.name !== expectedDatabase ||
      identity[0]?.role !== decodeURIComponent(primary.username)) {
    throw new Error("Connected database identity changed")
  }
  const loanId = option("loan-id")
  if (!loanId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(loanId)) {
    throw new Error("One exact loan UUID is required")
  }
  const report = await privateReport(option("report"))
  if (report.database?.host !== expectedHost || report.database?.name !== expectedDatabase) {
    throw new Error("Reviewed report belongs to a different database")
  }
  const matching = report.plans.filter((plan) => plan.loanId === loanId)
  if (matching.length !== 1 || matching[0].status !== "ready") {
    throw new Error("Reviewed report has no single ready plan for this loan")
  }
  const asOf = new Date(report.asOf)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== report.asOf ||
      asOf > new Date()) throw new Error("Reviewed as-of instant is invalid")
  const source = await loadFullyPaidAllocationSnapshot(loanId, asOf)
  const current = planFullyPaidAllocationRepair(source)
  if (current.status !== "ready" || current.planHash !== matching[0].planHash ||
      current.sourceFingerprint !== matching[0].sourceFingerprint ||
      current.policyVersion !== matching[0].policyVersion ||
      current.asOf !== matching[0].asOf) {
    throw new Error("Fully-paid loan plan changed; generate a fresh preview")
  }
  const manifestPath = option("backup-manifest")
  const expectedDumpSha256 = option("backup-sha256")
  if (!manifestPath || !expectedDumpSha256) {
    throw new Error("A verified backup manifest and checksum are required")
  }
  const gate = { manifestPath, expectedDumpSha256,
    primaryUrl: process.env.DATABASE_URL!, directUrl: process.env.DATABASE_URL_UNPOOLED! }
  await verifyPaymentAllocationBackup(gate, { loanId, planHash: current.planHash,
    inputFingerprint: current.sourceFingerprint, asOf })
  if (mode === "review-loan") {
    const reviewerAgentId = option("reviewer-agent-id")
    const reviewRunId = option("review-run-id")
    if (!reviewerAgentId || !reviewRunId || option("executor-agent-id")) {
      throw new Error("A reviewer agent and review run, but no executor, are required")
    }
    const result = await reviewFullyPaidAllocationRepair(current,
      reviewerAgentId, reviewRunId)
    console.log(JSON.stringify({ mode, loanId, planHash: current.planHash, ...result }))
    return
  }
  const executorAgentId = option("executor-agent-id")
  if (!executorAgentId || option("reviewer-agent-id") || option("review-run-id")) {
    throw new Error("A distinct executor agent, but no reviewer, is required")
  }
  const result = await applyFullyPaidAllocationRepair(current, executorAgentId, gate)
  console.log(JSON.stringify({ mode, loanId, planHash: current.planHash, ...result }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Payment allocation operator failed")
  process.exitCode = 1
})
