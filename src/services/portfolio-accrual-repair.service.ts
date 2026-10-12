import BigNumber from "bignumber.js"
import { createHash } from "node:crypto"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { auditLog } from "@/lib/db/schema/audit"
import { historicalRateRepairRuns } from "@/lib/db/schema/historical-rate-repair-runs"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { financialCorrectionAgentReviews } from
  "@/lib/db/schema/financial-correction-agent-reviews"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { buildLoanStatement } from "@/lib/loan-statement"
import { planPortfolioAccrualRepair, type PortfolioAccrualPlan } from
  "@/lib/interest/portfolio-accrual-repair"
import { historicalRateCorrectionExceptions } from
  "@/lib/interest/portfolio-accrual-repair"
import type { AttributedPortfolioAccrualSnapshot } from
  "@/lib/financial-corrections/portfolio-verifier"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger } from "./ledger-queries.service"

type QueryDb = Pick<typeof db, "select">

function net(rows: Array<{ type: "debit" | "credit"; amount: string }>): BigNumber {
  return rows.reduce((sum, row) => row.type === "debit"
    ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0))
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function rateTermsEdited(value: string | null): boolean {
  if (!value) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      ["interestRate", "interestRateOverride", "startDate", "principalAmount",
        "penaltyMultiplier", "penaltyWaived", "minInterestDays"].some((key) =>
        Object.hasOwn(parsed, key))
  } catch { return true }
}

/** Load one loan's reconciled accounting facts without changing the database. */
export async function loadPortfolioAccrualSnapshot(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<AttributedPortfolioAccrualSnapshot> {
  const [loan] = await queryDb.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new Error("Portfolio accrual loan not found")
  const [paymentRows, waiverRows, auditRows, successors, categoryRows, runs,
    portfolioRuns] = await Promise.all([
    queryDb.select().from(payments).where(eq(payments.loanId, loanId)),
    queryDb.select().from(loanWaivers).where(eq(loanWaivers.loanId, loanId)),
    queryDb.select().from(auditLog).where(and(eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loanId))),
    queryDb.select({ id: loans.id }).from(loans).where(eq(loans.rolledOverFrom, loanId)),
    queryDb.select().from(transactionCategories).where(inArray(transactionCategories.name,
      ["Interest Receivable", "Interest Earned", "Cash", "Loans Receivable"])),
    queryDb.select().from(historicalRateRepairRuns)
      .where(eq(historicalRateRepairRuns.loanId, loanId)),
    queryDb.select().from(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.loanId, loanId)),
  ])
  const exceptions: string[] = []
  if (loan.deletedAt) exceptions.push("Loan is deleted")
  if (successors.length) exceptions.push("Loan has a rollover successor")
  const rateHistory = !!loan.interestRateOverride || runs.length > 0 ||
    auditRows.some((row) => row.action.includes("rate_change") ||
      row.action === "historical_rate_corrected_by_agent" ||
      row.action === "loan.update" &&
      rateTermsEdited(`${row.beforeValue ?? ""}`) ||
      row.action === "loan.update" && rateTermsEdited(row.afterValue))
  if (rateHistory && runs.length !== 1) {
    exceptions.push("Rate history requires exactly one completed historical correction run")
  }
  const correctionAudits = auditRows.filter((row) =>
    row.action === "historical_rate_corrected_by_agent")
  if (rateHistory && correctionAudits.length !== 1) {
    exceptions.push("Historical rate correction audit is missing or ambiguous")
  }
  const correctionAudit = correctionAudits[0]
  if (correctionAudit && auditRows.some((row) =>
    row.id !== correctionAudit.id && row.occurredAt >= correctionAudit.occurredAt &&
    (row.action.includes("rate_change") ||
      row.action === "historical_rate_corrected_by_agent" ||
      row.action === "loan.update" &&
      (rateTermsEdited(row.beforeValue) || rateTermsEdited(row.afterValue))))) {
    exceptions.push("Loan rate or accrual terms changed after historical correction")
  }
  const run = runs.length === 1 ? runs[0] : null
  const [review] = run?.agentReviewId
    ? await queryDb.select().from(financialCorrectionAgentReviews)
      .where(eq(financialCorrectionAgentReviews.id, run.agentReviewId)) : []
  const historicalRateCorrection = run && review && correctionAudit
    ? { run, review, audit: correctionAudit } : undefined
  for (const name of ["Interest Earned", "Cash", "Loans Receivable"]) {
    const rows = categoryRows.filter((row) => row.name === name)
    const expected = name === "Interest Earned" ? "revenue" : "asset"
    if (rows.length !== 1 || rows[0].type !== expected) {
      exceptions.push(`${name} account is missing or ambiguous`)
    }
  }
  const receivableRows = categoryRows.filter((row) => row.name === "Interest Receivable")
  if (receivableRows.length > 1 || receivableRows.some((row) => row.type !== "asset")) {
    exceptions.push("Interest Receivable account is ambiguous or wrong-type")
  }

  const activePayments = paymentRows.filter((row) => !row.deletedAt && !row.markedWrong)
  const activeWaivers = waiverRows.filter((row) => !row.deletedAt)
  if (paymentRows.length !== activePayments.length || waiverRows.length !== activeWaivers.length) {
    exceptions.push("Deleted or marked-wrong settlement needs separate historical review")
  }
  const settlementIds = [...paymentRows.map((row) => row.id),
    ...waiverRows.map((row) => row.id)]
  const journalRows = await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    date: transactions.transactionDate, type: transactions.type,
    amount: transactions.amount, categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(settlementIds.length
      ? or(eq(transactions.loanId, loanId), inArray(transactions.referenceId, settlementIds))
      : eq(transactions.loanId, loanId))
  const [paymentPortions, waiverPortions] = await Promise.all([
    getPaymentPortionsFromLedger(activePayments.map((row) => row.id), queryDb),
    getWaiverPortionsFromLedger(activeWaivers.map((row) => row.id), queryDb),
  ])
  const mappedPayments = activePayments.map((row) => {
    const portions = paymentPortions.get(row.id)
    if (!portions) exceptions.push(`Payment ${row.id} has no reconciled allocation`)
    const cashRows = journalRows.filter((journal) => journal.referenceId === row.id &&
      ["payment", "payment_reversal"].includes(journal.referenceType ?? "") &&
      journal.categoryName === "Cash")
    if (!net(cashRows).eq(row.amount) ||
        cashRows.some((journal) => journal.date.getTime() !== row.paymentDate.getTime())) {
      exceptions.push(`Payment ${row.id} Cash journal does not match amount and effective date`)
    }
    return { id: row.id, paymentDate: row.paymentDate, amount: row.amount,
      interestPortion: portions?.interestPortion ?? "0.00",
      principalPortion: portions?.principalPortion ?? "0.00" }
  })
  const mappedWaivers = activeWaivers.map((row) => {
    const portions = waiverPortions.get(row.id)
    if (!portions) exceptions.push(`Waiver ${row.id} has no reconciled allocation`)
    return { id: row.id, waiverDate: row.waiverDate, amount: row.amount,
      interestPortion: portions?.interestPortion ?? "0.00",
      principalPortion: portions?.principalPortion ?? "0.00", reason: row.reason }
  })
  const groupIds = [...new Set(journalRows.map((row) => row.journalGroupId)
    .filter((id): id is string => id !== null))]
  const groupRows = groupIds.length ? await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    date: transactions.transactionDate, type: transactions.type,
    amount: transactions.amount, categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(inArray(transactions.journalGroupId, groupIds)) : []
  const groups = new Map<string, typeof journalRows>()
  for (const row of groupRows) {
    if (!row.journalGroupId) continue
    const group = groups.get(row.journalGroupId) ?? []
    group.push(row)
    groups.set(row.journalGroupId, group)
  }
  const settlementTypes = new Set(["payment", "payment_reversal", "loan_waiver",
    "loan_waiver_reversal", "loan_waiver_accrual_reversal"])
  for (const row of journalRows.filter((item) => settlementTypes.has(item.referenceType ?? ""))) {
    const group = row.journalGroupId ? groups.get(row.journalGroupId) ?? [] : []
    if (!row.journalGroupId || group.length < 2 ||
        !net(group).isZero() || group.some((item) =>
          item.loanId !== loanId || item.referenceId !== row.referenceId ||
          item.referenceType !== row.referenceType ||
          item.date.getTime() !== row.date.getTime())) {
      exceptions.push(`Transaction ${row.id} has an unbalanced payment or waiver journal`)
    }
  }
  const receivableJournals: AttributedPortfolioAccrualSnapshot["receivableJournals"] = []
  for (const row of journalRows.filter((journal) => journal.categoryName === "Interest Receivable")) {
    const group = row.journalGroupId ? groups.get(row.journalGroupId) ?? [] : []
    const earned = group.find((item) => item.categoryName === "Interest Earned")
    if (row.categoryType !== "asset" || group.length !== 2 || !earned ||
        earned.categoryType !== "revenue" || earned.amount !== row.amount ||
        earned.type === row.type || earned.date.getTime() !== row.date.getTime() ||
        row.loanId !== loanId || earned.loanId !== loanId ||
        !row.referenceType || !row.referenceId ||
        earned.referenceType !== row.referenceType ||
        earned.referenceId !== row.referenceId ||
        row.depositLocation !== null || row.subLocationId !== null ||
        earned.depositLocation !== null || earned.subLocationId !== null) {
      exceptions.push(`Receivable journal ${row.id} has no balanced earned-interest counterpart`)
    }
    receivableJournals.push({ id: row.id, date: row.date, amount: row.amount,
      type: row.type, journalGroupId: row.journalGroupId,
      loanId: row.loanId, referenceType: row.referenceType,
      referenceId: row.referenceId, categoryName: row.categoryName,
      categoryType: row.categoryType,
      depositLocation: row.depositLocation, subLocationId: row.subLocationId,
      groupEntryCount: group.length,
      earnedCounterpart: earned ? {
        id: earned.id, journalGroupId: earned.journalGroupId,
        loanId: earned.loanId,
        referenceType: earned.referenceType, referenceId: earned.referenceId,
        categoryName: earned.categoryName,
        date: earned.date, amount: earned.amount, type: earned.type,
        categoryType: earned.categoryType,
        depositLocation: earned.depositLocation, subLocationId: earned.subLocationId,
      } : null,
      earnedCounterpartAmount: earned?.amount ?? null,
      earnedCounterpartType: earned?.type ?? null })
  }
  if (run) {
    let after: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(run.afterSummary)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        after = parsed as Record<string, unknown>
      }
    } catch { /* A malformed summary must block below. */ }
    const runAsOf = typeof after?.asOf === "string" ? new Date(after.asOf) : null
    const target = typeof after?.accrualJournalTarget === "string"
      ? new BigNumber(after.accrualJournalTarget) : null
    const endingPrincipal = typeof after?.endingPrincipal === "string"
      ? new BigNumber(after.endingPrincipal) : null
    if (!runAsOf || !Number.isFinite(runAsOf.getTime()) || runAsOf > asOf ||
        !target?.isFinite() || !endingPrincipal?.isFinite()) {
      exceptions.push("Historical correction completion summary is missing or stale")
    } else {
      const laterPortfolioRuns = new Map(portfolioRuns
        .filter((portfolioRun) => portfolioRun.appliedAt > run.appliedAt)
        .map((portfolioRun) => [portfolioRun.id, portfolioRun]))
      const posted = net(receivableJournals.filter((row) => {
        if (row.date > runAsOf) return false
        if (row.referenceType !== "portfolio_accrual_repair") return true
        const portfolioRun = row.referenceId && laterPortfolioRuns.get(row.referenceId)
        if (!portfolioRun) return true
        const counterpart = row.earnedCounterpart
        if (!counterpart || row.groupEntryCount !== 2 ||
            counterpart.referenceType !== "portfolio_accrual_repair" ||
            counterpart.referenceId !== portfolioRun.id ||
            counterpart.journalGroupId !== row.journalGroupId ||
            counterpart.date.getTime() !== row.date.getTime() ||
            counterpart.amount !== row.amount || counterpart.type === row.type) {
          exceptions.push(`Later portfolio journal ${row.id} is not an attributed pair`)
          return true
        }
        return false
      }))
      const runPrincipal = await getLoanBalanceFromLedger(loanId, runAsOf, queryDb)
      if (!posted.eq(target) || !runPrincipal.eq(endingPrincipal)) {
        exceptions.push("Historical correction summary does not reconcile to current ledger")
      }
    }
  }
  let principal: BigNumber | null = null
  if (loan.status === "active" || loan.status === "fully_paid") {
    const statement = buildLoanStatement({ loan: { ...loan, createdAt: loan.startDate }, today: asOf,
      payments: mappedPayments.filter((row) => row.paymentDate <= asOf)
        .map((row) => ({ ...row, recorderName: "" })),
      waivers: mappedWaivers.filter((row) => row.waiverDate <= asOf) })
    principal = await getLoanBalanceFromLedger(loanId, asOf, queryDb)
    if (principal.minus(statement.finalState.principalBalance).abs().gt(1)) {
      exceptions.push("Loan principal balance does not reconcile to the ledger")
    }
  }
  const snapshot: AttributedPortfolioAccrualSnapshot = {
    loan: {
      id: loan.id, principalAmount: loan.principalAmount,
      interestRate: loan.interestRate, interestRateOverride: loan.interestRateOverride,
      penaltyMultiplier: loan.penaltyMultiplier, penaltyWaived: loan.penaltyWaived,
      penaltyWaivedAt: loan.penaltyWaivedAt, penaltyWaivedBy: loan.penaltyWaivedBy,
      minInterestDays: loan.minInterestDays, minPeriodOverride: loan.minPeriodOverride,
      rolledOverFrom: loan.rolledOverFrom, issuanceFee: loan.issuanceFee,
      loanType: loan.loanType, status: loan.status, startDate: loan.startDate,
    },
    payments: mappedPayments, waivers: mappedWaivers,
    receivableJournals,
    receivableCategory: receivableRows.length === 1
      ? { id: receivableRows[0].id, type: receivableRows[0].type } : null,
    historicalRateCorrection,
    sourceDigest: digest({ loan,
      paymentRows: paymentRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      waiverRows: waiverRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      auditRows: auditRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      successors: successors.toSorted((a, b) => a.id.localeCompare(b.id)),
      categoryRows: categoryRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      runs: runs.toSorted((a, b) => a.id.localeCompare(b.id)),
      portfolioRuns: portfolioRuns.toSorted((a, b) => a.id.localeCompare(b.id)), review,
      journalRows: journalRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      groupRows: groupRows.toSorted((a, b) => a.id.localeCompare(b.id)),
      mappedPayments, mappedWaivers, principal: principal?.toFixed(2) ?? null }),
    sourceExceptions: exceptions, asOf,
  }
  if (historicalRateCorrection) {
    snapshot.sourceExceptions.push(...historicalRateCorrectionExceptions(snapshot))
  }
  return snapshot
}

export async function loadPortfolioAccrualPlan(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<PortfolioAccrualPlan> {
  return planPortfolioAccrualRepair(await loadPortfolioAccrualSnapshot(loanId, asOf, queryDb))
}
