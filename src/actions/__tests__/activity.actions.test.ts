import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
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

vi.mock("@/services/activity.service", () => ({
  getActivities: vi.fn(),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { getActivities } from "@/services/activity.service"
import { DatabaseError } from "@/lib/errors"
import { getActivitiesAction } from "../activity.actions"
import { fakeSession, supervisorSession } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockGetActivities = vi.mocked(getActivities)

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
      mockGetActivities.mockReturnValue(Effect.succeed(activities) as any)

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
      mockGetActivities.mockReturnValue(Effect.succeed({ items: [], total: 0 }) as any)

      await getActivitiesAction(inputWithFilters)

      expect(mockGetActivities).toHaveBeenCalledWith({
        ...inputWithFilters,
        viewerRole: "supervisor",
      })
    })

    it("returns database error when service fails", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(
        Effect.fail(new DatabaseError({ cause: "db down" })) as any,
      )
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Database error" })
    })

    it("returns generic error for unknown failures", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(Effect.fail(new Error("unknown")) as any)
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Internal server error" })
    })
  })
})
