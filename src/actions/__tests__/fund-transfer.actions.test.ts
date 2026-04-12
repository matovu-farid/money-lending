import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/validators", () => ({
  validatePositiveDecimal: vi.fn((value: string | undefined | null, fieldName: string) => {
    if (!value?.trim() || !/^\d+(\.\d{1,2})?$/.test(value)) {
      return `${fieldName} must be a valid decimal number`
    }
    if (parseFloat(value) <= 0) {
      return `${fieldName} must be greater than zero`
    }
    return null
  }),
}))

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/fund-transfer.service", () => ({
  createFundTransfer: vi.fn(),
  createCapitalInjection: vi.fn(),
  listFundTransfers: vi.fn(),
}))

// ---------- Imports ----------

import { getSession, requireRole } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import {
  createFundTransfer,
  createCapitalInjection,
  listFundTransfers,
} from "@/services/fund-transfer.service"

import {
  createFundTransferAction,
  createCapitalInjectionAction,
  listFundTransfersAction,
} from "../fund-transfer.actions"

const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateFundTransfer = vi.mocked(createFundTransfer)
const mockCreateCapitalInjection = vi.mocked(createCapitalInjection)
const mockListFundTransfers = vi.mocked(listFundTransfers)

const fakeSession = {
  user: { id: "u1", name: "Test", email: "t@t.com", role: "admin" },
} as any

// ---------- Tests ----------

describe("Fund Transfer Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== createFundTransferAction =====
  describe("createFundTransferAction", () => {
    const validInput = {
      fromLocation: "cash",
      toLocation: "bank",
      amount: "500000",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue("Forbidden: admin access required")
      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid source location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await createFundTransferAction({ ...validInput, fromLocation: "pillow" } as any)
      expect(result).toEqual({ error: "Invalid source location" })
    })

    it("returns error for same source and destination", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await createFundTransferAction({ ...validInput, toLocation: "cash" } as any)
      expect(result).toEqual({ error: "Source and destination must be different" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await createFundTransferAction({ ...validInput, amount: "abc" } as any)
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Amount")
    })

    it("creates transfer and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const created = { id: "ft1" }
      mockCreateFundTransfer.mockReturnValue(Effect.succeed(created) as any)

      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ data: created })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/fund-transfers")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/reports/balance-sheet")
    })
  })

  // ===== createCapitalInjectionAction =====
  describe("createCapitalInjectionAction", () => {
    const validInput = {
      toLocation: "cash",
      amount: "1000000",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createCapitalInjectionAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue("Forbidden: admin access required")
      const result = await createCapitalInjectionAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid deposit location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await createCapitalInjectionAction({ ...validInput, toLocation: "mattress" } as any)
      expect(result).toEqual({ error: "Invalid deposit location" })
    })

    it("creates injection and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const created = { id: "ci1" }
      mockCreateCapitalInjection.mockReturnValue(Effect.succeed(created) as any)

      const result = await createCapitalInjectionAction(validInput as any)
      expect(result).toEqual({ data: created })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/fund-transfers")
    })
  })

  // ===== listFundTransfersAction =====
  describe("listFundTransfersAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listFundTransfersAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue("Forbidden: admin access required")
      const result = await listFundTransfersAction()
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns transfers on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const transfers = [{ id: "ft1" }]
      mockListFundTransfers.mockReturnValue(Effect.succeed(transfers) as any)
      const result = await listFundTransfersAction()
      expect(result).toEqual({ data: transfers })
    })
  })
})
