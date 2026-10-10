import { randomUUID } from "node:crypto"
import BigNumber from "bignumber.js"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema/auth"
import { loans } from "@/lib/db/schema/loans"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { portfolioAccrualRepairApprovals, portfolioAccrualRepairRuns } from
  "@/lib/db/schema/portfolio-accrual-repair-runs"
import type { PortfolioAccrualPlan } from "@/lib/interest/portfolio-accrual-repair"
import { isIsolatedPortfolioRehearsalDatabase, verifyPortfolioAccrualBackup } from
  "@/lib/interest/portfolio-accrual-backup"
import { loadPortfolioAccrualPlan } from "./portfolio-accrual-repair.service"

type QueryDb = Pick<typeof db, "select">
type BackupGate = Parameters<typeof verifyPortfolioAccrualBackup>[0]

async function assertAdministrator(actorId: string, queryDb: QueryDb): Promise<void> {
  const [actor] = await queryDb.select({ role: user.role }).from(user)
    .where(eq(user.id, actorId))
  if (!actor || !["admin", "superAdmin"].includes(actor.role ?? "")) {
    throw new Error("Portfolio accrual repair requires an identified administrator")
  }
}

/** Called from an authenticated admin review action, never an operator-supplied prod actor. */
export async function approvePortfolioAccrualRepair(
  reviewedPlan: PortfolioAccrualPlan,
  approvedBy: string,
  reviewNote: string,
): Promise<string> {
  if (!approvedBy || reviewNote.trim().length < 15 ||
      reviewedPlan.classification !== "ready" || reviewedPlan.asOf > new Date()) {
    throw new Error("An exact ready plan, administrator, and substantive note are required")
  }
  await assertAdministrator(approvedBy, db)
  const current = await loadPortfolioAccrualPlan(reviewedPlan.loanId, reviewedPlan.asOf)
  if (current.classification !== "ready" ||
      current.planHash !== reviewedPlan.planHash ||
      current.inputFingerprint !== reviewedPlan.inputFingerprint ||
      current.policyVersion !== reviewedPlan.policyVersion) {
    throw new Error("Portfolio accrual plan changed before approval")
  }
  const [inserted] = await db.insert(portfolioAccrualRepairApprovals).values({
    loanId: current.loanId, planHash: current.planHash,
    inputFingerprint: current.inputFingerprint, policyVersion: current.policyVersion,
    approvedBy, reviewNote: reviewNote.trim(),
  }).onConflictDoNothing().returning({ id: portfolioAccrualRepairApprovals.id })
  if (inserted) return inserted.id
  const [existing] = await db.select({ id: portfolioAccrualRepairApprovals.id })
    .from(portfolioAccrualRepairApprovals)
    .where(eq(portfolioAccrualRepairApprovals.planHash, current.planHash))
  if (!existing) throw new Error("Portfolio accrual approval was not recorded")
  return existing.id
}

/** Apply one immutable, approved loan plan after verifying a recent full-data backup. */
export async function applyPortfolioAccrualRepair(
  reviewedPlan: PortfolioAccrualPlan,
  appliedBy: string,
  backupGate: BackupGate,
): Promise<{ runId: string; alreadyApplied: boolean }> {
  if (!appliedBy || reviewedPlan.classification !== "ready" ||
      reviewedPlan.asOf > new Date()) {
    throw new Error("A ready plan and identified administrator are required")
  }
  if (!process.env.DATABASE_URL ||
      backupGate.primaryUrl !== process.env.DATABASE_URL ||
      (process.env.DATABASE_URL_UNPOOLED &&
        backupGate.directUrl !== process.env.DATABASE_URL_UNPOOLED)) {
    throw new Error("Backup database identity does not match the configured live connection")
  }
  await assertAdministrator(appliedBy, db)
  const [approval] = await db.select().from(portfolioAccrualRepairApprovals)
    .where(eq(portfolioAccrualRepairApprovals.planHash, reviewedPlan.planHash))
  if (!approval || approval.loanId !== reviewedPlan.loanId ||
      approval.inputFingerprint !== reviewedPlan.inputFingerprint ||
      approval.policyVersion !== reviewedPlan.policyVersion) {
    throw new Error("Exact portfolio accrual repair approval is required")
  }
  const [prior] = await db.select({ id: portfolioAccrualRepairRuns.id })
    .from(portfolioAccrualRepairRuns)
    .where(eq(portfolioAccrualRepairRuns.planHash, reviewedPlan.planHash))
  if (prior) return { runId: prior.id, alreadyApplied: true }
  const rehearsal = isIsolatedPortfolioRehearsalDatabase(
    backupGate.primaryUrl, backupGate.directUrl)
  const backup = await verifyPortfolioAccrualBackup(backupGate, rehearsal ? undefined : {
    planHash: reviewedPlan.planHash, asOf: reviewedPlan.asOf,
  })

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`)
    const identity = await tx.execute(sql`SELECT current_database() AS name, current_user AS role`)
    const configured = new URL(backupGate.primaryUrl)
    if (identity[0]?.name !== decodeURIComponent(configured.pathname.slice(1)) ||
        identity[0]?.role !== decodeURIComponent(configured.username)) {
      throw new Error("Backup database identity does not match the live database session")
    }
    const [existingRun] = await tx.select({ id: portfolioAccrualRepairRuns.id })
      .from(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.planHash, reviewedPlan.planHash))
    if (existingRun) return { runId: existingRun.id, alreadyApplied: true }
    const [loan] = await tx.select().from(loans)
      .where(eq(loans.id, reviewedPlan.loanId)).for("update")
    if (!loan || loan.deletedAt) throw new Error("Portfolio accrual loan changed")
    const current = await loadPortfolioAccrualPlan(loan.id, reviewedPlan.asOf, tx)
    if (current.classification !== "ready" ||
        current.planHash !== reviewedPlan.planHash ||
        current.inputFingerprint !== reviewedPlan.inputFingerprint ||
        current.policyVersion !== reviewedPlan.policyVersion) {
      throw new Error("Portfolio accrual plan is stale or source changed")
    }
    const categories = await tx.select().from(transactionCategories)
      .where(inArray(transactionCategories.name, ["Interest Receivable", "Interest Earned"]))
    const receivable = categories.filter((row) => row.name === "Interest Receivable" &&
      row.type === "asset")
    const earned = categories.filter((row) => row.name === "Interest Earned" &&
      row.type === "revenue")
    if (categories.length !== 2 || receivable.length !== 1 || earned.length !== 1) {
      throw new Error("Portfolio accrual accounting categories are missing or ambiguous")
    }
    const runId = randomUUID()
    for (const entry of current.entries) {
      const delta = new BigNumber(entry.delta)
      if (!delta.isFinite() || delta.isZero() || entry.date > current.asOf) {
        throw new Error("Portfolio accrual entry is invalid")
      }
      const increasing = delta.gt(0)
      const journalGroupId = randomUUID()
      await tx.insert(transactions).values([
        { type: "debit", amount: delta.abs().toFixed(2),
          categoryId: increasing ? receivable[0].id : earned[0].id,
          referenceType: "portfolio_accrual_repair", referenceId: runId,
          loanId: loan.id, description: `Portfolio interest repair ${runId}`,
          transactionDate: entry.date, recordedBy: appliedBy, journalGroupId },
        { type: "credit", amount: delta.abs().toFixed(2),
          categoryId: increasing ? earned[0].id : receivable[0].id,
          referenceType: "portfolio_accrual_repair", referenceId: runId,
          loanId: loan.id, description: `Portfolio interest repair ${runId}`,
          transactionDate: entry.date, recordedBy: appliedBy, journalGroupId },
      ])
    }
    const after = await loadPortfolioAccrualPlan(loan.id, current.asOf, tx)
    if (after.classification !== "noop" || after.entries.length !== 0) {
      throw new Error("Portfolio accrual did not reconcile after posting")
    }
    await tx.insert(portfolioAccrualRepairRuns).values({
      id: runId, loanId: loan.id, planHash: current.planHash,
      inputFingerprint: current.inputFingerprint, policyVersion: current.policyVersion,
      approvedBy: approval.approvedBy, appliedBy, backupSha256: backup.dumpSha256,
      beforeSummary: JSON.stringify({ asOf: current.asOf, entries: current.entries }),
      afterSummary: JSON.stringify({ classification: after.classification,
        inputFingerprint: after.inputFingerprint, planHash: after.planHash }),
    })
    return { runId, alreadyApplied: false }
  })
}
