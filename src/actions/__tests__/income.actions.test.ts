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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/transaction.service", () => ({
  recordIncome: vi.fn(),
  deleteTransaction: vi.fn(),
}))

vi.mock("@/services/category.service", () => ({
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction } from "@/services/transaction.service"
import { createCategory, deleteCategory } from "@/services/category.service"

import {
  recordIncomeAction,
  deleteIncomeAction,
  createIncomeCategoryAction,
  deleteIncomeCategoryAction,
} from "../income.actions"

import { fakeSession, lowRoleSession } from "./test-utils"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockRecordIncome = vi.mocked(recordIncome)
const mockDeleteTransaction = vi.mocked(deleteTransaction)
const mockCreateCategory = vi.mocked(createCategory)
const mockDeleteCategory = vi.mocked(deleteCategory)

// ---------- Tests ----------

describe("Income Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== recordIncomeAction =====
  describe("recordIncomeAction", () => {
    const validInput = {
      amount: "100000",
      categoryId: "cat1",
      transactionDate: "2026-04-01",
      description: "Consulting fee",
      depositLocation: "bank",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await recordIncomeAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await recordIncomeAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordIncomeAction({ ...validInput, amount: "abc" } as any)
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("returns error for missing category", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordIncomeAction({ ...validInput, categoryId: "" } as any)
      expect(result).toEqual({ error: "Category is required" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordIncomeAction({ ...validInput, transactionDate: "nope" } as any)
      expect(result).toEqual({ error: "A valid date is required" })
    })

    it("records income and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRecordIncome.mockReturnValue(Effect.succeed(undefined) as any)

      const result = await recordIncomeAction(validInput as any)
      expect(result).toEqual({ success: true })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })

  // ===== deleteIncomeAction =====
  describe("deleteIncomeAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("deletes and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockDeleteTransaction.mockReturnValue(Effect.succeed(undefined) as any)

      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ data: undefined })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })

  // ===== createIncomeCategoryAction =====
  describe("createIncomeCategoryAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await createIncomeCategoryAction({ name: "Fees", type: "income" } as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("creates category on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const cat = { id: "cat1", name: "Fees" }
      mockCreateCategory.mockReturnValue(Effect.succeed(cat) as any)

      const result = await createIncomeCategoryAction({ name: "Fees", type: "income" } as any)
      expect(result).toEqual({ data: cat })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
    })
  })

  // ===== deleteIncomeCategoryAction =====
  describe("deleteIncomeCategoryAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await deleteIncomeCategoryAction("cat1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("deletes category and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockDeleteCategory.mockReturnValue(Effect.succeed(undefined) as any)

      const result = await deleteIncomeCategoryAction("cat1")
      expect(result).toEqual({ data: undefined })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
    })
  })
})
