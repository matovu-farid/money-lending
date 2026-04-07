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
  sql,
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
import type {
  CreateExpenseInput,
  CreateIncomeInput,
  TransactionLogFilters,
} from "@/types"

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
    .returning()
  return created.id
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
  input: CreateExpenseInput,
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
  input: CreateIncomeInput,
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

export async function autoPostInterestEarned(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Interest Earned", type: "revenue" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Interest earned - loan ${params.loanId} payment ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    loanId: params.loanId,
  })
}

export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Interest Payments", type: "expense" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.investmentId,
    description: `Interest paid - investment ${params.investmentId}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
  })
}

export async function autoPostPrincipalDisbursement(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; transactionDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Loans Receivable", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "loan", referenceId: params.loanId,
    description: `Principal disbursed - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    creditDepositLocation: params.depositLocation,
    loanId: params.loanId,
  })
}

export async function autoPostRolloverPrincipalTransfer(
  tx: DrizzleTransaction,
  params: {
    amount: string
    newLoanId: string
    oldLoanId: string
    transactionDate: Date
    actorId: string
  }
): Promise<void> {
  const journalGroupId = randomUUID()
  const categoryId = await getOrCreateCategory(tx, "Loans Receivable", "asset")

  // DR Loans Receivable (new loan) — increases new loan's receivable
  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.oldLoanId,
    loanId: params.newLoanId,
    description: `Principal carried from loan ${params.oldLoanId.slice(0, 8).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })

  // CR Loans Receivable (old loan) — decreases old loan's receivable
  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.newLoanId,
    loanId: params.oldLoanId,
    description: `Principal transferred to loan ${params.newLoanId.slice(0, 8).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })
}

export async function autoPostPrincipalRepayment(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Principal repaid - loan ${params.loanId.slice(0, 8).toUpperCase()} payment ${params.paymentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    loanId: params.loanId,
  })
}

export async function autoPostPrincipalRecovery(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; transactionDate: string; actorId: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Seized Collateral", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount, referenceType: "collateral_settlement", referenceId: params.loanId,
    description: `Principal recovered via collateral - loan ${params.loanId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    loanId: params.loanId,
  })
}

export async function autoPostCreditorInvestment(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; investmentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Creditor Investment", type: "liability" },
    amount: params.amount, referenceType: "creditor_investment", referenceId: params.investmentId,
    description: `Creditor investment received - ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.investmentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
  })
}

export async function autoPostCreditorPrincipalRepaid(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room" }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Creditor Investment", type: "liability" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.investmentId,
    description: `Creditor principal repaid - investment ${params.investmentId.slice(0, 8).toUpperCase()}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
  })
}

export async function autoPostFundTransfer(
  tx: DrizzleTransaction,
  params: { amount: string; transferId: string; fromLocation: "cash" | "bank" | "strong_room"; toLocation: "cash" | "bank" | "strong_room"; transactionDate: string; actorId: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "fund_transfer", referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    debitDepositLocation: params.toLocation, creditDepositLocation: params.fromLocation,
  })
}

/**
 * Derive per-loan outstanding principal from the ledger.
 * Queries "Loans Receivable" entries grouped by loanId.
 * Asset account: DR adds, CR subtracts.
 */
export async function getLoanBalancesFromLedger(
  loanIds: string[],
  asOf?: Date
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const conditions = [
    eq(transactionCategories.name, "Loans Receivable"),
    inArray(transactions.loanId, loanIds),
  ];
  if (asOf) {
    conditions.push(lte(transactions.transactionDate, asOf));
  }

  const rows = await db
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(and(...conditions))
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.loanId) continue;
    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Asset: DR adds, CR subtracts
    balances.set(
      row.loanId,
      row.txType === "debit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}

/**
 * Derive a single loan's outstanding principal from the ledger.
 */
export async function getLoanBalanceFromLedger(
  loanId: string,
  asOf?: Date
): Promise<BigNumber> {
  const balances = await getLoanBalancesFromLedger([loanId], asOf);
  return balances.get(loanId) ?? new BigNumber(0);
}

/**
 * Derive per-loan total interest earned (cash basis) from the ledger.
 * Queries "Interest Earned" entries grouped by loanId.
 * Revenue account: CR adds, DR subtracts.
 */
export async function getInterestEarnedFromLedger(
  loanIds: string[]
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const rows = await db
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        inArray(transactions.loanId, loanIds)
      )
    )
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.loanId) continue;
    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Revenue: CR adds, DR subtracts
    balances.set(
      row.loanId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}

/**
 * Derive per-investment total interest payable from the ledger.
 * Queries "Interest Payable" entries grouped by referenceId.
 * Liability account: CR adds, DR subtracts.
 */
export async function getInterestPayableFromLedger(
  investmentIds: string[]
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Payable"),
        inArray(transactions.referenceId, investmentIds)
      )
    )
    .groupBy(transactions.referenceId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = balances.get(row.referenceId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.referenceId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}

/**
 * Derive per-investment creditor principal balances from the ledger.
 * Creditor Investment is a liability: CR adds, DR subtracts.
 */
export async function getCreditorBalancesFromLedger(
  investmentIds: string[]
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id)
    )
    .where(
      and(
        eq(transactionCategories.name, "Creditor Investment"),
        inArray(transactions.referenceId, investmentIds)
      )
    )
    .groupBy(transactions.referenceId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = balances.get(row.referenceId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.referenceId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount)
    );
  }
  return balances;
}

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
        eq(transactionCategories.type, "income")
      )
    )

  if (!receivableCat) return

  const [earnedCat] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        eq(transactionCategories.type, "income")
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

  await tx.insert(transactions).values({
    type: "credit",
    amount: reversalAmount,
    categoryId: receivableCat.id,
    referenceType: "interest_accrual",
    referenceId: params.loanId,
    description: `Reverse interest accrual on payment - loan ${params.loanId}`,
    transactionDate: now,
    recordedBy: params.actorId,
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

  await tx.insert(transactions).values({
    type: "debit",
    amount: reversalAmount,
    categoryId: payableCat.id,
    referenceType: "interest_accrual",
    referenceId: params.investmentId,
    description: `Reverse creditor interest accrual on repayment - investment ${params.investmentId}`,
    transactionDate: now,
    recordedBy: params.actorId,
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
        .where(and(eq(transactionCategories.name, "Interest Receivable"), eq(transactionCategories.type, "income")))

      const [earnedCat] = await db
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.name, "Interest Earned"), eq(transactionCategories.type, "income")))

      if (!receivableCat || !earnedCat) {
        console.warn("[accrueInterestForLoans] Required categories not found — skipping")
        return { loansProcessed: 0, entriesPosted: 0 }
      }

      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const loanIds = activeLoans.map((l) => l.id)
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      let entriesPosted = 0

      for (const loan of activeLoans) {
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const totalDaysElapsed = accrualDaysBetween(new Date(loan.startDate), asOfDate)

        const outstandingBalance = ledgerBalances.get(loan.id)
        const principalForAccrual = outstandingBalance && outstandingBalance.isGreaterThan(0)
          ? formatAmount(outstandingBalance)
          : loan.principalAmount
        const totalInterestAccrued = calculateInterest(principalForAccrual, effectiveRate, totalDaysElapsed, 0)

        // Net Interest Earned from ledger = cash interest + accruals - reversals
        const interestEarnedMap = await getInterestEarnedFromLedger([loan.id])
        const totalInterestEarned = interestEarnedMap.get(loan.id) ?? new BigNumber(0)

        const target = totalInterestAccrued.minus(totalInterestEarned)

        if (target.isGreaterThan(0)) {
          const amount = formatAmount(target)
          await db.transaction(async (tx) => {
            await tx.insert(transactions).values({
              type: "debit", amount, categoryId: receivableCat.id,
              referenceType: "interest_accrual", referenceId: loan.id,
              description: `Interest accrual - loan ${loan.id}`,
              transactionDate: asOfDate, recordedBy: "system",
            })
            await tx.insert(transactions).values({
              type: "credit", amount, categoryId: earnedCat.id,
              referenceType: "interest_accrual", referenceId: loan.id,
              description: `Interest accrual - loan ${loan.id}`,
              transactionDate: asOfDate, recordedBy: "system",
            })
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

        const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount)
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
            await tx.insert(transactions).values({
              type: "debit", amount, categoryId: expenseCat.id,
              referenceType: "interest_accrual", referenceId: investment.id,
              description: `Interest accrual - investment ${investment.id}`,
              transactionDate: asOfDate, recordedBy: "system",
            })
            await tx.insert(transactions).values({
              type: "credit", amount, categoryId: payableCat.id,
              referenceType: "interest_accrual", referenceId: investment.id,
              description: `Interest accrual - investment ${investment.id}`,
              transactionDate: asOfDate, recordedBy: "system",
            })
          })
          entriesPosted++
        }
      }

      return { investmentsProcessed: activeInvestments.length, entriesPosted }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
