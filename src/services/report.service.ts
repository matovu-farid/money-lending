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
  asc,
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

/**
 * Generates a Profit & Loss statement for a given month.
 * P&L is derived from the transaction log (single source of truth).
 *
 * period: "YYYY-MM" format
 *
 * RPTS-02: P&L statement sums income categories minus expense categories.
 */
export const getPnlData = (
  period: string
): Effect.Effect<PnlData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Parse period to get start/end dates for the month
      const [year, month] = period.split("-").map(Number)
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999)

      // Query transactions joined with categories for the period
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

      // Group by category and type, sum amounts using BigNumber
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

      // Build income and expense arrays
      const income = Array.from(incomeMap.entries()).map(([category, amount]) => ({
        category,
        amount: formatAmount(amount),
      }))
      const expenses = Array.from(expenseMap.entries()).map(([category, amount]) => ({
        category,
        amount: formatAmount(amount),
      }))

      // Calculate totals using BigNumber
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

/**
 * Generates a Balance Sheet as of a given date.
 * Combines loan data (assets), creditor data (liabilities), and cumulative P&L (equity).
 *
 * asOf: "YYYY-MM-DD" or "YYYY-MM" (last day of month)
 *
 * RPTS-03: Balance Sheet shows Assets (loans outstanding), Liabilities (creditor balances),
 *           Equity (share capital + retained earnings). Identity: A = L + E.
 */
export const getBalanceSheetData = (
  asOf: string
): Effect.Effect<BalanceSheetData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Parse asOf — support "YYYY-MM" (last day of month) or "YYYY-MM-DD"
      let asOfDate: Date
      if (/^\d{4}-\d{2}$/.test(asOf)) {
        const [year, month] = asOf.split("-").map(Number)
        asOfDate = new Date(year, month, 0, 23, 59, 59, 999) // last day of month
      } else {
        asOfDate = new Date(asOf + "T23:59:59.999Z")
      }

      // -----------------------------------------------
      // ASSETS: Total loans outstanding (active loans)
      // -----------------------------------------------
      const activeLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.status, "active"))

      let totalLoansOutstanding = new BigNumber(0)

      for (const loan of activeLoans) {
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(desc(payments.paymentDate))

        const lastPayment = loanPayments[0]
        const outstanding = lastPayment
          ? new BigNumber(lastPayment.principalBalanceAfter)
          : new BigNumber(loan.principalAmount)
        totalLoansOutstanding = totalLoansOutstanding.plus(outstanding)
      }

      // -----------------------------------------------
      // LIABILITIES: Total creditor balances
      // Use getSystemCapital().totalOutstanding
      // -----------------------------------------------
      const systemCapital = await Effect.runPromise(getSystemCapital())
      const totalCreditorBalances = new BigNumber(systemCapital.totalOutstanding)

      // -----------------------------------------------
      // EQUITY: Share Capital + Retained Earnings
      // -----------------------------------------------
      // Share Capital = SUM of all "Share Capital" credit transactions up to asOf
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

      // Retained Earnings = total credits - total debits up to asOf date (cumulative P&L)
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
      const retainedEarnings = totalCredits.minus(totalDebits)
      const totalEquity = shareCapital.plus(retainedEarnings)

      // -----------------------------------------------
      // Balance sheet identity check: A = L + E
      // -----------------------------------------------
      const liabilitiesPlusEquity = totalCreditorBalances.plus(totalEquity)
      if (!totalLoansOutstanding.isEqualTo(liabilitiesPlusEquity)) {
        console.warn(
          `Balance sheet imbalance: Assets=${formatAmount(totalLoansOutstanding)}, ` +
            `Liabilities+Equity=${formatAmount(liabilitiesPlusEquity)} ` +
            `(diff=${formatAmount(totalLoansOutstanding.minus(liabilitiesPlusEquity))})`
        )
      }

      return {
        asOf,
        assets: {
          totalLoansOutstanding: formatAmount(totalLoansOutstanding),
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

/**
 * Generates the loan portfolio report.
 * For each active loan: outstanding balance, interest accrued, days overdue, risk flag.
 * Ordered by days overdue descending (most at-risk first).
 *
 * RPTS-04: Loan portfolio report with risk flags.
 */
export const getPortfolioData = (): Effect.Effect<
  PortfolioEntry[],
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.status, "active"))

      const now = new Date()
      const results: PortfolioEntry[] = []

      for (const loan of activeLoans) {
        // Fetch customer name
        const [customer] = await db
          .select({ fullName: customers.fullName })
          .from(customers)
          .where(eq(customers.id, loan.customerId))

        // Fetch non-deleted payments for this loan
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(desc(payments.paymentDate))

        // Outstanding balance: last payment's principalBalanceAfter or original principal
        const lastPayment = loanPayments[0]
        const outstandingBalance = lastPayment
          ? new BigNumber(lastPayment.principalBalanceAfter)
          : new BigNumber(loan.principalAmount)

        // Days elapsed since loan start (for interest accrual)
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )

        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays

        // Interest accrued using engine.ts
        const interestAccrued = calculateInterest(
          outstandingBalance.toFixed(2),
          effectiveRate,
          totalDaysElapsed,
          effectiveMinDays
        )

        // Days overdue using engine.ts
        const totalInterestPaid = loanPayments.reduce(
          (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
          new BigNumber(0)
        )
        const dailyRate = calculateDailyRate(effectiveRate)
        const daysOverdue = calculateDaysOverdue(
          interestAccrued.toFixed(2),
          totalInterestPaid.toFixed(2),
          dailyRate.toFixed(10)
        )

        // Risk flag: daysOverdue >= 30 (matches watchlist threshold)
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

      // Sort by daysOverdue descending (most at-risk first)
      results.sort(
        (a, b) => parseInt(b.daysOverdue) - parseInt(a.daysOverdue)
      )

      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Generates and stores monthly P&L and Balance Sheet snapshots.
 * Idempotent: if a snapshot for the same period+type already exists, skip insert.
 * Called by the month-end cron endpoint (Plan 08).
 *
 * period: "YYYY-MM" format
 * generatedBy: userId of the actor triggering the snapshot
 */
export const generateMonthlySnapshot = (
  period: string,
  generatedBy: string
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [year, month] = period.split("-").map(Number)
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999)

      // Idempotency: check for existing snapshots for this period
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

      if (toInsert.length === 0) {
        // Both snapshots already exist — skip
        return
      }

      // Generate data for missing snapshot types
      const [pnlData, balanceSheetData] = await Promise.all([
        toInsert.includes("pnl")
          ? Effect.runPromise(getPnlData(period))
          : Promise.resolve(null),
        toInsert.includes("balance_sheet")
          ? Effect.runPromise(getBalanceSheetData(period))
          : Promise.resolve(null),
      ])

      // Insert missing snapshots
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
