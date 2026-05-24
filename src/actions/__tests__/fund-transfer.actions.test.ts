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
  checkPermission: vi.fn().mockResolvedValue(null),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/fund-transfer.service", () => ({
  createFundTransferWithTxid: vi.fn(),
  createCapitalInjectionWithTxid: vi.fn(),
  listFundTransfers: vi.fn(),
}))

// ---------- Imports ----------

import { getSession, requireRole, checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import {
  createFundTransferWithTxid,
  createCapitalInjectionWithTxid,
  listFundTransfers,
} from "@/services/fund-transfer.service"

import {
  createFundTransferAction,
  createCapitalInjectionAction,
  listFundTransfersAction,
} from "../fund-transfer.actions"

import { fakeSession, effectReturn } from "./test-utils"
import type { CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types"
const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateFundTransferWithTxid = vi.mocked(createFundTransferWithTxid)
const mockCreateCapitalInjectionWithTxid = vi.mocked(createCapitalInjectionWithTxid)
const mockListFundTransfers = vi.mocked(listFundTransfers)
void mockRequireRole

const transferReturn = effectReturn<typeof createFundTransferWithTxid>
const injectionReturn = effectReturn<typeof createCapitalInjectionWithTxid>
const listTransfersReturn = effectReturn<typeof listFundTransfers>

// ---------- Tests ----------

describe("Fund Transfer Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== createFundTransferAction =====
  describe("createFundTransferAction", () => {
    const validInput: CreateFundTransferInput = {
      fromLocation: "cash",
      toLocation: "bank",
      toSubLocationId: "bank-acc-1",
      amount: "500000",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createFundTransferAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Forbidden: admin access required")
      const result = await createFundTransferAction(validInput)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid source location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      // Intentionally pass a value outside the DepositLocation union to
      // exercise the runtime guard. Cast through unknown rather than `any`.
      const result = await createFundTransferAction(
        { ...validInput, fromLocation: "pillow" } as unknown as CreateFundTransferInput,
      )
      expect(result).toEqual({ error: "Invalid source location" })
    })

    it("returns error for same source and destination", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createFundTransferAction({ ...validInput, toLocation: "cash" })
      expect(result).toEqual({ error: "Source and destination must be different" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createFundTransferAction({ ...validInput, amount: "abc" })
      expect(result).toHaveProperty("error")
      expect((result as { error: string }).error).toContain("Amount")
    })

    it("creates transfer on success without server-side revalidation", async () => {
      // Pages render client-side from TanStack DB collections, so the action
      // intentionally does NOT call revalidatePath — that would block the
      // response while Next re-fetches RSC for routes the user may not be on.
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const created = { id: "ft1" }
      mockCreateFundTransferWithTxid.mockReturnValue(
        transferReturn(Effect.succeed({ transfer: created, txid: "tx_123" })),
      )

      const result = await createFundTransferAction(validInput)
      expect(result).toEqual({ data: created, txid: "tx_123" })
      expect(mockRevalidatePath).not.toHaveBeenCalled()
    })
  })

  // ===== createCapitalInjectionAction =====
  describe("createCapitalInjectionAction", () => {
    const validInput: CreateCapitalInjectionInput = {
      toLocation: "cash",
      amount: "1000000",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createCapitalInjectionAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Forbidden: admin access required")
      const result = await createCapitalInjectionAction(validInput)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid deposit location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createCapitalInjectionAction(
        { ...validInput, toLocation: "mattress" } as unknown as CreateCapitalInjectionInput,
      )
      expect(result).toEqual({ error: "Invalid deposit location" })
    })

    it("creates injection on success without server-side revalidation", async () => {
      // Same rationale as createFundTransferAction — see comment above.
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const created = { id: "ci1" }
      mockCreateCapitalInjectionWithTxid.mockReturnValue(
        injectionReturn(Effect.succeed({ transfer: created, txid: "tx_456" })),
      )

      const result = await createCapitalInjectionAction(validInput)
      expect(result).toEqual({ data: created, txid: "tx_456" })
      expect(mockRevalidatePath).not.toHaveBeenCalled()
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
      mockCheckPermission.mockResolvedValue("Forbidden: admin access required")
      const result = await listFundTransfersAction()
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns transfers on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const transfers = [{ id: "ft1" }]
      mockListFundTransfers.mockReturnValue(listTransfersReturn(Effect.succeed(transfers)))
      const result = await listFundTransfersAction()
      expect(result).toEqual({ data: transfers })
    })
  })
})
