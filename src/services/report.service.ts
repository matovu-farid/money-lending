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
import { toLoanType, type PnlData, type BalanceSheetData, type PortfolioEntry, type RetainedEarningsData, type CashflowData, type CashflowMonth } from "@/types"
import { getLastPaymentDate } from "./payment.service"
import { computeSingleLoanBalanceData } from "@/lib/interest/loanBalanceData"

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



      for (const { loan, customerName } of activeLoans) {

        // Use ledger-derived balance
        const ledgerBalance = ledgerBalances.get(loan.id)
        if (!ledgerBalance) {
          console.warn(`[getPortfolioData] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
        }
        const outstandingBalance = ledgerBalance
          ?? new BigNumber(loan.principalAmount)

  
        const info = await computeSingleLoanBalanceData(loan.id, new Date())

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

/**
 * Monthly cashflow over the 12 months ending at `period`.
 *
 * A single query against the unified `transactions` ledger classifies each
 * row as inflow / outflow / ignored by referenceType + category type, then
 * aggregates per (month, direction, sourceLabel).
 *
 * Cashflow excludes purely accounting moves: fund transfers (between our own
 * locations), capital injections (equity injection, not cash earned), interest
 * accruals, and rate-change adjustments. Loan disbursements and creditor
 * investments/repayments are real cash motion and are included.
 */
const MONTHS_IN_CASHFLOW = 12

function shiftMonth(period: string, deltaMonths: number): string {
  const [y, m] = period.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1 + deltaMonths, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export const getCashflowData = (
  period: string
): Effect.Effect<CashflowData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const { periodEnd: rangeEnd } = periodBoundsUTC(period)
      const earliestMonth = shiftMonth(period, -(MONTHS_IN_CASHFLOW - 1))
      const { periodStart: rangeStart } = periodBoundsUTC(earliestMonth)

      const rows = await db
        .select({
          monthStart: sql<string>`to_char(date_trunc('month', ${transactions.transactionDate} AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          referenceType: transactions.referenceType,
          txType: transactions.type,
          categoryType: transactionCategories.type,
          categoryName: sql<string>`coalesce(${transactions.category}, ${transactionCategories.name})`,
          amount: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          and(
            gte(transactions.transactionDate, rangeStart),
            lte(transactions.transactionDate, rangeEnd),
            inArray(transactionCategories.type, ["revenue", "expense", "asset", "liability"])
          )
        )
        .groupBy(
          sql`date_trunc('month', ${transactions.transactionDate} AT TIME ZONE 'UTC')`,
          transactions.referenceType,
          transactions.type,
          transactionCategories.type,
          sql`coalesce(${transactions.category}, ${transactionCategories.name})`
        )

      type Direction = "in" | "out" | "skip"
      function classify(row: typeof rows[number]): { direction: Direction; label: string } {
        const ref = row.referenceType
        // Real-cash sources keyed off referenceType when set.
        if (ref === "loan_disbursement") return { direction: "out", label: "Loan disbursements" }
        if (ref === "payment" || ref === "payment_reversal") {
          // Only the Cash leg of a payment is cash motion. The Interest Earned
          // and Loans Receivable legs are accounting recognition.
          if (row.categoryName === "Cash") {
            return { direction: ref === "payment_reversal" ? "out" : "in", label: "Loan payments received" }
          }
          return { direction: "skip", label: "" }
        }
        if (ref === "creditor_investment") {
          if (row.categoryName === "Cash") return { direction: "in", label: "Creditor investments received" }
          return { direction: "skip", label: "" }
        }
        if (ref === "creditor_repayment") {
          if (row.categoryName === "Cash") return { direction: "out", label: "Creditor repayments" }
          return { direction: "skip", label: "" }
        }
        if (ref === "fund_transfer" || ref === "capital_injection") return { direction: "skip", label: "" }
        if (ref === "interest_accrual" || ref === "penalty_interest_accrual") return { direction: "skip", label: "" }
        if (ref === "collateral_settlement") return { direction: "skip", label: "" }

        // Manual entries (no referenceType): user-typed expense/income lines.
        // Use the leg with the user-typed category label.
        if (row.categoryType === "revenue" && row.txType === "credit") {
          return { direction: "in", label: `Income: ${row.categoryName}` }
        }
        if (row.categoryType === "expense" && row.txType === "debit") {
          return { direction: "out", label: `Expense: ${row.categoryName}` }
        }
        return { direction: "skip", label: "" }
      }

      // Initialize months ascending.
      const months: CashflowMonth[] = []
      const monthIndex = new Map<string, number>()
      for (let i = -(MONTHS_IN_CASHFLOW - 1); i <= 0; i++) {
        const m = shiftMonth(period, i)
        monthIndex.set(m, months.length)
        months.push({ month: m, inflows: "0", outflows: "0", net: "0" })
      }

      const inflowsByType = new Map<string, BigNumber>()
      const outflowsByType = new Map<string, BigNumber>()
      const monthlyInflows = months.map(() => new BigNumber(0))
      const monthlyOutflows = months.map(() => new BigNumber(0))

      for (const row of rows) {
        const { direction, label } = classify(row)
        if (direction === "skip") continue
        const idx = monthIndex.get(row.monthStart)
        if (idx === undefined) continue
        const amt = new BigNumber(row.amount)
        if (direction === "in") {
          monthlyInflows[idx] = monthlyInflows[idx].plus(amt)
          if (row.monthStart === period) {
            inflowsByType.set(label, (inflowsByType.get(label) ?? new BigNumber(0)).plus(amt))
          }
        } else {
          monthlyOutflows[idx] = monthlyOutflows[idx].plus(amt)
          if (row.monthStart === period) {
            outflowsByType.set(label, (outflowsByType.get(label) ?? new BigNumber(0)).plus(amt))
          }
        }
      }

      let totalIn = new BigNumber(0)
      let totalOut = new BigNumber(0)
      for (let i = 0; i < months.length; i++) {
        const inAmt = monthlyInflows[i]
        const outAmt = monthlyOutflows[i]
        months[i].inflows = formatAmount(inAmt)
        months[i].outflows = formatAmount(outAmt)
        months[i].net = formatAmount(inAmt.minus(outAmt))
        totalIn = totalIn.plus(inAmt)
        totalOut = totalOut.plus(outAmt)
      }

      return {
        period,
        months,
        inflowsByType: Array.from(inflowsByType.entries()).map(([label, amt]) => ({ label, amount: formatAmount(amt) })),
        outflowsByType: Array.from(outflowsByType.entries()).map(([label, amt]) => ({ label, amount: formatAmount(amt) })),
        totalInflows: formatAmount(totalIn),
        totalOutflows: formatAmount(totalOut),
        totalNet: formatAmount(totalIn.minus(totalOut)),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
