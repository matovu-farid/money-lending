import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import { InsufficientFundsError } from "@/lib/errors"

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
  getErrorTag: vi.fn((error: any) => {
    const cause = error?.[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? error?.cause
    return error?._tag ?? cause?.failure?._tag ?? cause?.error?._tag
  }),
  getErrorField: vi.fn((error: any, field: string) => {
    const cause = error?.[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? error?.cause
    return error?.[field] ?? cause?.failure?.[field] ?? cause?.error?.[field]
  }),
  getSessionPermissions: vi.fn().mockResolvedValue(new Set(["fund-transfer:create", "backdate:beyond-3-days"])),
  validateBackdating: vi.fn().mockReturnValue(null),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/email", () => ({
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
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

import { fakeSession } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateFundTransferWithTxid = vi.mocked(createFundTransferWithTxid)
const mockCreateCapitalInjectionWithTxid = vi.mocked(createCapitalInjectionWithTxid)
const mockListFundTransfers = vi.mocked(listFundTransfers)

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
      toSubLocationId: "bank-acc-1",
      amount: "500000",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Forbidden: admin access required")
      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid source location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createFundTransferAction({ ...validInput, fromLocation: "pillow" } as any)
      expect(result).toEqual({ error: "Invalid source location" })
    })

    it("returns error for same source and destination", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createFundTransferAction({ ...validInput, toLocation: "cash" } as any)
      expect(result).toEqual({ error: "Source and destination must be different" })
    })

    it("allows transfers between two different bank accounts", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const created = { id: "bank-to-bank-1" }
      mockCreateFundTransferWithTxid.mockReturnValue(Effect.succeed({ transfer: created, txid: "tx_bank" }) as any)

      const result = await createFundTransferAction({
        fromLocation: "bank",
        fromSubLocationId: "bank-acc-1",
        toLocation: "bank",
        toSubLocationId: "bank-acc-2",
        amount: "500000",
      } as any)

      expect(result).toEqual({ data: created, txid: "tx_bank" })
    })

    it("rejects a transfer from a bank account to itself", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)

      const result = await createFundTransferAction({
        fromLocation: "bank",
        fromSubLocationId: "bank-acc-1",
        toLocation: "bank",
        toSubLocationId: "bank-acc-1",
        amount: "500000",
      } as any)

      expect(result).toEqual({ error: "Source and destination must be different" })
    })

    it("returns a user-facing error when the source lacks funds", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockCreateFundTransferWithTxid.mockReturnValue(
        Effect.fail(
          new InsufficientFundsError({
            location: "the selected bank account",
            available: "100000.00",
            required: "500000.00",
          }),
        ) as any,
      )

      const result = await createFundTransferAction({
        fromLocation: "bank",
        fromSubLocationId: "bank-acc-1",
        toLocation: "cash",
        amount: "500000",
      } as any)

      expect(result).toEqual({
        error: "Insufficient funds in the selected bank account. Available: 100000.00, required: 500000.00. Transfer or inject funds first.",
      })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createFundTransferAction({ ...validInput, amount: "abc" } as any)
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Amount")
    })

    it("creates transfer on success without server-side revalidation", async () => {
      // Pages render client-side from TanStack DB collections, so the action
      // intentionally does NOT call revalidatePath — that would block the
      // response while Next re-fetches RSC for routes the user may not be on.
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const created = { id: "ft1" }
      mockCreateFundTransferWithTxid.mockReturnValue(Effect.succeed({ transfer: created, txid: "tx_123" }) as any)

      const result = await createFundTransferAction(validInput as any)
      expect(result).toEqual({ data: created, txid: "tx_123" })
      expect(mockRevalidatePath).not.toHaveBeenCalled()
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
      mockCheckPermission.mockResolvedValue("Forbidden: admin access required")
      const result = await createCapitalInjectionAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden: admin access required" })
    })

    it("returns error for invalid deposit location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await createCapitalInjectionAction({ ...validInput, toLocation: "mattress" } as any)
      expect(result).toEqual({ error: "Invalid deposit location" })
    })

    it("creates injection on success without server-side revalidation", async () => {
      // Same rationale as createFundTransferAction — see comment above.
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const created = { id: "ci1" }
      mockCreateCapitalInjectionWithTxid.mockReturnValue(Effect.succeed({ transfer: created, txid: "tx_456" }) as any)

      const result = await createCapitalInjectionAction(validInput as any)
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
      mockListFundTransfers.mockReturnValue(Effect.succeed(transfers) as any)
      const result = await listFundTransfersAction()
      expect(result).toEqual({ data: transfers })
    })
  })
})
