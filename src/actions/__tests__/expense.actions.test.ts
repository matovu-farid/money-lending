import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("@/lib/action-utils", async () => {
  const { auth } = await import("@/lib/auth") as any
  const { headers } = await import("next/headers") as any
  return {
    getSession: vi.fn(async () => {
      const session = await auth.api.getSession({ headers: await headers() })
      return session?.user ? session : null
    }),
    getUserRole: vi.fn((session: any) => (session?.user?.role ?? "unassigned")),
    checkPermission: vi.fn(async (_session: any, _perm: string) => {
      // By default, return null (allowed). Tests override via mockResolvedValueOnce.
      return null
    }),
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(["expense:create", "backdate:beyond-3-days"])),
    getErrorTag: (error: unknown): string | undefined => {
      if (error == null || typeof error !== "object") return undefined
      if ("_tag" in error && typeof (error as any)._tag === "string") {
        return (error as any)._tag
      }
      return undefined
    },
  }
})

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/transaction.service", () => ({
  recordExpense: vi.fn(),
  deleteTransaction: vi.fn(),
  listTransactions: vi.fn(),
}))

vi.mock("@/services/category.service", () => ({
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  listCategories: vi.fn(),
}))

vi.mock("@/services/report.service", () => ({
  getLocationBalances: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { createCategory, deleteCategory, listCategories } from "@/services/category.service"
import { getLocationBalances } from "@/services/report.service"

import {
  listExpenseTransactionsAction,
  listExpenseCategoriesAction,
  recordExpenseAction,
  deleteExpenseAction,
  createExpenseCategoryAction,
  deleteExpenseCategoryAction,
} from "../expense.actions"

import { fakeSession, lowRoleSession } from "./test-utils"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockRecordExpense = vi.mocked(recordExpense)
const mockDeleteTransaction = vi.mocked(deleteTransaction)
const mockListTransactions = vi.mocked(listTransactions)
const mockCreateCategory = vi.mocked(createCategory)
const mockDeleteCategory = vi.mocked(deleteCategory)
const mockListCategories = vi.mocked(listCategories)
const mockGetLocationBalances = vi.mocked(getLocationBalances)

// ---------- Tests ----------

describe("Expense Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== listExpenseTransactionsAction =====
  describe("listExpenseTransactionsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const txns = [{ id: "t1" }]
      mockListTransactions.mockReturnValue(Effect.succeed(txns) as any)
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ data: txns })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListTransactions.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== listExpenseCategoriesAction =====
  describe("listExpenseCategoriesAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await listExpenseCategoriesAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns categories on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const cats = [{ id: "cat1", name: "Rent" }]
      mockListCategories.mockReturnValue(Effect.succeed(cats) as any)
      const result = await listExpenseCategoriesAction()
      expect(result).toEqual({ data: cats })
    })
  })

  // ===== recordExpenseAction =====
  describe("recordExpenseAction", () => {
    const validInput = {
      amount: "50000",
      categoryId: "cat1",
      transactionDate: "2026-04-01",
      description: "Office rent",
      sourceLocation: "cash",
      backdateNote: "Backdated entry for prior month rent",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await recordExpenseAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await recordExpenseAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordExpenseAction({ ...validInput, amount: "abc" } as any)
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("returns error for missing category", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordExpenseAction({ ...validInput, categoryId: "" } as any)
      expect(result).toEqual({ error: "Category is required" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordExpenseAction({ ...validInput, transactionDate: "nope" } as any)
      expect(result).toEqual({ error: "A valid date is required" })
    })

    it("records expense and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRecordExpense.mockReturnValue(Effect.succeed(undefined) as any)
      mockGetLocationBalances.mockReturnValue(Effect.succeed({ cash: "1000000", bank: "0", strong_room: "0" }) as any)

      const result = await recordExpenseAction(validInput as any)
      expect(result).toEqual({ success: true })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/expenses")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })

  // ===== deleteExpenseAction =====
  describe("deleteExpenseAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("deletes and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockDeleteTransaction.mockReturnValue(Effect.succeed(undefined) as any)

      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ data: undefined })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/expenses")
    })
  })

  // ===== createExpenseCategoryAction =====
  describe("createExpenseCategoryAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await createExpenseCategoryAction({ name: "Rent", type: "expense" } as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("creates category on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const cat = { id: "cat1", name: "Rent" }
      mockCreateCategory.mockReturnValue(Effect.succeed(cat) as any)

      const result = await createExpenseCategoryAction({ name: "Rent", type: "expense" } as any)
      expect(result).toEqual({ data: cat })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/expenses")
    })
  })
})
