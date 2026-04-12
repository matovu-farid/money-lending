import { Effect } from "effect"
import { randomUUID } from "crypto"
import { db } from "@/lib/db"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"
import {
  eq,
  and,
  gte,
  lte,
  desc,
  asc,
  count,
  inArray,
  isNull,
} from "drizzle-orm"
import BigNumber from "bignumber.js"
import {
  DatabaseError,
  TransactionNotFound,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { calculateInterest, formatAmount } from "@/lib/interest/engine"
import { getEffectiveRate, getBaseRate } from "@/lib/interest/effective-rate"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import {
  toLoanType,
  type CreateTransactionInput,
  type TransactionLogFilters,
} from "@/types"
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
  getCreditorBalancesFromLedger,
} from "./ledger-queries.service"

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type CategoryType = "asset" | "liability" | "equity" | "revenue" | "expense"

async function getOrCreateCategory(
  tx: DrizzleTransaction,
  name: string,
  type: CategoryType
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )
  if (existing) return existing.id

  const [created] = await tx
    .insert(transactionCategories)
    .values({ name, type, isDefault: true })
    .onConflictDoNothing()
    .returning()

  if (created) return created.id

  // Re-fetch if conflict occurred (concurrent insert)
  const [refetched] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )
  return refetched.id
}

export async function postJournalEntry(
  tx: DrizzleTransaction,
  params: {
    debitCategory: { name: string; type: CategoryType }
    creditCategory: { name: string; type: CategoryType }
    amount: string
    referenceType: string
    referenceId: string
    description: string
    transactionDate: Date
    recordedBy: string
    debitDepositLocation?: "cash" | "bank" | "strong_room"
    creditDepositLocation?: "cash" | "bank" | "strong_room"
    loanId?: string
  }
): Promise<string> {
  const journalGroupId = randomUUID()

  const debitCategoryId = await getOrCreateCategory(tx, params.debitCategory.name, params.debitCategory.type)
  const creditCategoryId = await getOrCreateCategory(tx, params.creditCategory.name, params.creditCategory.type)

  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: debitCategoryId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    loanId: params.loanId ?? null,
    description: params.description,
    transactionDate: params.transactionDate,
    recordedBy: params.recordedBy,
    depositLocation: params.debitDepositLocation ?? null,
    journalGroupId,
  })

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: creditCategoryId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    loanId: params.loanId ?? null,
    description: params.description,
    transactionDate: params.transactionDate,
    recordedBy: params.recordedBy,
    depositLocation: params.creditDepositLocation ?? null,
    journalGroupId,
  })

  return journalGroupId
}

export const recordExpense = (
  input: CreateTransactionInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const groupId = randomUUID()
        const [debitTx] = await tx
          .insert(transactions)
          .values({
            type: "debit", amount: input.amount, categoryId: input.categoryId,
            description: input.notes ?? null, transactionDate: new Date(input.transactionDate),
            recordedBy: actorId, journalGroupId: groupId,
          })
          .returning()

        const cashCategoryId = await getOrCreateCategory(tx, "Cash", "asset")
        await tx.insert(transactions).values({
          type: "credit", amount: input.amount, categoryId: cashCategoryId,
          description: input.notes ?? null, transactionDate: new Date(input.transactionDate),
          recordedBy: actorId, depositLocation: input.location, journalGroupId: groupId,
        })

        await writeAuditLog(tx, { actorId, action: "transaction.create", entityType: "transaction", entityId: debitTx.id, beforeValue: null, afterValue: debitTx })
        return debitTx
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const recordIncome = (
  input: CreateTransactionInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const groupId = randomUUID()
        const cashCategoryId = await getOrCreateCategory(tx, "Cash", "asset")

        await tx.insert(transactions).values({
          type: "debit", amount: input.amount, categoryId: cashCategoryId,
          description: input.notes ?? null, transactionDate: new Date(input.transactionDate),
          recordedBy: actorId, depositLocation: input.location, journalGroupId: groupId,
        })

        const [creditTx] = await tx
          .insert(transactions)
          .values({
            type: "credit", amount: input.amount, categoryId: input.categoryId,
            description: input.notes ?? null, transactionDate: new Date(input.transactionDate),
            recordedBy: actorId, journalGroupId: groupId,
          })
          .returning()

        await writeAuditLog(tx, { actorId, action: "transaction.create", entityType: "transaction", entityId: creditTx.id, beforeValue: null, afterValue: creditTx })
        return creditTx
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listTransactions = (
  filters: TransactionLogFilters,
  page: number,
  pageSize: number
): Effect.Effect<
  {
    data: {
      id: string
      type: "credit" | "debit"
      amount: string
      categoryId: string
      categoryName: string
      referenceType: string | null
      referenceId: string | null
      description: string | null
      transactionDate: Date
      recordedBy: string
      createdAt: Date
    }[]
    total: number
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const conditions = []

      if (filters.type) {
        conditions.push(eq(transactions.type, filters.type))
      }
      if (filters.categoryId) {
        conditions.push(eq(transactions.categoryId, filters.categoryId))
      }
      if (filters.dateFrom) {
        conditions.push(
          gte(transactions.transactionDate, new Date(filters.dateFrom))
        )
      }
      if (filters.dateTo) {
        conditions.push(
          lte(transactions.transactionDate, new Date(filters.dateTo))
        )
      }
      if (filters.manualOnly) {
        conditions.push(isNull(transactions.referenceType))
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined

      const offset = (page - 1) * pageSize

      const [rows, totalResult] = await Promise.all([
        db
          .select({
            id: transactions.id,
            type: transactions.type,
            amount: transactions.amount,
            categoryId: transactions.categoryId,
            categoryName: transactionCategories.name,
            referenceType: transactions.referenceType,
            referenceId: transactions.referenceId,
            description: transactions.description,
            transactionDate: transactions.transactionDate,
            recordedBy: transactions.recordedBy,
            createdAt: transactions.createdAt,
          })
          .from(transactions)
          .innerJoin(
            transactionCategories,
            eq(transactions.categoryId, transactionCategories.id)
          )
          .where(whereClause)
          .orderBy(desc(transactions.transactionDate))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: count() })
          .from(transactions)
          .innerJoin(
            transactionCategories,
            eq(transactions.categoryId, transactionCategories.id)
          )
          .where(whereClause),
      ])

      const total = Number(totalResult[0]?.count ?? 0)

      return { data: rows, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getTransactionById = (
  id: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError | TransactionNotFound> =>
  Effect.tryPromise({
    try: async () => {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))

      if (!transaction) throw { _tag: "TransactionNotFound", id }

      return transaction
    },
    catch: (e: any) => {
      if (e?._tag === "TransactionNotFound")
        return new TransactionNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const deleteTransaction = (
  id: string,
  actorId: string,
  actorRole?: string
): Effect.Effect<void, DatabaseError | TransactionNotFound> =>
  Effect.tryPromise({
    try: async () => {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))

      if (!transaction) throw { _tag: "TransactionNotFound", id }

      const systemReferenceTypes = [
        "payment", "payment_reversal",
        "creditor_repayment", "creditor_investment",
        "loan", "loan_reversal", "loan_repost",
        "rollover", "collateral_settlement", "fund_transfer",
        "interest_accrual",
      ]
      if (transaction.referenceType && systemReferenceTypes.includes(transaction.referenceType)) {
        throw { _tag: "TransactionNotFound", id }
      }

      const isAdminOrAbove = actorRole === "admin" || actorRole === "superAdmin"
      if (transaction.recordedBy !== actorId && !isAdminOrAbove) {
        throw { _tag: "TransactionNotFound", id }
      }

      await db.transaction(async (tx) => {
        // Delete both sides of the journal pair if it has a journalGroupId
        if (transaction.journalGroupId) {
          await tx.delete(transactions).where(eq(transactions.journalGroupId, transaction.journalGroupId))
        } else {
          // Legacy single-entry row
          await tx.delete(transactions).where(eq(transactions.id, id))
        }

        await writeAuditLog(tx, {
          actorId,
          action: "transaction.delete",
          entityType: "transaction",
          entityId: id,
          beforeValue: transaction,
          afterValue: null,
        })
      })
    },
    catch: (e: any) => {
      if (e?._tag === "TransactionNotFound")
        return new TransactionNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

// ── Interest Accrual Functions ─────────────────────────────────────────

function accrualDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Reverses outstanding Interest Receivable accrual entries for a specific loan.
 * Called before posting cash-basis interest earned on payment receipt.
 * Posts: DR Interest Earned / CR Interest Receivable (undoes accrual).
 */
export async function reverseInterestAccrual(
  tx: DrizzleTransaction,
  params: {
    loanId: string
    paymentDate: string
    actorId: string
  }
): Promise<void> {
  const [receivableCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Receivable"),
        eq(transactionCategories.type, "revenue")
      )
    )

  if (!receivableCat) return

  const [earnedCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        eq(transactionCategories.type, "revenue")
      )
    )

  if (!earnedCat) return

  const accrualRows = await tx
    .select({ amount: transactions.amount, type: transactions.type })
    .from(transactions)
    .where(
      and(
        eq(transactions.referenceType, "interest_accrual"),
        eq(transactions.referenceId, params.loanId),
        eq(transactions.categoryId, receivableCat.id)
      )
    )

  let netAccrual = new BigNumber(0)
  for (const row of accrualRows) {
    if (row.type === "debit") {
      netAccrual = netAccrual.plus(row.amount)
    } else {
      netAccrual = netAccrual.minus(row.amount)
    }
  }

  if (netAccrual.isLessThanOrEqualTo(0)) return

  const reversalAmount = formatAmount(netAccrual)
  const now = new Date(params.paymentDate)
  const journalGroupId = randomUUID()

  await tx.insert(transactions).values({
    type: "credit",
    amount: reversalAmount,
    categoryId: receivableCat.id,
    referenceType: "interest_accrual",
    referenceId: params.loanId,
    description: `Reverse interest accrual on payment - loan ${params.loanId}`,
    transactionDate: now,
    recordedBy: params.actorId,
    journalGroupId,
  })

  await tx.insert(transactions).values({
    type: "debit",
    amount: reversalAmount,
    categoryId: earnedCat.id,
    referenceType: "interest_accrual",
    referenceId: params.loanId,
    description: `Reverse interest accrual on payment - loan ${params.loanId}`,
    transactionDate: now,
    recordedBy: params.actorId,
    journalGroupId,
  })
}

/**
 * Reverse outstanding creditor interest accrual entries (Interest Payable)
 * when a cash repayment is recorded. Mirrors reverseInterestAccrual for loans.
 */
export async function reverseCreditorInterestAccrual(
  tx: DrizzleTransaction,
  params: {
    investmentId: string
    repaymentDate: string
    actorId: string
  }
): Promise<void> {
  const [payableCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Payable"),
        eq(transactionCategories.type, "expense")
      )
    )

  if (!payableCat) return

  const [expenseCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Payments"),
        eq(transactionCategories.type, "expense")
      )
    )

  if (!expenseCat) return

  const accrualRows = await tx
    .select({ amount: transactions.amount, type: transactions.type })
    .from(transactions)
    .where(
      and(
        eq(transactions.referenceType, "interest_accrual"),
        eq(transactions.referenceId, params.investmentId),
        eq(transactions.categoryId, payableCat.id)
      )
    )

  let netAccrual = new BigNumber(0)
  for (const row of accrualRows) {
    if (row.type === "credit") {
      netAccrual = netAccrual.plus(row.amount)
    } else {
      netAccrual = netAccrual.minus(row.amount)
    }
  }

  if (netAccrual.isLessThanOrEqualTo(0)) return

  const reversalAmount = formatAmount(netAccrual)
  const now = new Date(params.repaymentDate)
  const journalGroupId = randomUUID()

  await tx.insert(transactions).values({
    type: "debit",
    amount: reversalAmount,
    categoryId: payableCat.id,
    referenceType: "interest_accrual",
    referenceId: params.investmentId,
    description: `Reverse creditor interest accrual on repayment - investment ${params.investmentId}`,
    transactionDate: now,
    recordedBy: params.actorId,
    journalGroupId,
  })

  await tx.insert(transactions).values({
    type: "credit",
    amount: reversalAmount,
    categoryId: expenseCat.id,
    referenceType: "interest_accrual",
    referenceId: params.investmentId,
    description: `Reverse creditor interest accrual on repayment - investment ${params.investmentId}`,
    transactionDate: now,
    recordedBy: params.actorId,
    journalGroupId,
  })
}

/**
 * Accrues interest for all active loans as of `asOfDate`.
 * Idempotent: calling multiple times will not double-post.
 * Posts: DR Interest Receivable / CR Interest Earned
 */
export const accrueInterestForLoans = (
  asOfDate: Date = new Date()
): Effect.Effect<{ loansProcessed: number; entriesPosted: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [receivableCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Receivable"), eq(transactionCategories.type, "revenue")))

      const [earnedCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Earned"), eq(transactionCategories.type, "revenue")))

      if (!receivableCat || !earnedCat) {
        console.warn("[accrueInterestForLoans] Required categories not found — skipping")
        return { loansProcessed: 0, entriesPosted: 0 }
      }

      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const loanIds = activeLoans.map((l) => l.id)
      const [ledgerBalances, interestEarnedBatch, paymentCountRows] = await Promise.all([
        getLoanBalancesFromLedger(loanIds),
        getInterestEarnedFromLedger(loanIds),
        loanIds.length > 0
          ? db.select({ loanId: payments.loanId, cnt: count() })
              .from(payments)
              .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
              .groupBy(payments.loanId)
          : Promise.resolve([]),
      ])
      const paymentCountMap = new Map(paymentCountRows.map((r) => [r.loanId, r.cnt]))

      let entriesPosted = 0

      for (const loan of activeLoans) {
        const baseRate = getBaseRate(loan)
        const outstandingBalanceBN = ledgerBalances.get(loan.id)
        const outstandingBalance = outstandingBalanceBN && outstandingBalanceBN.isGreaterThan(0)
          ? formatAmount(outstandingBalanceBN)
          : loan.principalAmount
        const totalInterestPaid = formatAmount(interestEarnedBatch.get(loan.id) ?? new BigNumber(0))
        const overdueInfo = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType: toLoanType(loan.loanType),
          termMonths: loan.termMonths,
          totalInterestPaid,
          paymentCount: paymentCountMap.get(loan.id) ?? 0,
          outstandingBalance,
          penaltyWaived: loan.penaltyWaived,
          loan,
        })
        const effectiveRate = getEffectiveRate(loan, overdueInfo.penaltyActive)
        const totalDaysElapsed = accrualDaysBetween(new Date(loan.startDate), asOfDate)

        if (!outstandingBalanceBN || outstandingBalanceBN.isEqualTo(0)) {
          console.warn(`[accrueInterestForLoans] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
        }
        const principalForAccrual = outstandingBalance
        const totalInterestAccrued = calculateInterest(principalForAccrual, effectiveRate, totalDaysElapsed, 0)

        // Net Interest Earned from ledger = cash interest + accruals - reversals
        const totalInterestEarned = interestEarnedBatch.get(loan.id) ?? new BigNumber(0)

        const target = totalInterestAccrued.minus(totalInterestEarned)

        if (target.isGreaterThan(0)) {
          // When penalty is active, split into base interest + penalty interest
          // so the ledger transparently shows the penalty portion
          let baseAmount: BigNumber
          let penaltyAmount: BigNumber

          if (overdueInfo.penaltyActive) {
            const totalAtBaseRate = calculateInterest(principalForAccrual, baseRate, totalDaysElapsed, 0)
            const baseTarget = totalAtBaseRate.minus(totalInterestEarned)
            baseAmount = BigNumber.max(baseTarget, 0)
            penaltyAmount = target.minus(baseAmount)
            // If base is fully covered, all new accrual is penalty
            if (penaltyAmount.isLessThan(0)) penaltyAmount = new BigNumber(0)
          } else {
            baseAmount = target
            penaltyAmount = new BigNumber(0)
          }

          await db.transaction(async (tx) => {
            // Post base interest accrual
            if (baseAmount.isGreaterThan(0)) {
              const amount = formatAmount(baseAmount)
              const journalGroupId = randomUUID()
              await tx.insert(transactions).values({
                type: "debit", amount, categoryId: receivableCat.id,
                referenceType: "interest_accrual", referenceId: loan.id,
                description: `Interest accrual - loan ${loan.id}`,
                transactionDate: asOfDate, recordedBy: "system",
                journalGroupId, loanId: loan.id,
              })
              await tx.insert(transactions).values({
                type: "credit", amount, categoryId: earnedCat.id,
                referenceType: "interest_accrual", referenceId: loan.id,
                description: `Interest accrual - loan ${loan.id}`,
                transactionDate: asOfDate, recordedBy: "system",
                journalGroupId, loanId: loan.id,
              })
            }

            // Post penalty interest as a separate, labeled entry
            if (penaltyAmount.isGreaterThan(0)) {
              const amount = formatAmount(penaltyAmount)
              const journalGroupId = randomUUID()
              await tx.insert(transactions).values({
                type: "debit", amount, categoryId: receivableCat.id,
                referenceType: "penalty_interest_accrual", referenceId: loan.id,
                description: `Penalty interest (${(parseFloat(loan.penaltyMultiplier) * 100).toFixed(0)}% surcharge) - loan ${loan.id}`,
                transactionDate: asOfDate, recordedBy: "system",
                journalGroupId, loanId: loan.id,
              })
              await tx.insert(transactions).values({
                type: "credit", amount, categoryId: earnedCat.id,
                referenceType: "penalty_interest_accrual", referenceId: loan.id,
                description: `Penalty interest (${(parseFloat(loan.penaltyMultiplier) * 100).toFixed(0)}% surcharge) - loan ${loan.id}`,
                transactionDate: asOfDate, recordedBy: "system",
                journalGroupId, loanId: loan.id,
              })
            }
          })
          entriesPosted++
        }
      }

      return { loansProcessed: activeLoans.length, entriesPosted }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Accrues interest for all active creditor investments as of `asOfDate`.
 * Idempotent: calling multiple times will not double-post.
 * Posts: DR Interest Expense / CR Interest Payable
 */
export const accrueInterestForCreditors = (
  asOfDate: Date = new Date()
): Effect.Effect<{ investmentsProcessed: number; entriesPosted: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [payableCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Payable"), eq(transactionCategories.type, "expense")))

      const [expenseCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Payments"), eq(transactionCategories.type, "expense")))

      if (!payableCat || !expenseCat) {
        console.warn("[accrueInterestForCreditors] Required categories not found — skipping")
        return { investmentsProcessed: 0, entriesPosted: 0 }
      }

      const allInvestments = await db.select().from(creditorInvestments)

      // Use ledger to determine active investments and their balances
      const investmentIds = allInvestments.map((inv) => inv.id)
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds)

      const activeInvestments = allInvestments.filter((inv) => {
        const ledgerBal = ledgerBalances.get(inv.id)
        return ledgerBal ? ledgerBal.isGreaterThan(0) : true
      })

      let entriesPosted = 0

      for (const investment of activeInvestments) {
        const repaymentsList = await db
          .select()
          .from(creditorRepayments)
          .where(eq(creditorRepayments.investmentId, investment.id))
          .orderBy(asc(creditorRepayments.repaymentDate), asc(creditorRepayments.createdAt))

        const prevDate = repaymentsList.length === 0
          ? new Date(investment.investmentDate)
          : new Date(repaymentsList[repaymentsList.length - 1].repaymentDate)

        const principalBalance = ledgerBalances.get(investment.id) ?? (() => {
          console.warn(`[accrueInterestForCreditors] No ledger entries for investment ${investment.id}, using amount as fallback`)
          return new BigNumber(investment.amount)
        })()
        const daysElapsed = accrualDaysBetween(prevDate, asOfDate)
        const interestSinceLastRepayment = calculateInterest(
          formatAmount(principalBalance), investment.interestRateMonthly, daysElapsed, 0
        )

        const existingAccrualRows = await db
          .select({ amount: transactions.amount, type: transactions.type })
          .from(transactions)
          .where(and(
            eq(transactions.referenceType, "interest_accrual"),
            eq(transactions.referenceId, investment.id),
            eq(transactions.categoryId, payableCat.id)
          ))

        let netExistingAccrual = new BigNumber(0)
        for (const row of existingAccrualRows) {
          if (row.type === "credit") netExistingAccrual = netExistingAccrual.plus(row.amount)
          else netExistingAccrual = netExistingAccrual.minus(row.amount)
        }

        const target = interestSinceLastRepayment.minus(netExistingAccrual)

        if (target.isGreaterThan(0)) {
          const amount = formatAmount(target)
          await db.transaction(async (tx) => {
            const journalGroupId = randomUUID()
            await tx.insert(transactions).values({
              type: "debit", amount, categoryId: expenseCat.id,
              referenceType: "interest_accrual", referenceId: investment.id,
              description: `Interest accrual - investment ${investment.id}`,
              transactionDate: asOfDate, recordedBy: "system",
              journalGroupId,
            })
            await tx.insert(transactions).values({
              type: "credit", amount, categoryId: payableCat.id,
              referenceType: "interest_accrual", referenceId: investment.id,
              description: `Interest accrual - investment ${investment.id}`,
              transactionDate: asOfDate, recordedBy: "system",
              journalGroupId,
            })
          })
          entriesPosted++
        }
      }

      return { investmentsProcessed: activeInvestments.length, entriesPosted }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

// Re-export split modules for backward compatibility
export {
  getLoanBalancesFromLedger,
  getLoanBalanceFromLedger,
  getInterestEarnedFromLedger,
  getInterestPayableFromLedger,
  getCreditorBalancesFromLedger,
  getPaymentPortionsFromLedger,
  getCreditorRepaymentPortionsFromLedger,
  getCreditorTotalInvestedFromLedger,
  getCreditorTotalRepaidFromLedger,
} from "./ledger-queries.service"

export {
  autoPostInterestEarned,
  autoPostInterestExpense,
  autoPostPrincipalDisbursement,
  autoPostRolloverPrincipalTransfer,
  autoPostPrincipalRepayment,
  autoPostPrincipalRecovery,
  autoPostCreditorInvestment,
  autoPostCreditorPrincipalRepaid,
  autoPostRateChangeAdjustment,
  autoPostFundTransfer,
  autoPostCapitalInjection,
} from "./auto-post.service"
