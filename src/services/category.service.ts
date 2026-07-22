import { Effect } from "effect"
import { db } from "@/lib/db"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, and, count, isNotNull } from "drizzle-orm"
import {
  DatabaseError,
  CategoryInUseError,
  CategoryNotFound,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateCategoryInput } from "@/types"

const DEFAULT_ASSET_CATEGORIES = [
  "Cash",
  "Loans Receivable",
  "Seized Collateral",
]

const DEFAULT_LIABILITY_CATEGORIES = [
  "Creditor Investment",
]

const DEFAULT_EQUITY_CATEGORIES = [
  "Share Capital",
]

const DEFAULT_REVENUE_CATEGORIES = [
  "Bonuses",
  "Interest Earned",
  "Interest Receivable",
  "Issuance Fees",
  // Sentinel category for user-typed manual income entries (mirrors User Expense).
  "User Revenue",
]

const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Salaries",
  "Office Expenses",
  "Interest Payments",
  "Interest Payable",
  "DStv",
  // Sentinel category for user-typed manual expense entries.
  // The user-typed label is stored in transactions.category;
  // categoryId stays NOT NULL so accounting-type semantics survive.
  "User Expense",
  "Loan Losses",
]

export const seedDefaultCategories = (): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const existing = await db.select().from(transactionCategories)
      const existingNames = new Set(existing.map((c) => `${c.type}:${c.name}`))

      const toInsert: {
        name: string
        type: "asset" | "liability" | "equity" | "revenue" | "expense"
        isDefault: boolean
      }[] = []

      for (const name of DEFAULT_ASSET_CATEGORIES) {
        if (!existingNames.has(`asset:${name}`)) {
          toInsert.push({ name, type: "asset", isDefault: true })
        }
      }

      for (const name of DEFAULT_LIABILITY_CATEGORIES) {
        if (!existingNames.has(`liability:${name}`)) {
          toInsert.push({ name, type: "liability", isDefault: true })
        }
      }

      for (const name of DEFAULT_EQUITY_CATEGORIES) {
        if (!existingNames.has(`equity:${name}`)) {
          toInsert.push({ name, type: "equity", isDefault: true })
        }
      }

      for (const name of DEFAULT_REVENUE_CATEGORIES) {
        if (!existingNames.has(`revenue:${name}`)) {
          toInsert.push({ name, type: "revenue", isDefault: true })
        }
      }

      for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        if (!existingNames.has(`expense:${name}`)) {
          toInsert.push({ name, type: "expense", isDefault: true })
        }
      }

      if (toInsert.length > 0) {
        await db.insert(transactionCategories).values(toInsert)
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listCategories = (
  type?: "asset" | "liability" | "equity" | "revenue" | "expense"
): Effect.Effect<(typeof transactionCategories.$inferSelect)[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      if (type) {
        return await db
          .select()
          .from(transactionCategories)
          .where(eq(transactionCategories.type, type))
          .orderBy(transactionCategories.name)
      }
      return await db
        .select()
        .from(transactionCategories)
        .orderBy(transactionCategories.name)
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const createCategory = (
  input: CreateCategoryInput,
  actorId: string
): Effect.Effect<
  typeof transactionCategories.$inferSelect,
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [category] = await tx
          .insert(transactionCategories)
          .values({
            name: input.name,
            type: input.type,
            isDefault: false,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "category.create",
          entityType: "transaction_category",
          entityId: category.id,
          beforeValue: null,
          afterValue: category,
        })

        return category
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const deleteCategory = (
  id: string,
  actorId: string
): Effect.Effect<void, DatabaseError | CategoryInUseError | CategoryNotFound> =>
  Effect.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        const [category] = await tx
          .select()
          .from(transactionCategories)
          .where(eq(transactionCategories.id, id))

        if (!category) throw { _tag: "CategoryNotFound", id }

        const [result] = await tx
          .select({ count: count() })
          .from(transactions)
          .where(eq(transactions.categoryId, id))

        const usageCount = Number(result?.count ?? 0)
        if (usageCount > 0) throw { _tag: "CategoryInUseError", categoryId: id }

        await tx
          .delete(transactionCategories)
          .where(eq(transactionCategories.id, id))

        await writeAuditLog(tx, {
          actorId,
          action: "category.delete",
          entityType: "transaction_category",
          entityId: id,
          beforeValue: category,
          afterValue: null,
        })
      })
    },
    catch: (e: any) => {
      if (e?._tag === "CategoryNotFound") return new CategoryNotFound({ id: e.id })
      if (e?._tag === "CategoryInUseError")
        return new CategoryInUseError({ categoryId: e.categoryId })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Distinct user-typed category labels for the income/expense combobox.
 * Reads `transactions.category` (set only on manual entries) — system
 * journal lines have NULL there and are excluded.
 *
 * Postgres requires that any ORDER BY expression appear in the SELECT list
 * for SELECT DISTINCT, so we order by the raw column and case-fold in JS.
 */
export const listDistinctTransactionCategories = (
  txType: "credit" | "debit"
): Effect.Effect<string[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .selectDistinct({ category: transactions.category })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, txType),
            isNotNull(transactions.category),
          ),
        )
      return rows
        .map((r) => r.category)
        .filter((c): c is string => !!c)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getCategoryByName = (
  name: string,
  type: "asset" | "liability" | "equity" | "revenue" | "expense"
): Effect.Effect<
  typeof transactionCategories.$inferSelect,
  DatabaseError | CategoryNotFound
> =>
  Effect.tryPromise({
    try: async () => {
      const [category] = await db
        .select()
        .from(transactionCategories)
        .where(
          and(
            eq(transactionCategories.name, name),
            eq(transactionCategories.type, type)
          )
        )

      if (!category)
        throw { _tag: "CategoryNotFound", id: `${type}:${name}` }

      return category
    },
    catch: (e: any) => {
      if (e?._tag === "CategoryNotFound")
        return new CategoryNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
