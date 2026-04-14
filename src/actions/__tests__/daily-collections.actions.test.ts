import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && typeof (error as any)._tag === "string") return (error as any)._tag
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && "_tag" in inner) return inner._tag as string
    }
    return undefined
  },
  requireRole: () => null,
}))

vi.mock("@/services/daily-collections.service", () => ({
  getDailyCollections: vi.fn(),
  getLoansDueToday: vi.fn(),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { getDailyCollections, getLoansDueToday } from "@/services/daily-collections.service"

import { getDailyCollectionsAction, getLoansDueTodayAction } from "../daily-collections.actions"

import { fakeSession } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockGetDailyCollections = vi.mocked(getDailyCollections)
const mockGetLoansDueToday = vi.mocked(getLoansDueToday)

// ---------- Tests ----------

describe("Daily Collections Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== getDailyCollectionsAction =====
  describe("getDailyCollectionsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getDailyCollectionsAction("2026-04-01")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await getDailyCollectionsAction("not-a-date")
      expect(result).toEqual({ error: "Invalid date" })
    })

    it("returns error for empty date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await getDailyCollectionsAction("")
      expect(result).toEqual({ error: "Invalid date" })
    })

    it("returns collections on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const collections = [{ id: "c1", amount: "50000" }]
      mockGetDailyCollections.mockReturnValue(Effect.succeed(collections) as any)
      const result = await getDailyCollectionsAction("2026-04-01")
      expect(result).toEqual({ data: collections })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetDailyCollections.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await getDailyCollectionsAction("2026-04-01")
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== getLoansDueTodayAction =====
  describe("getLoansDueTodayAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getLoansDueTodayAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns loans on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const loans = [{ id: "l1" }]
      mockGetLoansDueToday.mockReturnValue(Effect.succeed(loans) as any)
      const result = await getLoansDueTodayAction()
      expect(result).toEqual({ data: loans })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetLoansDueToday.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await getLoansDueTodayAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })
})
