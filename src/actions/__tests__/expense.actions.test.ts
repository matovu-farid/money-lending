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
    checkPermission: vi.fn(async (_session: unknown, _perm: string) => {
      // By default, return null (allowed). Tests override via mockResolvedValueOnce.
      return null
    }),
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(["expense:create", "backdate:beyond-3-days"])),
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
  recordExpense: vi.fn(),
  deleteTransaction: vi.fn(),
  listTransactions: vi.fn(),
}))

vi.mock("@/services/category.service", () => ({
  listDistinctTransactionCategories: vi.fn(),
}))

vi.mock("@/services/report.service", () => ({
  getLocationBalances: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { listDistinctTransactionCategories } from "@/services/category.service"
import { getLocationBalances } from "@/services/report.service"

import {
  listExpenseTransactionsAction,
  listExpenseCategoriesAction,
  recordExpenseAction,
  deleteExpenseAction,
} from "../expense.actions"

import { fakeSession, lowRoleSession, effectReturn } from "./test-utils"
import type { CreateTransactionInput } from "@/types"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockRecordExpense = vi.mocked(recordExpense)
const mockDeleteTransaction = vi.mocked(deleteTransaction)
const mockListTransactions = vi.mocked(listTransactions)
const mockListDistinctCategories = vi.mocked(listDistinctTransactionCategories)
const mockGetLocationBalances = vi.mocked(getLocationBalances)

type GetSessionReturn = Awaited<ReturnType<typeof auth.api.getSession>>
const sessionAs = (s: typeof fakeSession): GetSessionReturn =>
  s as unknown as GetSessionReturn

const listTxnsReturn = effectReturn<typeof listTransactions>
const listCategoriesReturn = effectReturn<typeof listDistinctTransactionCategories>
const recordExpenseReturn = effectReturn<typeof recordExpense>
const deleteTransactionReturn = effectReturn<typeof deleteTransaction>
const locationBalancesReturn = effectReturn<typeof getLocationBalances>

// ---------- Tests ----------

describe("Expense Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== listExpenseTransactionsAction =====
  describe("listExpenseTransactionsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const txns = [{ id: "t1" }]
      mockListTransactions.mockReturnValue(listTxnsReturn(Effect.succeed(txns)))
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ data: txns })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      mockListTransactions.mockReturnValue(listTxnsReturn(Effect.fail(new Error("boom"))))
      const result = await listExpenseTransactionsAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== listExpenseCategoriesAction =====
  describe("listExpenseCategoriesAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listExpenseCategoriesAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns distinct user-typed category labels on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const names = ["Rent", "Utilities"]
      mockListDistinctCategories.mockReturnValue(listCategoriesReturn(Effect.succeed(names)))
      const result = await listExpenseCategoriesAction()
      expect(result).toEqual({ data: names })
    })
  })

  // ===== recordExpenseAction =====
  describe("recordExpenseAction", () => {
    const validInput: CreateTransactionInput = {
      amount: "50000",
      categoryName: "Office Supplies",
      transactionDate: "2026-04-01",
      notes: "Office rent",
      location: "cash",
      backdateNote: "Backdated entry for prior month rent",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await recordExpenseAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(sessionAs(lowRoleSession))
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await recordExpenseAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordExpenseAction({ ...validInput, amount: "abc" })
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("returns error for missing category", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordExpenseAction({ ...validInput, categoryName: "" })
      expect(result).toEqual({ error: "Category is required" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      const result = await recordExpenseAction({ ...validInput, transactionDate: "nope" })
      expect(result).toEqual({ error: "A valid date is required" })
    })

    it("records expense and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      mockRecordExpense.mockReturnValue(recordExpenseReturn(Effect.succeed({ categoryId: "cat-resolved" })))
      mockGetLocationBalances.mockReturnValue(
        locationBalancesReturn(Effect.succeed({ cash: "1000000", bank: "0", strong_room: "0" })),
      )

      const result = await recordExpenseAction(validInput)
      expect(result).toEqual({ success: true })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/expenses")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/transactions")
    })
  })

  // ===== deleteExpenseAction =====
  describe("deleteExpenseAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(sessionAs(lowRoleSession))
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("deletes and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(sessionAs(fakeSession))
      mockDeleteTransaction.mockReturnValue(deleteTransactionReturn(Effect.succeed(undefined)))

      const result = await deleteExpenseAction("t1")
      expect(result).toEqual({ data: undefined })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/expenses")
    })
  })

})
