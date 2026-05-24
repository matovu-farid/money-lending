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
  const { auth } = await import("@/lib/auth")
  const { headers } = await import("next/headers")
  return {
    getSession: vi.fn(async () => {
      const session = await auth.api.getSession({ headers: await headers() })
      return session?.user ? session : null
    }),
    getUserRole: vi.fn((session: { user?: { role?: string | null } } | null | undefined) =>
      session?.user?.role ?? "unassigned",
    ),
    checkPermission: vi.fn(async () => null),
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(["income:create", "backdate:beyond-3-days"])),
    getErrorTag: (error: unknown): string | undefined => {
      if (error == null || typeof error !== "object") return undefined
      if ("_tag" in error) {
        const tag = (error as { _tag: unknown })._tag
        if (typeof tag === "string") return tag
      }
      return undefined
    },
  }
})

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/transaction.service", () => ({
  recordIncome: vi.fn(),
  deleteTransaction: vi.fn(),
  listTransactions: vi.fn(),
}))

vi.mock("@/services/category.service", () => ({
  listDistinctTransactionCategories: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction } from "@/services/transaction.service"
import { listDistinctTransactionCategories } from "@/services/category.service"

import {
  listIncomeCategoriesAction,
  recordIncomeAction,
  deleteIncomeAction,
} from "../income.actions"

import { fakeSession, lowRoleSession, effectReturn } from "./test-utils"
import type { CreateTransactionInput } from "@/types"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockRecordIncome = vi.mocked(recordIncome)
const mockDeleteTransaction = vi.mocked(deleteTransaction)
const mockListDistinctCategories = vi.mocked(listDistinctTransactionCategories)

type GetSessionReturn = Awaited<ReturnType<typeof auth.api.getSession>>
const sessionAs = (s: typeof fakeSession): GetSessionReturn =>
  s as unknown as GetSessionReturn

const listCategoriesReturn = effectReturn<typeof listDistinctTransactionCategories>
const recordIncomeReturn = effectReturn<typeof recordIncome>
const deleteTransactionReturn = effectReturn<typeof deleteTransaction>

// ---------- Tests ----------

describe("Income Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== listIncomeCategoriesAction =====
  describe("listIncomeCategoriesAction", () => {
    it("returns distinct user-typed category labels on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const names = ["Consulting", "Rental"]
      mockListDistinctCategories.mockReturnValue(listCategoriesReturn(Effect.succeed(names)))
      const result = await listIncomeCategoriesAction()
      expect(result).toEqual({ data: names })
    })
  })

  // ===== recordIncomeAction =====
  describe("recordIncomeAction", () => {
    const validInput: CreateTransactionInput = {
      amount: "100000",
      categoryName: "Consulting",
      transactionDate: "2026-04-01",
      notes: "Consulting fee",
      location: "bank",
      backdateNote: "Backdated entry for prior month consulting fee",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await recordIncomeAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(sessionAs(lowRoleSession))
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await recordIncomeAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordIncomeAction({ ...validInput, amount: "abc" })
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("returns error for missing category", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordIncomeAction({ ...validInput, categoryName: "" })
      expect(result).toEqual({ error: "Category is required" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordIncomeAction({ ...validInput, transactionDate: "nope" })
      expect(result).toEqual({ error: "A valid date is required" })
    })

    it("records income and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      mockRecordIncome.mockReturnValue(recordIncomeReturn(Effect.succeed({ categoryId: "cat-resolved" })))

      const result = await recordIncomeAction(validInput)
      expect(result).toEqual({ success: true })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })

  // ===== deleteIncomeAction =====
  describe("deleteIncomeAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(sessionAs(lowRoleSession))
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("deletes and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      mockDeleteTransaction.mockReturnValue(deleteTransactionReturn(Effect.succeed(undefined)))

      const result = await deleteIncomeAction("t1")
      expect(result).toEqual({ data: undefined })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/income")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })
})
