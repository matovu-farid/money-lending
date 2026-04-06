import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"
import {
  eq,
  and,
  gte,
  lte,
  isNull,
  desc,
  sql,
} from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import {
  calculateInterest,
  calculateDaysOverdue,
  calculateDailyRate,
  formatAmount,
} from "@/lib/interest/engine"
import { getSystemCapital } from "@/services/creditor.service"
import BigNumber from "bignumber.js"
import type { PnlData, BalanceSheetData, PortfolioEntry } from "@/types"

export const getPnlData = (
  period: string
): Effect.Effect<PnlData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [year, month] = period.split("-").map(Number)
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999)

      const rows = await db
        .select({
          type: transactions.type,
          amount: transactions.amount,
          categoryName: transactionCategories.name,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            gte(transactions.transactionDate, periodStart),
            lte(transactions.transactionDate, periodEnd)
          )
        )

      const incomeMap = new Map<string, BigNumber>()
      const expenseMap = new Map<string, BigNumber>()

      for (const row of rows) {
        const amount = new BigNumber(row.amount)
        if (row.type === "credit") {
          const existing = incomeMap.get(row.categoryName) ?? new BigNumber(0)
          incomeMap.set(row.categoryName, existing.plus(amount))
        } else {
          const existing = expenseMap.get(row.categoryName) ?? new BigNumber(0)
          expenseMap.set(row.categoryName, existing.plus(amount))
        }
      }

      const income = Array.from(incomeMap.entries()).map(([category, amount]) => ({
        category,
        amount: formatAmount(amount),
      }))
      const expenses = Array.from(expenseMap.entries()).map(([category, amount]) => ({
        category,
        amount: formatAmount(amount),
      }))

      const totalIncome = Array.from(incomeMap.values()).reduce(
        (sum, amt) => sum.plus(amt),
        new BigNumber(0)
      )
      const totalExpenses = Array.from(expenseMap.values()).reduce(
        (sum, amt) => sum.plus(amt),
        new BigNumber(0)
      )
      const netProfit = totalIncome.minus(totalExpenses)

      return {
        period,
        income,
        totalIncome: formatAmount(totalIncome),
        expenses,
        totalExpenses: formatAmount(totalExpenses),
        netProfit: formatAmount(netProfit),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getBalanceSheetData = (
  asOf: string
): Effect.Effect<BalanceSheetData, DatabaseError> =>
  Effect.flatMap(
    getSystemCapital(),
    (systemCapital) =>
  Effect.tryPromise({
    try: async () => {
      let asOfDate: Date
      if (/^\d{4}-\d{2}$/.test(asOf)) {
        const [year, month] = asOf.split("-").map(Number)
        asOfDate = new Date(year, month, 0, 23, 59, 59, 999) // last day of month
      } else {
        asOfDate = new Date(asOf + "T23:59:59.999Z")
      }

      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(
          eq(loans.status, "active"),
          isNull(loans.deletedAt),
          lte(loans.startDate, asOfDate)
        ))

      let totalLoansOutstanding = new BigNumber(0)

      for (const loan of activeLoans) {
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(
            eq(payments.loanId, loan.id),
            isNull(payments.deletedAt),
            lte(payments.paymentDate, asOfDate)
          ))
          .orderBy(desc(payments.paymentDate), desc(payments.createdAt))

        const lastPayment = loanPayments[0]
        const outstanding = lastPayment
          ? new BigNumber(lastPayment.principalBalanceAfter)
          : new BigNumber(loan.principalAmount)
        totalLoansOutstanding = totalLoansOutstanding.plus(outstanding)
      }

      // Calculate per-location balances
      const locationBalances: Record<string, BigNumber> = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }

      // Payments received into each location (active payments only)
      const allPayments = await db
        .select({
          depositLocation: payments.depositLocation,
          amount: payments.amount,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .where(and(
          lte(payments.paymentDate, asOfDate),
          isNull(loans.deletedAt)
        ))

      for (const p of allPayments) {
        const loc = p.depositLocation
        if (loc && locationBalances[loc] !== undefined) {
          locationBalances[loc] = locationBalances[loc].plus(new BigNumber(p.amount))
        }
      }

      // Disbursements from each location (all non-deleted loans)
      const allLoans = await db
        .select({
          disbursementSource: loans.disbursementSource,
          principalAmount: loans.principalAmount,
        })
        .from(loans)
        .where(and(
          isNull(loans.deletedAt),
          lte(loans.startDate, asOfDate)
        ))

      for (const l of allLoans) {
        const loc = l.disbursementSource
        if (loc && locationBalances[loc] !== undefined) {
          locationBalances[loc] = locationBalances[loc].minus(new BigNumber(l.principalAmount))
        }
      }

      // Fund transfers between locations
      const allFundTransfers = await db
        .select()
        .from(fundTransfers)
        .where(lte(fundTransfers.createdAt, asOfDate))

      for (const t of allFundTransfers) {
        const amount = new BigNumber(t.amount)
        if (locationBalances[t.fromLocation] !== undefined) {
          locationBalances[t.fromLocation] = locationBalances[t.fromLocation].minus(amount)
        }
        if (locationBalances[t.toLocation] !== undefined) {
          locationBalances[t.toLocation] = locationBalances[t.toLocation].plus(amount)
        }
      }

      const cashBalance = locationBalances.cash
      const bankBalance = locationBalances.bank
      const strongRoomBalance = locationBalances.strong_room
      const totalAssets = totalLoansOutstanding.plus(cashBalance).plus(bankBalance).plus(strongRoomBalance)

      const totalCreditorBalances = new BigNumber(systemCapital.totalOutstanding)

      const shareCapitalRows = await db
        .select({ amount: transactions.amount })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            eq(transactionCategories.name, "Share Capital"),
            eq(transactions.type, "credit"),
            lte(transactions.transactionDate, asOfDate)
          )
        )

      const shareCapital = shareCapitalRows.reduce(
        (sum, row) => sum.plus(new BigNumber(row.amount)),
        new BigNumber(0)
      )

      const allTransactions = await db
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .where(lte(transactions.transactionDate, asOfDate))

      let totalCredits = new BigNumber(0)
      let totalDebits = new BigNumber(0)
      for (const row of allTransactions) {
        if (row.type === "credit") {
          totalCredits = totalCredits.plus(new BigNumber(row.amount))
        } else {
          totalDebits = totalDebits.plus(new BigNumber(row.amount))
        }
      }
      const retainedEarnings = totalCredits.minus(totalDebits).minus(shareCapital)
      const totalEquity = shareCapital.plus(retainedEarnings)

      const liabilitiesPlusEquity = totalCreditorBalances.plus(totalEquity)
      if (!totalAssets.isEqualTo(liabilitiesPlusEquity)) {
        console.warn(
          `Balance sheet imbalance: Assets=${formatAmount(totalAssets)}, ` +
            `Liabilities+Equity=${formatAmount(liabilitiesPlusEquity)} ` +
            `(diff=${formatAmount(totalAssets.minus(liabilitiesPlusEquity))})`
        )
      }

      return {
        asOf,
        assets: {
          cashBalance: formatAmount(cashBalance),
          bankBalance: formatAmount(bankBalance),
          strongRoomBalance: formatAmount(strongRoomBalance),
          totalLoansOutstanding: formatAmount(totalLoansOutstanding),
          totalAssets: formatAmount(totalAssets),
        },
        liabilities: {
          totalCreditorBalances: formatAmount(totalCreditorBalances),
        },
        equity: {
          shareCapital: formatAmount(shareCapital),
          retainedEarnings: formatAmount(retainedEarnings),
          totalEquity: formatAmount(totalEquity),
        },
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
  )

export const getPortfolioData = (): Effect.Effect<
  PortfolioEntry[],
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const now = new Date()
      const results: PortfolioEntry[] = []

      for (const loan of activeLoans) {
        const [customer] = await db
          .select({ fullName: customers.fullName })
          .from(customers)
          .where(eq(customers.id, loan.customerId))

        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(desc(payments.paymentDate), desc(payments.createdAt))

        const lastPayment = loanPayments[0]
        const outstandingBalance = lastPayment
          ? new BigNumber(lastPayment.principalBalanceAfter)
          : new BigNumber(loan.principalAmount)

        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )

        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        // Use actual days for accrual — min period only applies to payment allocation
        const interestAccrued = calculateInterest(
          loan.principalAmount,
          effectiveRate,
          totalDaysElapsed,
          0
        )

        const totalInterestPaid = loanPayments.reduce(
          (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
          new BigNumber(0)
        )
        const dailyRate = calculateDailyRate(effectiveRate)
        const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRate)
        const daysOverdue = calculateDaysOverdue(
          interestAccrued,
          totalInterestPaid,
          dailyInterestAmount
        )

        const riskFlag = daysOverdue.isGreaterThanOrEqualTo(30)

        results.push({
          loanId: loan.id,
          customerName: customer?.fullName ?? "Unknown",
          principalAmount: loan.principalAmount,
          outstandingBalance: formatAmount(outstandingBalance),
          interestAccrued: formatAmount(interestAccrued),
          daysOverdue: daysOverdue.toFixed(0),
          status: loan.status,
          riskFlag,
        })
      }

      results.sort(
        (a, b) => parseInt(b.daysOverdue) - parseInt(a.daysOverdue)
      )

      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const generateMonthlySnapshot = (
  period: string,
  generatedBy: string
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [year, month] = period.split("-").map(Number)
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999)

      const existingSnapshots = await db
        .select({ type: financialSnapshots.type })
        .from(financialSnapshots)
        .where(
          and(
            sql`${financialSnapshots.periodStart}::date = ${periodStart.toISOString().split("T")[0]}`,
            sql`${financialSnapshots.type} IN ('pnl', 'balance_sheet')`
          )
        )

      const existingTypes = new Set(existingSnapshots.map((s) => s.type))

      const toInsert: ("pnl" | "balance_sheet")[] = []
      if (!existingTypes.has("pnl")) toInsert.push("pnl")
      if (!existingTypes.has("balance_sheet")) toInsert.push("balance_sheet")

      if (toInsert.length === 0) return

      const [pnlData, balanceSheetData] = await Promise.all([
        toInsert.includes("pnl")
          ? Effect.runPromise(getPnlData(period))
          : Promise.resolve(null),
        toInsert.includes("balance_sheet")
          ? Effect.runPromise(getBalanceSheetData(period))
          : Promise.resolve(null),
      ])

      const insertRows = []
      if (pnlData && toInsert.includes("pnl")) {
        insertRows.push({
          type: "pnl" as const,
          periodStart,
          periodEnd,
          data: JSON.stringify(pnlData),
          generatedBy,
        })
      }
      if (balanceSheetData && toInsert.includes("balance_sheet")) {
        insertRows.push({
          type: "balance_sheet" as const,
          periodStart,
          periodEnd,
          data: JSON.stringify(balanceSheetData),
          generatedBy,
        })
      }

      if (insertRows.length > 0) {
        await db.insert(financialSnapshots).values(insertRows)
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
