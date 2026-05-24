import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import { resetDb, testDb } from "./setup"
import {
  seedDefaultCategories,
  listCategories,
  createCategory,
  deleteCategory,
  getCategoryByName,
} from "@/services/category.service"
import {
  CategoryNotFound,
  CategoryInUseError,
} from "@/lib/errors"
import { auditLog } from "@/lib/db/schema/audit"
import { transactions } from "@/lib/db/schema/transactions"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"

const TEST_TIMEOUT = 30_000

describe("Category Service (integration)", () => {
  beforeEach(async () => {
    await resetDb()
  }, TEST_TIMEOUT)

  // ── 1. seedDefaultCategories ───────────────────────────────────────
  it("seeds all default categories across all types", async () => {
    await Effect.runPromise(seedDefaultCategories())

    const categories = await Effect.runPromise(listCategories())

    // 3 asset + 1 liability + 1 equity + 3 revenue + 5 expense = 13 defaults
    expect(categories).toHaveLength(13)

    const expenseNames = categories
      .filter((c) => c.type === "expense")
      .map((c) => c.name)
      .sort()
    expect(expenseNames).toEqual([
      "DStv",
      "Interest Payments",
      "Office Expenses",
      "Rent",
      "Salaries",
    ])

    const revenueNames = categories
      .filter((c) => c.type === "revenue")
      .map((c) => c.name)
      .sort()
    expect(revenueNames).toEqual([
      "Bonuses",
      "Interest Earned",
      "Issuance Fees",
    ])

    // All should be marked as default
    expect(categories.every((c) => c.isDefault)).toBe(true)
  }, TEST_TIMEOUT)

  // ── 2. seedDefaultCategories is idempotent ─────────────────────────
  it("does not duplicate categories on repeated seed", async () => {
    await Effect.runPromise(seedDefaultCategories())
    await Effect.runPromise(seedDefaultCategories())

    const categories = await Effect.runPromise(listCategories())
    expect(categories).toHaveLength(13)
  }, TEST_TIMEOUT)

  // ── 3. listCategories filters by type ──────────────────────────────
  it("filters categories by expense type", async () => {
    await Effect.runPromise(seedDefaultCategories())

    const expenses = await Effect.runPromise(listCategories("expense"))
    expect(expenses).toHaveLength(5)
    expect(expenses.every((c) => c.type === "expense")).toBe(true)
  }, TEST_TIMEOUT)

  it("filters categories by revenue type", async () => {
    await Effect.runPromise(seedDefaultCategories())

    const revenues = await Effect.runPromise(listCategories("revenue"))
    expect(revenues).toHaveLength(3)
    expect(revenues.every((c) => c.type === "revenue")).toBe(true)
  }, TEST_TIMEOUT)

  // ── 4. listCategories returns empty when no categories exist ───────
  it("returns empty array when no categories exist", async () => {
    const categories = await Effect.runPromise(listCategories())
    expect(categories).toEqual([])
  }, TEST_TIMEOUT)

  // ── 5. createCategory ──────────────────────────────────────────────
  it("creates a custom category with isDefault=false", async () => {
    const category = await Effect.runPromise(
      createCategory({ name: "Transport", type: "expense" }, "actor-1")
    )

    expect(category.id).toBeDefined()
    expect(category.name).toBe("Transport")
    expect(category.type).toBe("expense")
    expect(category.isDefault).toBe(false)
    expect(category.createdAt).toBeInstanceOf(Date)
  }, TEST_TIMEOUT)

  // ── 6. createCategory writes audit log ─────────────────────────────
  it("writes an audit log entry when creating a category", async () => {
    const category = await Effect.runPromise(
      createCategory({ name: "Utilities", type: "expense" }, "admin-99")
    )

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, category.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("category.create")
    expect(logs[0].actorId).toBe("admin-99")
    expect(logs[0].entityType).toBe("transaction_category")
    expect(logs[0].beforeValue).toBeNull()
    expect(JSON.parse(logs[0].afterValue!)).toMatchObject({
      name: "Utilities",
      type: "expense",
    })
  }, TEST_TIMEOUT)

  // ── 7. deleteCategory ──────────────────────────────────────────────
  it("deletes a category and writes an audit log", async () => {
    const category = await Effect.runPromise(
      createCategory({ name: "Temp Category", type: "revenue" }, "actor-1")
    )

    await Effect.runPromise(deleteCategory(category.id, "actor-2"))

    // Verify category is gone
    const remaining = await Effect.runPromise(listCategories())
    expect(remaining.find((c) => c.id === category.id)).toBeUndefined()

    // Verify audit log has both create and delete entries
    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, category.id))

    const deleteLog = logs.find((l) => l.action === "category.delete")
    expect(deleteLog).toBeDefined()
    expect(deleteLog!.actorId).toBe("actor-2")
    expect(JSON.parse(deleteLog!.beforeValue!)).toMatchObject({
      name: "Temp Category",
      type: "revenue",
    })
    expect(deleteLog!.afterValue).toBeNull()
  }, TEST_TIMEOUT)

  // ── 8. deleteCategory with non-existent id ─────────────────────────
  it("returns CategoryNotFound for a non-existent category", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(deleteCategory(fakeId, "actor-1"))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CategoryNotFound)
      }
    }
  }, TEST_TIMEOUT)

  // ── 9. deleteCategory fails when category is in use ────────────────
  it("returns CategoryInUseError when transactions reference the category", async () => {
    const category = await Effect.runPromise(
      createCategory({ name: "In-Use Category", type: "expense" }, "actor-1")
    )

    // Insert a transaction referencing this category
    await testDb.insert(transactions).values({
      type: "debit",
      amount: "100.00",
      categoryId: category.id,
      transactionDate: new Date("2026-01-15"),
      recordedBy: "actor-1",
    })

    const exit = await Effect.runPromiseExit(deleteCategory(category.id, "actor-1"))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CategoryInUseError)
      }
    }
  }, TEST_TIMEOUT)

  // ── 10. getCategoryByName ──────────────────────────────────────────
  it("finds a category by name and type", async () => {
    await Effect.runPromise(seedDefaultCategories())

    const category = await Effect.runPromise(
      getCategoryByName("Interest Earned", "revenue")
    )

    expect(category.name).toBe("Interest Earned")
    expect(category.type).toBe("revenue")
    expect(category.isDefault).toBe(true)
  }, TEST_TIMEOUT)

  it("returns CategoryNotFound when name does not match", async () => {
    await Effect.runPromise(seedDefaultCategories())

    const exit = await Effect.runPromiseExit(
      getCategoryByName("Nonexistent Category", "revenue")
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CategoryNotFound)
      }
    }
  }, TEST_TIMEOUT)

  it("returns CategoryNotFound when name exists but type is wrong", async () => {
    await Effect.runPromise(seedDefaultCategories())

    // "Interest Earned" is income, not expense
    const exit = await Effect.runPromiseExit(
      getCategoryByName("Interest Earned", "expense")
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CategoryNotFound)
      }
    }
  }, TEST_TIMEOUT)

  // ── 11. listCategories ordered by name ─────────────────────────────
  it("returns categories ordered by name", async () => {
    await Effect.runPromise(
      createCategory({ name: "Zebra", type: "expense" }, "actor-1")
    )
    await Effect.runPromise(
      createCategory({ name: "Apple", type: "expense" }, "actor-1")
    )
    await Effect.runPromise(
      createCategory({ name: "Mango", type: "expense" }, "actor-1")
    )

    const categories = await Effect.runPromise(listCategories())
    const names = categories.map((c) => c.name)
    expect(names).toEqual(["Apple", "Mango", "Zebra"])
  }, TEST_TIMEOUT)
})
