import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
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

vi.mock("@/services/dashboard.service", () => ({
  getDashboardKPIs: vi.fn(),
  getRecentActivity: vi.fn(),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { DatabaseError } from "@/lib/errors"

import { getDashboardAction, getRecentActivityAction } from "../dashboard.actions"

import { fakeSession, effectReturn } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockGetDashboardKPIs = vi.mocked(getDashboardKPIs)
const mockGetRecentActivity = vi.mocked(getRecentActivity)
const kpisReturn = effectReturn<typeof getDashboardKPIs>
const activityReturn = effectReturn<typeof getRecentActivity>

// ---------- Tests ----------

describe("Dashboard Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== getDashboardAction =====
  describe("getDashboardAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getDashboardAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns KPIs on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const kpis = { totalLoans: 10, activeLoans: 5 }
      mockGetDashboardKPIs.mockReturnValue(kpisReturn(Effect.succeed(kpis)))
      const result = await getDashboardAction()
      expect(result).toEqual({ data: { kpis } })
    })

    it("returns database error when service fails with DatabaseError", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetDashboardKPIs.mockReturnValue(
        kpisReturn(Effect.fail(new DatabaseError({ cause: "boom" }))),
      )
      const result = await getDashboardAction()
      expect(result).toEqual({ error: "Database error" })
    })

    it("returns generic error for unknown failures", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetDashboardKPIs.mockReturnValue(kpisReturn(Effect.fail(new Error("unknown"))))
      const result = await getDashboardAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== getRecentActivityAction =====
  describe("getRecentActivityAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getRecentActivityAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns activity data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const activity = { rows: [{ id: "a1" }], total: 1 }
      mockGetRecentActivity.mockReturnValue(activityReturn(Effect.succeed(activity)))
      const result = await getRecentActivityAction(1, 10)
      expect(result).toEqual({ data: activity })
    })

    it("returns database error when service fails with DatabaseError", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetRecentActivity.mockReturnValue(
        activityReturn(Effect.fail(new DatabaseError({ cause: "db down" }))),
      )
      const result = await getRecentActivityAction()
      expect(result).toEqual({ error: "Database error" })
    })
  })
})
