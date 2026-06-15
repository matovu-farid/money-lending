import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => {
  const getUserRole = vi.fn((session: any) => session?.user?.role ?? "unassigned")
  const getEffectivePermissions = vi.fn().mockResolvedValue(new Set([
    "loan:create", "rate-change:approve-standard", "rate-change:approve-low",
  ]))
  const getSessionPermissions = vi.fn(async (session: any) => {
    const role = getUserRole(session)
    return getEffectivePermissions(session?.user?.id, role)
  })
  const getSessionRoleAndPermissions = vi.fn(async (session: any) => {
    const role = getUserRole(session)
    const perms = await getEffectivePermissions(session?.user?.id, role)
    return { role, perms }
  })
  return {
  getSession: vi.fn(),
  getUserRole,
  requireRole: vi.fn(),
  checkPermission: vi.fn(async () => null),
  getEffectivePermissions,
  getSessionPermissions,
  getSessionRoleAndPermissions,
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
  }
})

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/rate-change-request.service", () => ({
  applyRateChangeImmediately: vi.fn(),
  listAllRequests: vi.fn(),
  listRequestsForLoan: vi.fn(),
  listRateChangeRequests: vi.fn(),
  reviewRequest: vi.fn(),
  countPendingRequests: vi.fn(),
  getLoanRateForChange: vi.fn(),
  createPendingRateChangeRequest: vi.fn(),
  getRequestForReview: vi.fn(),
  DUPLICATE_PENDING_TAG: "DuplicatePending",
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
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  isNull: vi.fn((col: any) => col),
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
import {
  applyRateChangeImmediately,
  listAllRequests,
  listRequestsForLoan,
  countPendingRequests,
  getLoanRateForChange,
  createPendingRateChangeRequest,
  getRequestForReview,
  reviewRequest,
  type RateChangeRequestWithLoan,
} from "@/services/rate-change-request.service"
import { getBaseRate } from "@/lib/interest/effective-rate"
import type { RateChangeRequest } from "@/types"
import type { Equals, Expect } from "@/test-utils/type-assert"

import {
  requestRateChangeAction,
  listAllRequestsAction,
  listRequestsForLoanAction,
  reviewRateChangeRequestAction,
  countPendingRequestsAction,
} from "../rate-change-request.actions"

// ---------- Type snapshots (protect the action→service refactor) ----------
export type RateChangeActionTypeSnapshots = [
  Expect<
    Equals<
      Awaited<ReturnType<typeof requestRateChangeAction>>,
      | { error: string }
      | { data: { applied: true; message: string } }
      | { data: { applied: false; request: RateChangeRequest; message: string } }
    >
  >,
  Expect<
    Equals<
      Awaited<ReturnType<typeof listAllRequestsAction>>,
      { data: RateChangeRequestWithLoan[] } | { error: string }
    >
  >,
  Expect<
    Equals<
      Awaited<ReturnType<typeof listRequestsForLoanAction>>,
      { data: RateChangeRequest[] } | { error: string }
    >
  >,
  Expect<
    Equals<
      Awaited<ReturnType<typeof reviewRateChangeRequestAction>>,
      { data: RateChangeRequest } | { error: string }
    >
  >,
  Expect<
    Equals<Awaited<ReturnType<typeof countPendingRequestsAction>>, { data: number } | { error: string }>
  >,
]

import { fakeSession } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockGetUserRole = vi.mocked(getUserRole)
const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)
const mockApplyRateChange = vi.mocked(applyRateChangeImmediately)
const mockListAllRequests = vi.mocked(listAllRequests)
const mockListRequestsForLoan = vi.mocked(listRequestsForLoan)
const mockCountPendingRequests = vi.mocked(countPendingRequests)
const mockGetBaseRate = vi.mocked(getBaseRate)
const mockGetLoanRateForChange = vi.mocked(getLoanRateForChange)
const mockCreatePendingRequest = vi.mocked(createPendingRateChangeRequest)
const mockGetRequestForReview = vi.mocked(getRequestForReview)
const mockReviewRequest = vi.mocked(reviewRequest)

const asRequest = (partial: Partial<RateChangeRequest>): RateChangeRequest =>
  partial as unknown as RateChangeRequest

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
    const validInput = { loanId: "l1", requestedRate: "0.12" }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await requestRateChangeAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("unassigned")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set())
      const result = await requestRateChangeAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, loanId: "" } as any)
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing requested rate", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, requestedRate: "" } as any)
      expect(result).toEqual({ error: "Requested rate is required" })
    })

    it("returns error for invalid rate value", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await requestRateChangeAction({ ...validInput, requestedRate: "1.5" } as any)
      expect(result).toEqual({ error: "Rate must be a decimal between 0 and 1 (e.g., 0.10 for 10%)" })
    })

    it("returns error when the loan is not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetLoanRateForChange.mockResolvedValue(undefined)
      const result = await requestRateChangeAction(validInput as any)
      expect(result).toEqual({ error: "Loan not found" })
    })

    it("returns error when requested rate equals the current rate", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetLoanRateForChange.mockResolvedValue({ interestRate: "0.12", interestRateOverride: null })
      mockGetBaseRate.mockReturnValue("0.12")
      const result = await requestRateChangeAction(validInput as any)
      expect(result).toEqual({ error: "Requested rate is the same as the current rate" })
    })

    it("applies immediately when rate is >= 10% (no approval needed)", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetLoanRateForChange.mockResolvedValue({ interestRate: "0.10", interestRateOverride: null })
      mockGetBaseRate.mockReturnValue("0.10")
      mockApplyRateChange.mockReturnValue(Effect.succeed(undefined))
      const result = await requestRateChangeAction(validInput as any) // 0.12 >= 0.10
      expect(result).toEqual({ data: { applied: true, message: "Rate changed immediately" } })
    })

    it("creates a pending request when approval is required and user lacks permission", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
      mockGetLoanRateForChange.mockResolvedValue({ interestRate: "0.20", interestRateOverride: null })
      mockGetBaseRate.mockReturnValue("0.20")
      const request = asRequest({ id: "r1" })
      mockCreatePendingRequest.mockResolvedValue(request)
      const result = await requestRateChangeAction({ loanId: "l1", requestedRate: "0.09" } as any)
      expect(result).toMatchObject({ data: { applied: false, request } })
    })

    it("returns error when a pending request already exists", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
      mockGetLoanRateForChange.mockResolvedValue({ interestRate: "0.20", interestRateOverride: null })
      mockGetBaseRate.mockReturnValue("0.20")
      mockCreatePendingRequest.mockRejectedValue({ _tag: "DuplicatePending" })
      const result = await requestRateChangeAction({ loanId: "l1", requestedRate: "0.09" } as any)
      expect(result).toEqual({ error: "A pending rate change request already exists for this loan" })
    })
  })

  // ===== reviewRateChangeRequestAction =====
  describe("reviewRateChangeRequestAction", () => {
    const validReview = { requestId: "r1", action: "approved" as const }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden without approve-standard permission", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing request ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await reviewRateChangeRequestAction({ ...validReview, requestId: "" })
      expect(result).toEqual({ error: "Request ID is required" })
    })

    it("returns error for invalid action", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await reviewRateChangeRequestAction({ ...validReview, action: "maybe" as never })
      expect(result).toEqual({ error: "Action must be 'approved' or 'rejected'" })
    })

    it("returns error when the request is not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetRequestForReview.mockResolvedValue(undefined)
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toEqual({ error: "Rate change request not found" })
    })

    it("prevents self-approval", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetRequestForReview.mockResolvedValue({
        requiredApproverRole: "rate-change:approve-standard",
        loanId: "l1",
        requestedBy: fakeSession.user.id,
      })
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toEqual({ error: "You cannot review your own rate change request" })
    })

    it("returns error when reviewer lacks the required approver permission", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("supervisor")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["rate-change:approve-standard"]))
      mockGetRequestForReview.mockResolvedValue({
        requiredApproverRole: "rate-change:approve-low",
        loanId: "l1",
        requestedBy: "someone-else",
      })
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toMatchObject({ error: expect.stringContaining("do not have permission") })
    })

    it("reviews the request on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockGetRequestForReview.mockResolvedValue({
        requiredApproverRole: "rate-change:approve-standard",
        loanId: "l1",
        requestedBy: "someone-else",
      })
      const reviewed = asRequest({ id: "r1", status: "approved" })
      mockReviewRequest.mockReturnValue(Effect.succeed(reviewed))
      const result = await reviewRateChangeRequestAction(validReview)
      expect(result).toEqual({ data: reviewed })
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
      mockListAllRequests.mockReturnValue(Effect.succeed(requests) as any)
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
      mockListRequestsForLoan.mockReturnValue(Effect.succeed(requests) as any)
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
      mockCountPendingRequests.mockReturnValue(Effect.succeed(3) as any)
      const result = await countPendingRequestsAction()
      expect(result).toEqual({ data: 3 })
    })
  })
})
