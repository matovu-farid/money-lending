import { Effect } from "effect"
import { db } from "@/lib/db"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, and, count } from "drizzle-orm"
import {
  DatabaseError,
  CategoryInUseError,
  CategoryNotFound,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateCategoryInput } from "@/types"

const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Salaries",
  "Office Expenses",
  "Interest Payments",
  "DStv",
]

const DEFAULT_INCOME_CATEGORIES = [
  "Share Capital",
  "Bonuses",
  "Interest Earned",
]

/**
 * Seeds default expense and income categories if they don't already exist.
 * Safe to run multiple times (check-before-insert pattern).
 */
export const seedDefaultCategories = (): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const existing = await db.select().from(transactionCategories)
      const existingNames = new Set(existing.map((c) => `${c.type}:${c.name}`))

      const toInsert: {
        name: string
        type: "expense" | "income"
        isDefault: boolean
      }[] = []

      for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        if (!existingNames.has(`expense:${name}`)) {
          toInsert.push({ name, type: "expense", isDefault: true })
        }
      }

      for (const name of DEFAULT_INCOME_CATEGORIES) {
        if (!existingNames.has(`income:${name}`)) {
          toInsert.push({ name, type: "income", isDefault: true })
        }
      }

      if (toInsert.length > 0) {
        await db.insert(transactionCategories).values(toInsert)
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Lists all categories, optionally filtered by type.
 * Ordered by name ASC.
 */
export const listCategories = (
  type?: "expense" | "income"
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

/**
 * Creates a new category. Categories created by admin are not default.
 * Writes audit log entry.
 */
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

/**
 * Deletes a category by ID.
 * Fails with CategoryInUseError if any transaction references this category.
 * Writes audit log.
 */
export const deleteCategory = (
  id: string,
  actorId: string
): Effect.Effect<void, DatabaseError | CategoryInUseError | CategoryNotFound> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch category first
      const [category] = await db
        .select()
        .from(transactionCategories)
        .where(eq(transactionCategories.id, id))

      if (!category) throw { _tag: "CategoryNotFound", id }

      // Check if any transactions reference this category
      const [result] = await db
        .select({ count: count() })
        .from(transactions)
        .where(eq(transactions.categoryId, id))

      const usageCount = Number(result?.count ?? 0)
      if (usageCount > 0) throw { _tag: "CategoryInUseError", categoryId: id }

      await db.transaction(async (tx) => {
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
 * Gets a category by name and type.
 * Used by auto-posting to look up "Interest Earned" and "Interest Payments" categories.
 */
export const getCategoryByName = (
  name: string,
  type: "expense" | "income"
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
