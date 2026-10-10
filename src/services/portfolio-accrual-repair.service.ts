import BigNumber from "bignumber.js"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { auditLog } from "@/lib/db/schema/audit"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { buildLoanStatement } from "@/lib/loan-statement"
import { planPortfolioAccrualRepair, type PortfolioAccrualPlan,
  type PortfolioAccrualSnapshot } from "@/lib/interest/portfolio-accrual-repair"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger } from "./ledger-queries.service"

type QueryDb = Pick<typeof db, "select">

function net(rows: Array<{ type: "debit" | "credit"; amount: string }>): BigNumber {
  return rows.reduce((sum, row) => row.type === "debit"
    ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0))
}

/** Load one loan's accounting facts without changing the database. */
export async function loadPortfolioAccrualPlan(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<PortfolioAccrualPlan> {
  const [loan] = await queryDb.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new Error("Portfolio accrual loan not found")
  const [paymentRows, waiverRows, auditRows, successors, categoryRows] = await Promise.all([
    queryDb.select().from(payments).where(eq(payments.loanId, loanId)),
    queryDb.select().from(loanWaivers).where(eq(loanWaivers.loanId, loanId)),
    queryDb.select().from(auditLog).where(and(eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loanId))),
    queryDb.select({ id: loans.id }).from(loans).where(eq(loans.rolledOverFrom, loanId)),
    queryDb.select().from(transactionCategories).where(inArray(transactionCategories.name,
      ["Interest Receivable", "Interest Earned", "Cash", "Loans Receivable"])),
  ])
  const exceptions: string[] = []
  if (loan.deletedAt) exceptions.push("Loan is deleted")
  if (successors.length) exceptions.push("Loan has a rollover successor")
  if (loan.interestRateOverride || auditRows.some((row) =>
    row.action.includes("rate_change") || row.action === "loan.update" &&
      /interestRate|interest_rate/i.test(`${row.beforeValue ?? ""}${row.afterValue ?? ""}`))) {
    exceptions.push("Rate-change history requires its separate correction review")
  }
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
  const groups = new Map<string, typeof journalRows>()
  for (const row of journalRows) {
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
  const receivableJournals: PortfolioAccrualSnapshot["receivableJournals"] = []
  for (const row of journalRows.filter((journal) => journal.categoryName === "Interest Receivable")) {
    const group = row.journalGroupId ? groups.get(row.journalGroupId) ?? [] : []
    const earned = group.find((item) => item.categoryName === "Interest Earned")
    if (row.categoryType !== "asset" || group.length !== 2 || !earned ||
        earned.categoryType !== "revenue" || earned.amount !== row.amount ||
        earned.type === row.type || earned.date.getTime() !== row.date.getTime()) {
      exceptions.push(`Receivable journal ${row.id} has no balanced earned-interest counterpart`)
    }
    receivableJournals.push({ id: row.id, date: row.date, amount: row.amount,
      type: row.type, journalGroupId: row.journalGroupId,
      earnedCounterpartAmount: earned?.amount ?? null,
      earnedCounterpartType: earned?.type ?? null })
  }
  if (loan.status === "active" || loan.status === "fully_paid") {
    const statement = buildLoanStatement({ loan: { ...loan, createdAt: loan.startDate }, today: asOf,
      payments: mappedPayments.filter((row) => row.paymentDate <= asOf)
        .map((row) => ({ ...row, recorderName: "" })),
      waivers: mappedWaivers.filter((row) => row.waiverDate <= asOf) })
    const principal = await getLoanBalanceFromLedger(loanId, asOf, queryDb)
    if (principal.minus(statement.finalState.principalBalance).abs().gt(1)) {
      exceptions.push("Loan principal balance does not reconcile to the ledger")
    }
  }
  const snapshot: PortfolioAccrualSnapshot = {
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
    sourceExceptions: exceptions, asOf,
  }
  return planPortfolioAccrualRepair(snapshot)
}
