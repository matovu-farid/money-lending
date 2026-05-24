import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn(async () => null),
  getEffectivePermissions: vi.fn().mockResolvedValue(new Set([
    "loan:create", "rate-change:approve-standard", "rate-change:approve-low",
  ])),
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

vi.mock("@/services/rate-change-request.service", () => ({
  applyRateChangeImmediately: vi.fn(),
  listAllRequests: vi.fn(),
  listRequestsForLoan: vi.fn(),
  reviewRequest: vi.fn(),
  countPendingRequests: vi.fn(),
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const mockWhere = vi.fn().mockResolvedValue([])
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      transaction: vi.fn(),
    },
    __mockWhere: mockWhere,
  }
})

vi.mock("@/lib/db/schema/loans", () => ({
  loans: { id: "id", interestRate: "interestRate", interestRateOverride: "interestRateOverride", deletedAt: "deletedAt" },
}))

vi.mock("@/lib/db/schema/rate-change-requests", () => ({
  rateChangeRequests: {
    id: "id",
    loanId: "loanId",
    requestedRate: "requestedRate",
    currentRate: "currentRate",
    requestedBy: "requestedBy",
    requiredApproverRole: "requiredApproverRole",
    status: "status",
  },
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: unknown) => col),
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/ip-allowlist", () => ({
  isIpAllowlistEnabled: vi.fn().mockResolvedValue(false),
  isIpAllowed: vi.fn().mockResolvedValue(true),
  recordBlock: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue(null),
}))

// ---------- Imports ----------

import { getSession, getUserRole, getEffectivePermissions } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import {
  applyRateChangeImmediately,
  listAllRequests,
  listRequestsForLoan,
  countPendingRequests,
} from "@/services/rate-change-request.service"
import { getBaseRate } from "@/lib/interest/effective-rate"

import {
  requestRateChangeAction,
  listAllRequestsAction,
  listRequestsForLoanAction,
  countPendingRequestsAction,
} from "../rate-change-request.actions"

import { fakeSession, effectReturn } from "./test-utils"
import type { CreateRateChangeRequestInput } from "@/types"
const mockGetSession = vi.mocked(getSession)
const mockGetUserRole = vi.mocked(getUserRole)
const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockApplyRateChange = vi.mocked(applyRateChangeImmediately)
const mockListAllRequests = vi.mocked(listAllRequests)
const mockListRequestsForLoan = vi.mocked(listRequestsForLoan)
const mockCountPendingRequests = vi.mocked(countPendingRequests)
const mockGetBaseRate = vi.mocked(getBaseRate)
void mockRevalidatePath
void mockApplyRateChange
void mockGetBaseRate

const listAllRequestsReturn = effectReturn<typeof listAllRequests>
const listRequestsForLoanReturn = effectReturn<typeof listRequestsForLoan>
const countPendingRequestsReturn = effectReturn<typeof countPendingRequests>

// ---------- Tests ----------

describe("Rate Change Request Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default permission mock after clearAllMocks
    mockGetEffectivePermissions.mockResolvedValue(new Set([
      "loan:create", "rate-change:approve-standard", "rate-change:approve-low",
    ]))
  })

  // ===== requestRateChangeAction =====
  describe("requestRateChangeAction", () => {
    const validInput: CreateRateChangeRequestInput = { loanId: "l1", requestedRate: "0.12" }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await requestRateChangeAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("unassigned")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set())
      const result = await requestRateChangeAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, loanId: "" })
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing requested rate", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, requestedRate: "" })
      expect(result).toEqual({ error: "Requested rate is required" })
    })

    it("returns error for invalid rate value", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, requestedRate: "1.5" })
      expect(result).toEqual({ error: "Rate must be a decimal between 0 and 1 (e.g., 0.10 for 10%)" })
    })
  })

  // ===== listAllRequestsAction =====
  describe("listAllRequestsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listAllRequestsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
      const result = await listAllRequestsAction()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("supervisor")
      const requests = [{ id: "r1" }]
      mockListAllRequests.mockReturnValue(listAllRequestsReturn(Effect.succeed(requests)))
      const result = await listAllRequestsAction()
      expect(result).toEqual({ data: requests })
    })
  })

  // ===== listRequestsForLoanAction =====
  describe("listRequestsForLoanAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listRequestsForLoanAction("l1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await listRequestsForLoanAction("")
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns requests on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const requests = [{ id: "r1" }]
      mockListRequestsForLoan.mockReturnValue(listRequestsForLoanReturn(Effect.succeed(requests)))
      const result = await listRequestsForLoanAction("l1")
      expect(result).toEqual({ data: requests })
    })
  })

  // ===== countPendingRequestsAction =====
  describe("countPendingRequestsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await countPendingRequestsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns 0 for non-supervisor role", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
      const result = await countPendingRequestsAction()
      expect(result).toEqual({ data: 0 })
    })

    it("returns count for supervisor", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("supervisor")
      mockCountPendingRequests.mockReturnValue(countPendingRequestsReturn(Effect.succeed(3)))
      const result = await countPendingRequestsAction()
      expect(result).toEqual({ data: 3 })
    })
  })
})
