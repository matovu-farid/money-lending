import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
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
  inArray,
} from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import {
  calculateInterest,
  calculateDaysOverdue,
  calculateDailyRate,
  formatAmount,
} from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import type { PnlData, BalanceSheetData, PortfolioEntry, RetainedEarningsData } from "@/types"

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
            lte(transactions.transactionDate, periodEnd),
            inArray(transactionCategories.type, ["revenue", "expense"])
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

export const getRetainedEarningsData = (
  period: string
): Effect.Effect<RetainedEarningsData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [year, month] = period.split("-").map(Number)
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999)

      // Beginning balance: all income/expense transactions BEFORE this period
      const priorRows = await db
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            lte(transactions.transactionDate, new Date(periodStart.getTime() - 1)),
            inArray(transactionCategories.type, ["revenue", "expense"])
          )
        )

      let priorCredits = new BigNumber(0)
      let priorDebits = new BigNumber(0)
      for (const row of priorRows) {
        if (row.type === "credit") {
          priorCredits = priorCredits.plus(new BigNumber(row.amount))
        } else {
          priorDebits = priorDebits.plus(new BigNumber(row.amount))
        }
      }
      const beginningBalance = priorCredits.minus(priorDebits)

      // Net income for this period
      const periodRows = await db
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            gte(transactions.transactionDate, periodStart),
            lte(transactions.transactionDate, periodEnd),
            inArray(transactionCategories.type, ["revenue", "expense"])
          )
        )

      let periodCredits = new BigNumber(0)
      let periodDebits = new BigNumber(0)
      for (const row of periodRows) {
        if (row.type === "credit") {
          periodCredits = periodCredits.plus(new BigNumber(row.amount))
        } else {
          periodDebits = periodDebits.plus(new BigNumber(row.amount))
        }
      }
      const netIncome = periodCredits.minus(periodDebits)
      const endingBalance = beginningBalance.plus(netIncome)

      return {
        period,
        beginningBalance: formatAmount(beginningBalance),
        netIncome: formatAmount(netIncome),
        endingBalance: formatAmount(endingBalance),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getBalanceSheetData = (
  asOf: string
): Effect.Effect<BalanceSheetData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      let asOfDate: Date
      if (/^\d{4}-\d{2}$/.test(asOf)) {
        const [year, month] = asOf.split("-").map(Number)
        asOfDate = new Date(year, month, 0, 23, 59, 59, 999)
      } else {
        asOfDate = new Date(asOf + "T23:59:59.999Z")
      }

      // Single ledger query — group by category name, type, transaction type, and location
      const rows = await db
        .select({
          categoryName: transactionCategories.name,
          categoryType: transactionCategories.type,
          txType: transactions.type,
          depositLocation: transactions.depositLocation,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(lte(transactions.transactionDate, asOfDate))
        .groupBy(
          transactionCategories.name,
          transactionCategories.type,
          transactions.type,
          transactions.depositLocation
        )

      // Build balances from ledger using normal balance rules
      const locationBalances: Record<string, BigNumber> = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }
      let totalLoansOutstanding = new BigNumber(0)
      let seizedCollateralValue = new BigNumber(0)
      let totalCreditorBalances = new BigNumber(0)
      let shareCapital = new BigNumber(0)
      let totalRevenue = new BigNumber(0)
      let totalExpenses = new BigNumber(0)

      for (const row of rows) {
        const amount = new BigNumber(row.total)
        const isDebit = row.txType === "debit"

        if (row.categoryName === "Cash" && row.depositLocation) {
          const loc = row.depositLocation
          if (locationBalances[loc] !== undefined) {
            // Asset: DR adds, CR subtracts
            locationBalances[loc] = isDebit
              ? locationBalances[loc].plus(amount)
              : locationBalances[loc].minus(amount)
          }
        } else if (row.categoryName === "Loans Receivable") {
          totalLoansOutstanding = isDebit
            ? totalLoansOutstanding.plus(amount)
            : totalLoansOutstanding.minus(amount)
        } else if (row.categoryName === "Seized Collateral") {
          seizedCollateralValue = isDebit
            ? seizedCollateralValue.plus(amount)
            : seizedCollateralValue.minus(amount)
        } else if (row.categoryName === "Creditor Investment") {
          // Liability: CR adds, DR subtracts
          totalCreditorBalances = isDebit
            ? totalCreditorBalances.minus(amount)
            : totalCreditorBalances.plus(amount)
        } else if (row.categoryName === "Share Capital") {
          // Equity: CR adds, DR subtracts
          shareCapital = isDebit
            ? shareCapital.minus(amount)
            : shareCapital.plus(amount)
        } else if (row.categoryType === "revenue") {
          // Revenue: CR adds, DR subtracts
          totalRevenue = isDebit
            ? totalRevenue.minus(amount)
            : totalRevenue.plus(amount)
        } else if (row.categoryType === "expense") {
          // Expense: DR adds, CR subtracts
          totalExpenses = isDebit
            ? totalExpenses.plus(amount)
            : totalExpenses.minus(amount)
        }
      }

      const cashBalance = locationBalances.cash
      const bankBalance = locationBalances.bank
      const strongRoomBalance = locationBalances.strong_room
      const totalAssets = totalLoansOutstanding
        .plus(cashBalance)
        .plus(bankBalance)
        .plus(strongRoomBalance)
        .plus(seizedCollateralValue)

      const retainedEarnings = totalRevenue.minus(totalExpenses)
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
          seizedCollateralValue: formatAmount(seizedCollateralValue),
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
