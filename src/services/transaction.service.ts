import { Effect } from "effect"
import { randomUUID } from "crypto"
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

      if (transaction.referenceType === "payment" || transaction.referenceType === "creditor_repayment") {
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
