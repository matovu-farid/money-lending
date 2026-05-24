import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error) {
      const tag = (error as { _tag: unknown })._tag
      if (typeof tag === "string") return tag
    }
    const causeContainer = error as Record<string | symbol, unknown>
    const cause = causeContainer[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? causeContainer.cause
    if (cause && typeof cause === "object") {
      const causeObj = cause as Record<string, unknown>
      const inner = causeObj.failure ?? causeObj.error
      if (inner && typeof inner === "object" && "_tag" in inner) {
        const innerTag = (inner as { _tag: unknown })._tag
        if (typeof innerTag === "string") return innerTag
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

import { supervisorSession, effectReturn } from "./test-utils"
import type { SettleWithCollateralInput } from "@/types/loan"
const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockSettleWithCollateral = vi.mocked(settleWithCollateral)
const mockGetCustomerActiveLoan = vi.mocked(getCustomerActiveLoan)
void mockRequireRole

const settleReturn = effectReturn<typeof settleWithCollateral>
const fakeSession = supervisorSession

// ---------- Tests ----------

describe("Settlement Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== settleWithCollateralAction =====
  describe("settleWithCollateralAction", () => {
    const validInput: SettleWithCollateralInput = { loanId: "l1", reason: "Customer surrendered collateral" }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await settleWithCollateralAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Only supervisors and above can settle loans with collateral")
      const result = await settleWithCollateralAction(validInput)
      expect(result).toEqual({ error: "Only supervisors and above can settle loans with collateral" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await settleWithCollateralAction({ ...validInput, loanId: "" })
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await settleWithCollateralAction({ ...validInput, reason: "" })
      expect(result).toEqual({ error: "Reason is required" })
    })

    it("settles loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const settled = { id: "l1", status: "settled" }
      // The service returns `{ loan, txid }` (transactional pattern).
      mockSettleWithCollateral.mockReturnValue(
        settleReturn(Effect.succeed({ loan: settled, txid: 42 })),
      )

      const result = await settleWithCollateralAction(validInput)
      expect(result).toEqual({ data: settled, txid: 42 })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/l1")
    })

    it("returns error when loan not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockSettleWithCollateral.mockReturnValue(
        settleReturn(Effect.fail(new LoanNotFound({ id: "l1" }))),
      )
      const result = await settleWithCollateralAction(validInput)
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
      mockGetCustomerActiveLoan.mockResolvedValue(
        loan as unknown as Awaited<ReturnType<typeof getCustomerActiveLoan>>,
      )

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
