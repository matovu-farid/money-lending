import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn((session: { user?: { role?: string | null } } | null | undefined) =>
    session?.user?.role ?? "unassigned",
  ),
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

vi.mock("@/services/activity.service", () => ({
  getActivities: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("@/lib/ip-allowlist", () => ({
  isIpAllowlistEnabled: vi.fn().mockResolvedValue(false),
  isIpAllowed: vi.fn().mockResolvedValue(true),
  recordBlock: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue(null),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { getActivities } from "@/services/activity.service"
import { DatabaseError } from "@/lib/errors"
import { getActivitiesAction } from "../activity.actions"
import { fakeSession, supervisorSession, effectReturn } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockGetActivities = vi.mocked(getActivities)
const activitiesReturn = effectReturn<typeof getActivities>

// ---------- Tests ----------

describe("Activity Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getActivitiesAction", () => {
    const validInput = { page: 1, pageSize: 25 }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns activities on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const activities = { items: [{ id: "a1", description: "Test" }], total: 1 }
      mockGetActivities.mockReturnValue(activitiesReturn(Effect.succeed(activities)))

      const result = await getActivitiesAction(validInput)

      expect(result).toEqual({ data: activities })
      expect(mockGetActivities).toHaveBeenCalledWith({
        ...validInput,
        viewerRole: "admin",
      })
    })

    it("passes filters through to service", async () => {
      mockGetSession.mockResolvedValue(supervisorSession)
      const inputWithFilters = {
        page: 1,
        pageSize: 25,
        actorId: "u3",
        entityType: "loan",
        dateFrom: "2026-04-01",
        dateTo: "2026-04-13",
      }
      mockGetActivities.mockReturnValue(activitiesReturn(Effect.succeed({ items: [], total: 0 })))

      await getActivitiesAction(inputWithFilters)

      expect(mockGetActivities).toHaveBeenCalledWith({
        ...inputWithFilters,
        viewerRole: "supervisor",
      })
    })

    it("returns database error when service fails", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(
        activitiesReturn(Effect.fail(new DatabaseError({ cause: "db down" }))),
      )
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Database error" })
    })

    it("returns generic error for unknown failures", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(activitiesReturn(Effect.fail(new Error("unknown"))))
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Internal server error" })
    })
  })
})
