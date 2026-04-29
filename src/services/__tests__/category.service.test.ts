import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

describe("Category Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("exports all expected functions", async () => {
    const mod = await import("@/services/category.service")
    expect(mod.seedDefaultCategories).toBeDefined()
    expect(mod.listCategories).toBeDefined()
    expect(mod.createCategory).toBeDefined()
    expect(mod.deleteCategory).toBeDefined()
    expect(mod.getCategoryByName).toBeDefined()
  })

  // ── seedDefaultCategories ──────────────────────────────────────────

  it("seedDefaultCategories inserts missing categories", async () => {
    const { db } = await import("@/lib/db")
    const { seedDefaultCategories } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    // No existing categories
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    } as any)

    mockedDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as any)

    await Effect.runPromise(seedDefaultCategories())

    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
  })

  it("seedDefaultCategories skips when all categories exist", async () => {
    const { db } = await import("@/lib/db")
    const { seedDefaultCategories } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    // All default categories already exist
    const existing = [
      { type: "asset", name: "Cash" },
      { type: "asset", name: "Loans Receivable" },
      { type: "asset", name: "Seized Collateral" },
      { type: "liability", name: "Creditor Investment" },
      { type: "equity", name: "Share Capital" },
      { type: "revenue", name: "Bonuses" },
      { type: "revenue", name: "Interest Earned" },
      { type: "revenue", name: "Issuance Fees" },
      { type: "expense", name: "Rent" },
      { type: "expense", name: "Salaries" },
      { type: "expense", name: "Office Expenses" },
      { type: "expense", name: "Interest Payments" },
      { type: "expense", name: "Interest Payable" },
      { type: "expense", name: "DStv" },
      { type: "expense", name: "User Expense" },
      { type: "revenue", name: "Interest Receivable" },
      { type: "revenue", name: "User Revenue" },
    ]

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue(existing),
    } as any)

    await Effect.runPromise(seedDefaultCategories())

    // Should NOT call insert because all exist
    expect(mockedDb.insert).not.toHaveBeenCalled()
  })

  // ── listCategories ─────────────────────────────────────────────────

  it("listCategories returns all categories when no type filter", async () => {
    const { db } = await import("@/lib/db")
    const { listCategories } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const mockCategories = [
      { id: "c1", name: "Rent", type: "expense", isDefault: true },
      { id: "c2", name: "Bonuses", type: "revenue", isDefault: true },
    ]

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(mockCategories),
      }),
    } as any)

    const result = await Effect.runPromise(listCategories())

    expect(result).toEqual(mockCategories)
    expect(mockedDb.select).toHaveBeenCalledTimes(1)
  })

  it("listCategories filters by type when provided", async () => {
    const { db } = await import("@/lib/db")
    const { listCategories } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const expenseCategories = [
      { id: "c1", name: "Rent", type: "expense", isDefault: true },
    ]

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(expenseCategories),
        }),
      }),
    } as any)

    const result = await Effect.runPromise(listCategories("expense"))

    expect(result).toEqual(expenseCategories)
  })

  // ── createCategory ─────────────────────────────────────────────────

  it("creates a category and writes an audit log", async () => {
    const { db } = await import("@/lib/db")
    const { createCategory } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const mockCategory = {
      id: "cat-new",
      name: "Transport",
      type: "expense",
      isDefault: false,
      createdAt: new Date("2026-01-01"),
    }

    mockedDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockCategory]),
      }),
    } as any)

    mockedDb.transaction.mockImplementation(async (fn: any) => {
      return await fn(mockedDb)
    })

    const result = await Effect.runPromise(
      createCategory({ name: "Transport", type: "expense" }, "actor-1")
    )

    expect(result).toEqual(mockCategory)
    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1)

    const { writeAuditLog } = await import("@/services/audit.service")
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "category.create" })
    )
  })

  // ── deleteCategory ─────────────────────────────────────────────────

  it("deleteCategory fails with CategoryNotFound for non-existent id", async () => {
    const { db } = await import("@/lib/db")
    const { deleteCategory } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }
    mockedDb.transaction.mockImplementation(async (fn: any) => fn(mockTx))

    const exit = await Effect.runPromiseExit(deleteCategory("nonexistent", "actor-1"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("CategoryNotFound")
      }
    }
  })

  it("deleteCategory: happy path — deletes category and writes audit log", async () => {
    const { db } = await import("@/lib/db")
    const { deleteCategory } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const mockCategory = { id: "cat-del", name: "Old Category", type: "expense", isDefault: false }

    // All queries now happen inside the transaction
    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockCategory]),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }

    mockedDb.transaction.mockImplementation(async (fn: any) => {
      await fn(mockTx)
    })

    await Effect.runPromise(deleteCategory("cat-del", "actor-1"))

    expect(mockedDb.transaction).toHaveBeenCalledTimes(1)
    expect(mockTx.delete).toHaveBeenCalledTimes(1)

    const { writeAuditLog } = await import("@/services/audit.service")
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "category.delete" })
    )
  })

  it("deleteCategory fails with CategoryInUseError when transactions reference it", async () => {
    const { db } = await import("@/lib/db")
    const { deleteCategory } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ id: "cat-1", name: "Rent", type: "expense" }]),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 3 }]),
          }),
        }
      }),
    }
    mockedDb.transaction.mockImplementation(async (fn: any) => fn(mockTx))

    const exit = await Effect.runPromiseExit(deleteCategory("cat-1", "actor-1"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("CategoryInUseError")
      }
    }
  })

  // ── getCategoryByName ──────────────────────────────────────────────

  it("getCategoryByName returns category when found", async () => {
    const { db } = await import("@/lib/db")
    const { getCategoryByName } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    const mockCategory = { id: "c1", name: "Interest Earned", type: "revenue", isDefault: true }

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockCategory]),
      }),
    } as any)

    const result = await Effect.runPromise(getCategoryByName("Interest Earned", "revenue"))

    expect(result).toEqual(mockCategory)
  })

  it("getCategoryByName fails with CategoryNotFound when not found", async () => {
    const { db } = await import("@/lib/db")
    const { getCategoryByName } = await import("@/services/category.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    const exit = await Effect.runPromiseExit(getCategoryByName("Nonexistent", "revenue"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (exit._tag === "Failure") {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("CategoryNotFound")
      }
    }
  })
})
