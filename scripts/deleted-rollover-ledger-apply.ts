/** Apply one previously reviewed, backed-up and rehearsed exact correction. */
import "dotenv/config"
import { createHash } from "node:crypto"
import BigNumber from "bignumber.js"
import { and, eq } from "drizzle-orm"
import { db } from "../src/lib/db"
import { transactions } from "../src/lib/db/schema/transactions"
import { transactionCategories } from "../src/lib/db/schema/transaction-categories"
import { loans } from "../src/lib/db/schema/loans"
import { payments } from "../src/lib/db/schema/payments"
import { financialSnapshots } from "../src/lib/db/schema/financial-snapshots"
import { financialCorrectionAgentReviews } from
  "../src/lib/db/schema/financial-correction-agent-reviews"
import { verifyDeletedRolloverBackup } from
  "../src/lib/financial-corrections/deleted-rollover-backup"
import { loadDeletedRolloverSource } from
  "../src/services/deleted-rollover-ledger.service"
import { planDeletedRolloverLedgerRepair } from
  "../src/lib/financial-corrections/deleted-rollover-ledger"
import { applyDeletedRolloverLedgerRepair } from
  "../src/services/deleted-rollover-ledger-apply.service"

function option(name: string): string {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
  if (!arg) throw new Error(`--${name} is required`)
  return arg.slice(name.length + 3)
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

async function main() {
  if (process.env.CYPRESS === "true") {
    throw new Error("Deleted-rollover apply cannot use the Cypress database override")
  }
  const predecessorId = option("predecessor-id")
  const planHash = option("plan-hash")
  const inputFingerprint = option("input-fingerprint")
  const executorAgentId = `agent:${process.env.CODEX_THREAD_ID ?? ""}`
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(predecessorId) ||
      ![planHash, inputFingerprint].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      executorAgentId === "agent:") {
    throw new Error("Exact predecessor, plan identity and executor agent are required")
  }
  const backupGate = { manifestPath: option("backup-manifest"),
    expectedDumpSha256: option("backup-sha256"),
    primaryUrl: process.env.DATABASE_URL ?? "",
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? "" }
  const plan = await db.transaction(async (tx) =>
    planDeletedRolloverLedgerRepair(
      await loadDeletedRolloverSource(predecessorId, tx)),
  { isolationLevel: "repeatable read", accessMode: "read only" })
  if (plan.classification !== "ready" || plan.planHash !== planHash ||
      plan.inputFingerprint !== inputFingerprint) {
    throw new Error("Live source is stale or no longer ready")
  }
  if (process.argv.includes("--verify-only")) {
    const [review] = await db.select().from(financialCorrectionAgentReviews)
      .where(and(eq(financialCorrectionAgentReviews.kind, "deleted_rollover_ledger"),
        eq(financialCorrectionAgentReviews.planHash, planHash)))
    if (!review || review.verdict !== "pass" || review.consumedAt ||
        review.reviewerAgentId === executorAgentId) {
      throw new Error("Current independent agent review is missing or consumed")
    }
    const archive = await verifyDeletedRolloverBackup(backupGate, {
      predecessorId, successorId: plan.successorId,
      planHash, inputFingerprint,
      reviewEvidenceSha256: review.evidenceSha256,
      amount: plan.legs[0].amount,
      effectiveDate: plan.effectiveDate.toISOString(),
      sourceGroupId: plan.sourceGroupId,
    }, false, process.env.DATABASE_URL_TEST)
    console.log(JSON.stringify({ verifiedOnly: true, predecessorId,
      planHash, reviewId: review.id, dumpSha256: archive.dumpSha256 }, null, 2))
    return
  }
  const [cashCategory] = await db.select().from(transactionCategories)
    .where(eq(transactionCategories.name, "Cash"))
  if (!cashCategory || cashCategory.type !== "asset") {
    throw new Error("Cash category is missing or ambiguous")
  }
  const before = {
    loans: digest(await db.select().from(loans).orderBy(loans.id)),
    payments: digest(await db.select().from(payments).orderBy(payments.id)),
    snapshots: digest(await db.select().from(financialSnapshots)
      .orderBy(financialSnapshots.id)),
    journals: await db.select().from(transactions).orderBy(transactions.id),
  }
  const originalJournalDigests = new Map(before.journals.map((row) =>
    [row.id, digest(row)]))
  const beforeCash = digest(before.journals.filter((row) =>
    row.categoryId === cashCategory.id))
  const result = await applyDeletedRolloverLedgerRepair(
    plan, executorAgentId, backupGate)
  const afterJournals = await db.select().from(transactions).orderBy(transactions.id)
  const correctionRows = await db.select().from(transactions).where(and(
    eq(transactions.referenceType, "deleted_rollover_ledger_repair"),
    eq(transactions.referenceId, planHash)))
  const checks = {
    loansUnchanged: before.loans === digest(await db.select().from(loans)
      .orderBy(loans.id)),
    paymentsUnchanged: before.payments === digest(await db.select().from(payments)
      .orderBy(payments.id)),
    snapshotsUnchanged: before.snapshots === digest(await db.select()
      .from(financialSnapshots).orderBy(financialSnapshots.id)),
    originalJournalsUnchanged: before.journals.every((row) =>
      originalJournalDigests.get(row.id) === digest(afterJournals.find((item) =>
        item.id === row.id))),
    cashUnchanged: beforeCash === digest(afterJournals.filter((row) =>
      row.categoryId === cashCategory.id)),
    exactNewGroup: correctionRows.length === 2 && correctionRows.every((row) =>
      row.journalGroupId === result.journalGroupId &&
      row.loanId === plan.successorId && row.amount === plan.legs[0].amount) &&
      correctionRows.reduce((sum, row) => row.type === "debit" ?
        sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0)).isZero(),
  }
  const sourceAfter = await loadDeletedRolloverSource(predecessorId)
  const categories = ["Cash", "Loans Receivable", "Interest Earned",
    "Issuance Fees", "Overpayment Revenue", "Loan Losses"]
  const accountsZero = categories.every((category) =>
    [plan.predecessorId, plan.successorId].every((loanId) =>
      sourceAfter.journals.filter((row) => row.loanId === loanId &&
        row.categoryName === category).reduce((sum, row) =>
        row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
        new BigNumber(0)).isZero()))
  if (!Object.values(checks).every(Boolean) || !accountsZero) {
    throw new Error(`Run ${result.runId} posted; STOP further repairs: ` +
      JSON.stringify({ ...checks, accountsZero }))
  }
  console.log(JSON.stringify({ predecessorId, successorId: plan.successorId,
    planHash, runId: result.runId, journalGroupId: result.journalGroupId,
    amount: plan.legs[0].amount, correctionRows: correctionRows.length,
    checks: { ...checks, accountsZero } }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Apply failed")
  process.exitCode = 1
})
