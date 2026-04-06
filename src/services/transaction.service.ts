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

      if (transaction.referenceType === "payment" || transaction.referenceType === "creditor_repayment") {
        throw { _tag: "TransactionNotFound", id }
      }

      const isAdminOrAbove = actorRole === "admin" || actorRole === "superAdmin"
      if (transaction.recordedBy !== actorId && !isAdminOrAbove) {
        throw { _tag: "TransactionNotFound", id }
      }

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

export async function autoPostInterestEarned(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    paymentId: string
    paymentDate: string
    actorId: string
  }
): Promise<void> {
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
    referenceId: params.paymentId,
    description: `Interest earned - loan ${params.loanId} payment ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
  })
}

export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: {
    amount: string
    investmentId: string
    repaymentDate: string
    actorId: string
  }
): Promise<void> {
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
