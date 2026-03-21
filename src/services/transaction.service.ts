import { Effect } from "effect"
import { db } from "@/lib/db"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import {
  eq,
  and,
  gte,
  lte,
  desc,
  count,
  sql,
} from "drizzle-orm"
import {
  DatabaseError,
  TransactionNotFound,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type {
  CreateExpenseInput,
  CreateIncomeInput,
  TransactionLogFilters,
} from "@/types"

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Records an expense (debit) in the transaction log.
 * Writes audit log.
 */
export const recordExpense = (
  input: CreateExpenseInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transaction] = await tx
          .insert(transactions)
          .values({
            type: "debit",
            amount: input.amount,
            categoryId: input.categoryId,
            transactionDate: new Date(input.transactionDate),
            description: input.notes ?? null,
            recordedBy: actorId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "transaction.create",
          entityType: "transaction",
          entityId: transaction.id,
          beforeValue: null,
          afterValue: transaction,
        })

        return transaction
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Records income (credit) in the transaction log.
 * Writes audit log.
 */
export const recordIncome = (
  input: CreateIncomeInput,
  actorId: string
): Effect.Effect<typeof transactions.$inferSelect, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transaction] = await tx
          .insert(transactions)
          .values({
            type: "credit",
            amount: input.amount,
            categoryId: input.categoryId,
            transactionDate: new Date(input.transactionDate),
            description: input.notes ?? null,
            recordedBy: actorId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "transaction.create",
          entityType: "transaction",
          entityId: transaction.id,
          beforeValue: null,
          afterValue: transaction,
        })

        return transaction
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Lists transactions with optional filters, paginated.
 * Returns transactions joined with category name, ordered by transactionDate DESC.
 */
export const listTransactions = (
  filters: TransactionLogFilters,
  page: number,
  pageSize: number
): Effect.Effect<
  {
    data: (typeof transactions.$inferSelect & { categoryName: string })[]
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
          .where(whereClause),
      ])

      const total = Number(totalResult[0]?.count ?? 0)

      return { data: rows, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Fetches a single transaction by ID.
 * Returns TransactionNotFound if it doesn't exist.
 */
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

/**
 * Deletes a transaction by ID.
 * Writes audit log with before value.
 */
export const deleteTransaction = (
  id: string,
  actorId: string
): Effect.Effect<void, DatabaseError | TransactionNotFound> =>
  Effect.tryPromise({
    try: async () => {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))

      if (!transaction) throw { _tag: "TransactionNotFound", id }

      await db.transaction(async (tx) => {
        await tx.delete(transactions).where(eq(transactions.id, id))

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

/**
 * Auto-posts an "Interest Earned" income entry to the transaction log.
 * MUST be called inside a db.transaction() callback with the tx handle.
 * Plain async (not Effect) — same pattern as writeAuditLog (Pitfall 7).
 */
export async function autoPostInterestEarned(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    paymentDate: string
    actorId: string
  }
): Promise<void> {
  // Look up "Interest Earned" income category
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        eq(transactionCategories.type, "income")
      )
    )

  if (!category) {
    // Category not seeded yet — skip auto-posting rather than failing the payment
    console.warn(
      '[autoPostInterestEarned] "Interest Earned" category not found — skipping auto-post'
    )
    return
  }

  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "payment",
    referenceId: params.loanId,
    description: `Interest earned - loan ${params.loanId}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
  })
}

/**
 * Auto-posts an "Interest Payments" expense entry to the transaction log.
 * MUST be called inside a db.transaction() callback with the tx handle.
 * Plain async (not Effect) — same pattern as writeAuditLog (Pitfall 7).
 */
export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: {
    amount: string
    investmentId: string
    repaymentDate: string
    actorId: string
  }
): Promise<void> {
  // Look up "Interest Payments" expense category
  const [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, "Interest Payments"),
        eq(transactionCategories.type, "expense")
      )
    )

  if (!category) {
    console.warn(
      '[autoPostInterestExpense] "Interest Payments" category not found — skipping auto-post'
    )
    return
  }

  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId: category.id,
    referenceType: "creditor_repayment",
    referenceId: params.investmentId,
    description: `Interest paid - investment ${params.investmentId}`,
    transactionDate: new Date(params.repaymentDate),
    recordedBy: params.actorId,
  })
}
