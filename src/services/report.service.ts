import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { financialSnapshots } from "@/lib/db/schema/financial-snapshots"
import {
  eq,
  and,
  gte,
  lte,
  isNull,
  sql,
  inArray,
  count,
} from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { formatAmount } from "@/lib/interest/engine"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import BigNumber from "bignumber.js"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "./ledger-queries.service"
import { periodBoundsUTC, asOfDateUTC } from "@/lib/date-utils"
import { toLoanType, type PnlData, type BalanceSheetData, type PortfolioEntry, type RetainedEarningsData } from "@/types"

export const getPnlData = (
  period: string
): Effect.Effect<PnlData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const { periodStart, periodEnd } = periodBoundsUTC(period)

      const incomeMap = new Map<string, BigNumber>()
      const expenseMap = new Map<string, BigNumber>()

      // Need category type to correctly net reversals (DR to revenue = income reversal, not expense).
      // Group label = user-typed transactions.category if set (manual income/expense),
      // otherwise the chart-of-accounts category name.
      const catTypeRows = await db
        .select({
          type: transactions.type,
          amount: transactions.amount,
          categoryName: sql<string>`coalesce(${transactions.category}, ${transactionCategories.name})`,
          categoryType: transactionCategories.type,
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

      for (const row of catTypeRows) {
        const amount = new BigNumber(row.amount)
        if (row.categoryType === "revenue") {
          // Revenue account: CR adds income, DR subtracts income (reversal)
          const existing = incomeMap.get(row.categoryName) ?? new BigNumber(0)
          incomeMap.set(row.categoryName, row.type === "credit"
            ? existing.plus(amount)
            : existing.minus(amount))
        } else {
          // Expense account: DR adds expense, CR subtracts expense (reversal)
          const existing = expenseMap.get(row.categoryName) ?? new BigNumber(0)
          expenseMap.set(row.categoryName, row.type === "debit"
            ? existing.plus(amount)
            : existing.minus(amount))
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
      const { periodStart, periodEnd } = periodBoundsUTC(period)

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

/**
 * Get current cash balances per deposit location from the ledger.
 * Returns { cash, bank, strong_room } as formatted decimal strings.
 */
/**
 * Cached lookup of the system "Cash" category id.
 * "Cash" is a system-seeded category whose id never changes after install,
 * so caching it at module scope eliminates a JOIN from every balance query.
 */
let cashCategoryIdCache: string | null = null
async function getCashCategoryId(): Promise<string | null> {
  if (cashCategoryIdCache) return cashCategoryIdCache
  const [row] = await db
    .select({ id: transactionCategories.id })
    .from(transactionCategories)
    .where(eq(transactionCategories.name, "Cash"))
    .limit(1)
  cashCategoryIdCache = row?.id ?? null
  return cashCategoryIdCache
}

export const getLocationBalances = (): Effect.Effect<
  {
    cash: string
    bank: string
    strong_room: string
    bankAccounts: Record<string, string>
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const cashId = await getCashCategoryId()
      const empty = {
        cash: formatAmount(new BigNumber(0)),
        bank: formatAmount(new BigNumber(0)),
        strong_room: formatAmount(new BigNumber(0)),
        bankAccounts: {},
      }
      if (!cashId) return empty

      const rows = await db
        .select({
          txType: transactions.type,
          depositLocation: transactions.depositLocation,
          subLocationId: transactions.subLocationId,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .where(eq(transactions.categoryId, cashId))
        .groupBy(transactions.type, transactions.depositLocation, transactions.subLocationId)

      const balances = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }

      const bankAccountBalances: Record<string, BigNumber> = {}

      for (const row of rows) {
        const amount = new BigNumber(row.total)
        const loc = (row.depositLocation ?? "cash") as keyof typeof balances
        if (balances[loc] !== undefined) {
          balances[loc] = row.txType === "debit"
            ? balances[loc].plus(amount)
            : balances[loc].minus(amount)
        }
        // Track per-bank-account balance
        if (loc === "bank" && row.subLocationId) {
          const existing = bankAccountBalances[row.subLocationId] ?? new BigNumber(0)
          bankAccountBalances[row.subLocationId] = row.txType === "debit"
            ? existing.plus(amount)
            : existing.minus(amount)
        }
      }

      return {
        cash: formatAmount(balances.cash),
        bank: formatAmount(balances.bank),
        strong_room: formatAmount(balances.strong_room),
        bankAccounts: Object.fromEntries(
          Object.entries(bankAccountBalances).map(([id, bal]) => [id, formatAmount(bal)])
        ),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getBalanceSheetData = (
  asOf: string
): Effect.Effect<BalanceSheetData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const asOfDate = asOfDateUTC(asOf)

      // Single ledger query — group by category name, type, transaction type, and location
      const rows = await db
        .select({
          categoryName: transactionCategories.name,
          categoryType: transactionCategories.type,
          txType: transactions.type,
          depositLocation: transactions.depositLocation,
          subLocationId: transactions.subLocationId,
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
          transactions.depositLocation,
          transactions.subLocationId
        )

      // Build balances from ledger using normal balance rules
      const locationBalances: Record<string, BigNumber> = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }
      const bankAccountBalances: Record<string, BigNumber> = {}
      let totalLoansOutstanding = new BigNumber(0)
      let seizedCollateralValue = new BigNumber(0)
      let totalCreditorBalances = new BigNumber(0)
      let shareCapital = new BigNumber(0)
      let totalRevenue = new BigNumber(0)
      let totalExpenses = new BigNumber(0)

      for (const row of rows) {
        const amount = new BigNumber(row.total)
        const isDebit = row.txType === "debit"

        if (row.categoryName === "Cash") {
          const loc = row.depositLocation ?? "cash"
          if (locationBalances[loc] !== undefined) {
            // Asset: DR adds, CR subtracts
            locationBalances[loc] = isDebit
              ? locationBalances[loc].plus(amount)
              : locationBalances[loc].minus(amount)
          }
          if (loc === "bank" && row.subLocationId) {
            const existing = bankAccountBalances[row.subLocationId] ?? new BigNumber(0)
            bankAccountBalances[row.subLocationId] = isDebit
              ? existing.plus(amount)
              : existing.minus(amount)
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

      // Interest Receivable from ledger (DR - CR for "Interest Receivable" category)
      const [receivableCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Receivable"), eq(transactionCategories.type, "revenue")))

      let interestReceivable = new BigNumber(0)
      if (receivableCat) {
        const receivableRows = await db
          .select({ type: transactions.type, amount: transactions.amount })
          .from(transactions)
          .where(and(eq(transactions.categoryId, receivableCat.id), lte(transactions.transactionDate, asOfDate)))

        for (const row of receivableRows) {
          if (row.type === "debit") interestReceivable = interestReceivable.plus(new BigNumber(row.amount))
          else interestReceivable = interestReceivable.minus(new BigNumber(row.amount))
        }
        if (interestReceivable.isLessThan(0)) interestReceivable = new BigNumber(0)
      }

      // Interest Payable from ledger (CR - DR for "Interest Payable" category)
      const [payableCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Payable"), eq(transactionCategories.type, "expense")))

      let interestPayable = new BigNumber(0)
      if (payableCat) {
        const payableRows = await db
          .select({ type: transactions.type, amount: transactions.amount })
          .from(transactions)
          .where(and(eq(transactions.categoryId, payableCat.id), lte(transactions.transactionDate, asOfDate)))

        for (const row of payableRows) {
          if (row.type === "credit") interestPayable = interestPayable.plus(new BigNumber(row.amount))
          else interestPayable = interestPayable.minus(new BigNumber(row.amount))
        }
        if (interestPayable.isLessThan(0)) interestPayable = new BigNumber(0)
      }

      const totalAssets = totalLoansOutstanding
        .plus(interestReceivable)
        .plus(cashBalance)
        .plus(bankBalance)
        .plus(strongRoomBalance)
        .plus(seizedCollateralValue)

      const retainedEarnings = totalRevenue.minus(totalExpenses)
      const totalEquity = shareCapital.plus(retainedEarnings)

      const totalLiabilities = totalCreditorBalances.plus(interestPayable)
      const liabilitiesPlusEquity = totalLiabilities.plus(totalEquity)
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
          interestReceivable: formatAmount(interestReceivable),
          seizedCollateralValue: formatAmount(seizedCollateralValue),
          totalAssets: formatAmount(totalAssets),
          bankAccountBalances: Object.fromEntries(
            Object.entries(bankAccountBalances).map(([id, bal]) => [id, formatAmount(bal)])
          ),
        },
        liabilities: {
          totalCreditorBalances: formatAmount(totalCreditorBalances),
          interestPayable: formatAmount(interestPayable),
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
        .select({
          loan: loans,
          customerName: customers.fullName,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const results: PortfolioEntry[] = []

      // Derive per-loan outstanding principal from ledger in one batch query
      const loanIds = activeLoans.map((l) => l.loan.id)
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      // Batch-fetch interest earned from ledger
      const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

      // Batch-fetch payment counts per loan
      const paymentCountRows = loanIds.length > 0
        ? await db
            .select({ loanId: payments.loanId, count: count() })
            .from(payments)
            .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
            .groupBy(payments.loanId)
        : []
      const paymentCountMap = new Map(paymentCountRows.map((r) => [r.loanId, Number(r.count)]))

      for (const { loan, customerName } of activeLoans) {

        // Use ledger-derived balance
        const ledgerBalance = ledgerBalances.get(loan.id)
        if (!ledgerBalance) {
          console.warn(`[getPortfolioData] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
        }
        const outstandingBalance = ledgerBalance
          ?? new BigNumber(loan.principalAmount)

        const baseRate = getBaseRate(loan)
        const loanType = toLoanType(loan.loanType)

        // Use computeLoanOverdueInfo for consistent overdue calculation
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType,
          termMonths: loan.termMonths,
          totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
          paymentCount: paymentCountMap.get(loan.id) ?? 0,
          outstandingBalance: formatAmount(outstandingBalance),
          penaltyWaived: loan.penaltyWaived,
          loan,
        })

        results.push({
          loanId: loan.id,
          customerName: customerName ?? "Unknown",
          principalAmount: loan.principalAmount,
          outstandingBalance: formatAmount(outstandingBalance),
          interestAccrued: info.unpaidInterest,
          daysOverdue: String(info.daysOverdue),
          status: loan.status,
          riskFlag: info.daysOverdue >= 30,
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
      const { periodStart, periodEnd } = periodBoundsUTC(period)

      const [pnlData, balanceSheetData] = await Promise.all([
        Effect.runPromise(getPnlData(period)),
        Effect.runPromise(getBalanceSheetData(period)),
      ])

      const insertRows = []
      if (pnlData) {
        insertRows.push({
          type: "pnl" as const,
          periodStart,
          periodEnd,
          data: JSON.stringify(pnlData),
          generatedBy,
        })
      }
      if (balanceSheetData) {
        insertRows.push({
          type: "balance_sheet" as const,
          periodStart,
          periodEnd,
          data: JSON.stringify(balanceSheetData),
          generatedBy,
        })
      }

      if (insertRows.length > 0) {
        await db.insert(financialSnapshots).values(insertRows).onConflictDoNothing()
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
