import { execFile } from "node:child_process"
import { lstat, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"
import { correctionTempDirectory } from "./rollover-snapshot-guard"
import { verifyPortfolioAccrualBackup } from "./portfolio-accrual-backup"

const execFileAsync = promisify(execFile)
type BackupGate = Parameters<typeof verifyPortfolioAccrualBackup>[0]

/** A schema-only dump is insufficient: the durable review/run rows must be restorable. */
export function paymentAllocationDataInCatalog(catalog: string): boolean {
  const lines = catalog.split(/\r?\n/)
  return ["payment_allocation_repair_runs", "financial_correction_agent_reviews"]
    .every((name) => lines.some((line) =>
      new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE public ${name}(?:\\s|$)`).test(line)) &&
      lines.some((line) =>
        new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE DATA public ${name}(?:\\s|$)`).test(line)))
}

export function validPaymentAllocationPlanProof(value: unknown, expected: {
  dumpSha256: string; restoredDatabase: string; loanId: string;
  planHash: string; inputFingerprint: string; asOf: string
}, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const proof = value as Record<string, unknown>
  const completedAt = Date.parse(String(proof.completedAt))
  return proof.dumpSha256 === expected.dumpSha256 &&
    proof.restoredDatabase === expected.restoredDatabase &&
    proof.loanId === expected.loanId && proof.planHash === expected.planHash &&
    proof.inputFingerprint === expected.inputFingerprint &&
    proof.asOf === expected.asOf && proof.classification === "ready" &&
    proof.rehearsalAppliedAndReconciled === true &&
    proof.unchangedCashLoansPaymentsSnapshots === true &&
    Number.isFinite(completedAt) && completedAt <= now &&
    now - completedAt <= 24 * 60 * 60 * 1000
}

/** Require the full portfolio archive gate plus this exact allocation rehearsal. */
export async function verifyPaymentAllocationBackup(gate: BackupGate, exactPlan?: {
  loanId: string; planHash: string; inputFingerprint: string; asOf: Date
}): ReturnType<typeof verifyPortfolioAccrualBackup> {
  const verified = await verifyPortfolioAccrualBackup(gate)
  const { stdout: catalog } = await execFileAsync("pg_restore", ["--list", verified.dumpPath], {
    maxBuffer: 10 * 1024 * 1024,
  })
  if (!paymentAllocationDataInCatalog(catalog)) {
    throw new Error("Payment allocation backup lacks repair tables or data entries")
  }
  if (!exactPlan) return verified
  const restorePath = `${verified.dumpPath}.restore.json`
  const planPath = `${verified.dumpPath}.allocation-plans.json`
  if (resolve(planPath) !== planPath || dirname(planPath) !== correctionTempDirectory) {
    throw new Error("Payment allocation rehearsal path is unsafe")
  }
  const file = await lstat(planPath)
  if (!file.isFile() || !file.size || (file.mode & 0o077) !== 0 ||
      (process.getuid && file.uid !== process.getuid())) {
    throw new Error("Payment allocation rehearsal must be an owner-only regular file")
  }
  const restore = JSON.parse(await readFile(restorePath, "utf8")) as Record<string, unknown>
  const proof = JSON.parse(await readFile(planPath, "utf8")) as unknown
  if (!validPaymentAllocationPlanProof(proof, {
    dumpSha256: verified.dumpSha256,
    restoredDatabase: String(restore.restoredDatabase),
    loanId: exactPlan.loanId, planHash: exactPlan.planHash,
    inputFingerprint: exactPlan.inputFingerprint, asOf: exactPlan.asOf.toISOString(),
  })) {
    throw new Error("Exact payment allocation plan was not rehearsed on this backup")
  }
  return verified
}
