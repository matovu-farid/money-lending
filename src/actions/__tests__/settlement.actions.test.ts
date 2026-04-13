import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && typeof (error as any)._tag === "string") {
      return (error as any)._tag
    }
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && "_tag" in inner) {
        return inner._tag as string
      }
    }
    return undefined
  },
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/collateral-settlement.service", () => ({
  settleWithCollateral: vi.fn(),
  getCustomerActiveLoan: vi.fn(),
}))

// ---------- Imports ----------

import { getSession, requireRole, checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { settleWithCollateral, getCustomerActiveLoan } from "@/services/collateral-settlement.service"
import { LoanNotFound } from "@/lib/errors"

import { settleWithCollateralAction, checkCustomerActiveLoanAction } from "../settlement.actions"

import { supervisorSession } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockSettleWithCollateral = vi.mocked(settleWithCollateral)
const mockGetCustomerActiveLoan = vi.mocked(getCustomerActiveLoan)

const fakeSession = supervisorSession

// ---------- Tests ----------

describe("Settlement Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== settleWithCollateralAction =====
  describe("settleWithCollateralAction", () => {
    const validInput = { loanId: "l1", reason: "Customer surrendered collateral" }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await settleWithCollateralAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Only supervisors and above can settle loans with collateral")
      const result = await settleWithCollateralAction(validInput as any)
      expect(result).toEqual({ error: "Only supervisors and above can settle loans with collateral" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await settleWithCollateralAction({ ...validInput, loanId: "" } as any)
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await settleWithCollateralAction({ ...validInput, reason: "" } as any)
      expect(result).toEqual({ error: "Reason is required" })
    })

    it("settles loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const settled = { id: "l1", status: "settled" }
      mockSettleWithCollateral.mockReturnValue(Effect.succeed(settled) as any)

      const result = await settleWithCollateralAction(validInput as any)
      expect(result).toEqual({ data: settled })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/l1")
    })

    it("returns error when loan not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockSettleWithCollateral.mockReturnValue(
        Effect.fail(new LoanNotFound({ id: "l1" })) as any,
      )
      const result = await settleWithCollateralAction(validInput as any)
      expect(result).toEqual({ error: "Loan not found" })
    })
  })

  // ===== checkCustomerActiveLoanAction =====
  describe("checkCustomerActiveLoanAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await checkCustomerActiveLoanAction("c1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns null for empty customer ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await checkCustomerActiveLoanAction("")
      expect(result).toEqual({ data: null })
    })

    it("returns loan data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const loan = { id: "l1", customerId: "c1" }
      mockGetCustomerActiveLoan.mockResolvedValue(loan as any)

      const result = await checkCustomerActiveLoanAction("c1")
      expect(result).toEqual({ data: loan })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetCustomerActiveLoan.mockRejectedValue(new Error("boom"))

      const result = await checkCustomerActiveLoanAction("c1")
      expect(result).toEqual({ error: "Internal server error" })
    })
  })
})
